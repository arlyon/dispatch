//! Isolated, real Git checkouts. Never runs hooks, installs dependencies, or writes a user's repository.
use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

async fn git(settings: &Path, cwd: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = tokio::process::Command::new("git")
        .args([
            "-c",
            "credential.helper=",
            "-c",
            "credential.helper=!gh auth git-credential",
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.fsmonitor=false",
            "-c",
        ])
        .arg(format!(
            "core.hooksPath={}",
            settings.join("hooks").display()
        ))
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", settings.join("config"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|_| "Could not start Git")?;
    if !output.status.success() {
        // Never expose credential-helper output or raw private remote errors.
        let detail = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        let reason =
            if detail.contains("authentication") || detail.contains("could not read username") {
                "authentication failed"
            } else if detail.contains("could not fetch") || detail.contains("promisor") {
                "could not fetch required Git objects"
            } else if detail.contains("bad object") || detail.contains("invalid object") {
                "required Git object is unavailable"
            } else {
                "operation failed"
            };
        return Err(format!(
            "Git {} {reason} (exit {}); check repository access and GitHub CLI authentication",
            args.first().copied().unwrap_or("command"),
            output.status.code().unwrap_or(-1)
        ));
    }
    Ok(output.stdout)
}

pub(crate) struct Checkout {
    _temporary: tempfile::TempDir,
    pub path: PathBuf,
}
pub(crate) async fn checkout(
    root: &Path,
    remote: &str,
    branch: &str,
    base: &str,
    head: &str,
    merge_base: &str,
    mut phase: impl FnMut(&'static str),
) -> Result<Checkout, String> {
    crate::reviews::ensure_root(root)?;
    let temporary = tempfile::Builder::new()
        .prefix(".checkout-")
        .tempdir_in(root)
        .map_err(|e| e.to_string())?;
    let settings = temporary.path();
    std::fs::create_dir(settings.join("hooks")).map_err(|e| e.to_string())?;
    std::fs::write(settings.join("config"), b"").map_err(|e| e.to_string())?;
    let repository = settings.join("repository");
    git(
        settings,
        settings,
        &["check-ref-format", "--branch", branch],
    )
    .await?;
    phase("clone");
    git(
        settings,
        settings,
        &[
            "clone",
            "--quiet",
            "--no-checkout",
            "--no-tags",
            "--single-branch",
            "--",
            remote,
            repository.to_str().ok_or("Invalid checkout path")?,
        ],
    )
    .await
    .map_err(|error| format!("Could not clone repository: {error}"))?;
    // Store only the helper invocation in this private checkout, never credentials.
    git(
        settings,
        &repository,
        &[
            "config",
            "--local",
            "credential.helper",
            "!gh auth git-credential",
        ],
    )
    .await?;
    phase("fetch");
    git(
        settings,
        &repository,
        &[
            "fetch",
            "--quiet",
            "--no-tags",
            "origin",
            base,
            head,
            merge_base,
        ],
    )
    .await
    .map_err(|error| format!("Could not fetch the captured PR commits: {error}"))?;
    phase("checkout");
    git(
        settings,
        &repository,
        &["checkout", "--quiet", "-B", branch, head, "--"],
    )
    .await
    .map_err(|error| format!("Could not check out PR branch: {error}"))?;
    let actual = git(settings, &repository, &["rev-parse", "HEAD"]).await?;
    if !String::from_utf8_lossy(&actual)
        .trim()
        .eq_ignore_ascii_case(head)
    {
        return Err("Checked-out branch does not match the captured PR head".into());
    }
    git(settings, &repository, &["diff", "--quiet", "HEAD", "--"])
        .await
        .map_err(|_| "Checked-out files do not match the captured PR head")?;
    Ok(Checkout {
        path: repository,
        _temporary: temporary,
    })
}
impl Checkout {
    pub async fn files(
        &self,
        base: &str,
        head: &str,
        mut progress: impl FnMut(usize, usize),
    ) -> Result<Vec<crate::reviews::ReviewFile>, String> {
        let settings = self._temporary.path();
        // Resolve the comparison from the checked-out repository, not downloaded API previews.
        git(
            settings,
            &self.path,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--stat",
                base,
                head,
                "--",
            ],
        )
        .await?;
        let changed = git(
            settings,
            &self.path,
            &[
                "diff",
                "--no-ext-diff",
                "--name-status",
                "-z",
                "--no-renames",
                base,
                head,
                "--",
            ],
        )
        .await?;
        let fields: Vec<_> = changed
            .split(|byte| *byte == 0)
            .filter(|field| !field.is_empty())
            .collect();
        if fields.len() % 2 != 0 {
            return Err("Invalid Git changed-file list".into());
        }
        let total = fields.len() / 2;
        if total == 0 {
            return Err("This PR has no reviewable changes".into());
        }
        progress(0, total);
        let mut files = Vec::new();
        let mut bytes = 0;
        for entry in fields.chunks_exact(2) {
            let status = std::str::from_utf8(entry[0]).map_err(|_| "Invalid Git status")?;
            let path = std::str::from_utf8(entry[1])
                .map_err(|_| "Non-UTF-8 Git paths are not supported")?;
            let before = if status == "A" {
                Ok((String::new(), None))
            } else {
                self.blob(base, path).await
            }?;
            let after = if status == "D" {
                Ok((String::new(), None))
            } else {
                self.blob(head, path).await
            }?;
            let unavailable = before.1.or(after.1);
            let (before, after) = if unavailable.is_some() {
                (String::new(), String::new())
            } else {
                (before.0, after.0)
            };
            bytes += before.len() + after.len();
            if bytes > 24_000_000 {
                return Err("Review exceeds the 24 MB preview limit".into());
            }
            files.push(crate::reviews::ReviewFile {
                path: path.into(),
                status: status.into(),
                before,
                after,
                unavailable,
            });
            progress(files.len(), total);
        }
        Ok(files)
    }
    async fn blob(&self, revision: &str, path: &str) -> Result<(String, Option<String>), String> {
        let object = format!("{revision}:{path}");
        let settings = self._temporary.path();
        let size = match git(settings, &self.path, &["cat-file", "-s", &object]).await {
            Ok(value) => String::from_utf8_lossy(&value)
                .trim()
                .parse::<u64>()
                .map_err(|_| "Invalid Git blob size")?,
            Err(_) => {
                return Ok((
                    String::new(),
                    Some("Non-blob entry (for example, a submodule)".into()),
                ));
            }
        };
        if size > 1_000_000 {
            return Ok((
                String::new(),
                Some("File exceeds the preview limit (1 MB per side)".into()),
            ));
        }
        let value = git(settings, &self.path, &["cat-file", "blob", &object]).await?;
        Ok(match String::from_utf8(value) {
            Ok(text) if !text.contains('\0') => (text, None),
            _ => (String::new(), Some("Binary file".into())),
        })
    }
}
pub(crate) async fn matches(path: &Path, head: &str) -> bool {
    if !path.join(".git").exists() {
        return false;
    }
    let Ok(output) = tokio::process::Command::new("git")
        .args(["-C"])
        .arg(path)
        .args(["rev-parse", "HEAD"])
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
    else {
        return false;
    };
    output.status.success()
        && String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case(head)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(repo: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .args([
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().into()
    }
    #[tokio::test]
    async fn really_clones_fetches_and_checks_out_the_named_branch() {
        let source = tempfile::tempdir().unwrap();
        let root = crate::github_test_support::private_root();
        run(source.path(), &["init", "-q", "-b", "main"]);
        std::fs::write(source.path().join("file.rs"), "before\n").unwrap();
        run(source.path(), &["add", "file.rs"]);
        run(
            source.path(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-qm",
                "base",
            ],
        );
        let base = run(source.path(), &["rev-parse", "HEAD"]);
        run(source.path(), &["checkout", "-qb", "topic"]);
        std::fs::write(source.path().join("file.rs"), "after\n").unwrap();
        run(
            source.path(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-qam",
                "head",
            ],
        );
        let head = run(source.path(), &["rev-parse", "HEAD"]);
        let mut phases = vec![];
        let checkout = checkout(
            root.path(),
            source.path().to_str().unwrap(),
            "topic",
            &base,
            &head,
            &base,
            |phase| phases.push(phase),
        )
        .await
        .unwrap();
        assert_eq!(phases, ["clone", "fetch", "checkout"]);
        let files = checkout.files(&base, &head, |_, _| {}).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].before, "before\n");
        assert_eq!(files[0].after, "after\n");
        assert!(matches(&checkout.path, &head).await);
        assert_eq!(run(&checkout.path, &["branch", "--show-current"]), "topic");
        assert_eq!(
            std::fs::read_to_string(checkout.path.join("file.rs")).unwrap(),
            "after\n"
        );
        assert_eq!(run(&checkout.path, &["status", "--porcelain"]), "");
        assert_eq!(run(source.path(), &["rev-parse", "HEAD"]), head);
        assert!(checkout.path.starts_with(root.path()));
    }
}
