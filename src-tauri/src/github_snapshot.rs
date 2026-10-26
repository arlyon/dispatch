//! Explicit PR capture: real private Git checkout plus immutable review content. No model work.
use crate::{
    github,
    reviews::{self, ReviewFile, ReviewRequest, Source},
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Deserialize)]
struct Revision {
    sha: String,
    #[serde(rename = "ref")]
    name: String,
}
#[derive(Deserialize)]
struct Pull {
    title: String,
    base: Revision,
    head: Revision,
}
#[derive(Deserialize)]
struct Commit {
    sha: String,
}
#[derive(Deserialize)]
struct Comparison {
    merge_base_commit: Commit,
    files: Vec<ChangedFile>,
}
#[derive(Deserialize)]
struct ChangedFile {
    filename: String,
    status: String,
    previous_filename: Option<String>,
}
fn sha(value: &str) -> Result<&str, String> {
    if value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(value)
    } else {
        Err("Invalid GitHub commit/blob identity".into())
    }
}
fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
        || path.contains(['\\', '\0'])
    {
        return Err("Unsafe GitHub file path".into());
    }
    Ok(())
}
#[derive(Deserialize)]
struct Tree {
    truncated: bool,
    tree: Vec<TreeEntry>,
}
#[derive(Clone, Deserialize)]
struct TreeEntry {
    path: String,
    mode: String,
    sha: String,
    size: Option<u64>,
}
type Trees = std::collections::HashMap<String, Tree>;
async fn text(
    binary: &str,
    repo: &str,
    revision: &str,
    path: &str,
    trees: &mut Trees,
) -> Result<(String, Option<String>), String> {
    validate_path(path)?;
    let mut oid = sha(revision)?.to_string();
    let parts: Vec<_> = path.split('/').collect();
    let mut entry = None;
    for (index, part) in parts.iter().enumerate() {
        if !trees.contains_key(&oid) {
            let tree: Tree = serde_json::from_value(
                github::api(binary, &format!("repos/{repo}/git/trees/{oid}")).await?,
            )
            .map_err(|_| "Invalid GitHub tree")?;
            if tree.truncated {
                return Err("GitHub tree is truncated; cannot capture a complete file".into());
            }
            trees.insert(oid.clone(), tree);
        }
        let found = trees[&oid]
            .tree
            .iter()
            .find(|entry| entry.path == *part)
            .ok_or("File missing from pinned GitHub tree")?
            .clone();
        sha(&found.sha)?;
        if index + 1 < parts.len() && found.mode != "040000" {
            return Err("GitHub file parent is not a tree".into());
        }
        oid = found.sha.clone();
        entry = Some(found);
    }
    let entry = entry.ok_or("Missing GitHub file")?;
    if !matches!(entry.mode.as_str(), "100644" | "100755") {
        return Ok((
            String::new(),
            Some("Non-blob entry (symlink or submodule)".into()),
        ));
    }
    if entry.size.ok_or("Missing GitHub blob size")? > 1_000_000 {
        return Ok((
            String::new(),
            Some("File exceeds the preview limit (1 MB per side)".into()),
        ));
    }
    let endpoint = format!("repos/{repo}/git/blobs/{oid}");
    let bytes = github::gh(
        binary,
        &[
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            "-H",
            "Accept: application/vnd.github.raw+json",
            &endpoint,
        ],
        1_000_000,
    )
    .await?;
    Ok(match String::from_utf8(bytes) {
        Ok(text) if !text.contains('\0') => (text, None),
        _ => (String::new(), Some("Binary file".into())),
    })
}
async fn file(
    binary: &str,
    repo: &str,
    revisions: (&str, &str),
    path: &str,
    status: &str,
    trees: &mut Trees,
) -> Result<ReviewFile, String> {
    let (base, head) = revisions;
    validate_path(path)?;
    let (before, before_error) = if status == "A" {
        (String::new(), None)
    } else {
        text(binary, repo, base, path, trees).await?
    };
    let (after, after_error) = if status == "D" {
        (String::new(), None)
    } else {
        text(binary, repo, head, path, trees).await?
    };
    let unavailable = before_error.or(after_error);
    Ok(ReviewFile {
        path: path.into(),
        status: status.into(),
        before: if unavailable.is_some() {
            String::new()
        } else {
            before
        },
        after: if unavailable.is_some() {
            String::new()
        } else {
            after
        },
        unavailable,
    })
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    pub phase: &'static str,
    pub read_order: Option<u64>,
    pub head: Option<String>,
    pub done: usize,
    pub total: Option<usize>,
}
#[cfg(test)]
pub(crate) async fn open(binary: &str, root: &Path, url: &str) -> Result<ReviewRequest, String> {
    open_with_progress(binary, root, url, |_| {}).await
}
pub(crate) async fn open_with_progress(
    binary: &str,
    root: &Path,
    url: &str,
    progress: impl FnMut(Progress),
) -> Result<ReviewRequest, String> {
    open_capture(binary, root, url, None, progress).await
}
pub(crate) async fn open_with_checkout(
    binary: &str,
    root: &Path,
    url: &str,
    progress: impl FnMut(Progress),
) -> Result<ReviewRequest, String> {
    let canonical = crate::canonical_pr_url(url)?;
    let repo = canonical
        .strip_prefix("https://github.com/")
        .unwrap()
        .split("/pull/")
        .next()
        .unwrap();
    let remote = format!("https://github.com/{repo}.git");
    open_capture(binary, root, url, Some(&remote), progress).await
}
async fn open_capture(
    binary: &str,
    root: &Path,
    url: &str,
    checkout_remote: Option<&str>,
    mut progress: impl FnMut(Progress),
) -> Result<ReviewRequest, String> {
    let url = crate::canonical_pr_url(url)?;
    let path = url.strip_prefix("https://github.com/").unwrap();
    let (repo, number) = path.split_once("/pull/").ok_or("Invalid PR URL")?;
    if !github::approved_repo(repo) {
        return Err("PR is outside the approved GitHub source".into());
    }
    progress(Progress {
        read_order: None,
        phase: "metadata",
        head: None,
        done: 0,
        total: None,
    });
    let pull: Pull =
        serde_json::from_value(github::api(binary, &format!("repos/{repo}/pulls/{number}")).await?)
            .map_err(|_| "Invalid GitHub PR metadata")?;
    sha(&pull.base.sha)?;
    sha(&pull.head.sha)?;
    progress(Progress {
        read_order: None,
        phase: "comparison",
        head: Some(pull.head.sha.clone()),
        done: 0,
        total: None,
    });
    let comparison: Comparison = serde_json::from_value(
        github::api(
            binary,
            &format!(
                "repos/{repo}/compare/{}...{}?per_page=1",
                pull.base.sha, pull.head.sha
            ),
        )
        .await?,
    )
    .map_err(|_| "Invalid GitHub comparison")?;
    let base = sha(&comparison.merge_base_commit.sha)?;
    // GitHub only returns the first 300 changed files on comparisons. Fail closed
    // instead of presenting a silently truncated review as a complete snapshot.
    if checkout_remote.is_none() && comparison.files.len() >= 300 {
        return Err(
            "Comparison reaches GitHub's 300-file limit; cannot capture a complete review".into(),
        );
    }
    if checkout_remote.is_none() && comparison.files.is_empty() {
        return Err("This PR has no reviewable changes".into());
    }
    if let Some(existing) = reviews::remote_revision(root, &url, base, &pull.head.sha)?
        && (checkout_remote.is_none()
            || crate::git_checkout::matches(&existing.source.repo, &pull.head.sha).await)
    {
        return Ok(existing);
    }
    let checkout = if let Some(remote) = checkout_remote {
        Some(
            crate::git_checkout::checkout(
                root,
                remote,
                &pull.head.name,
                &pull.base.sha,
                &pull.head.sha,
                base,
                |phase| {
                    progress(Progress {
                        phase,
                        read_order: None,
                        head: Some(pull.head.sha.clone()),
                        done: 0,
                        total: None,
                    })
                },
            )
            .await?,
        )
    } else {
        None
    };
    let files = if let Some(checkout) = checkout.as_ref() {
        progress(Progress {
            phase: "files",
            read_order: None,
            head: Some(pull.head.sha.clone()),
            done: 0,
            total: None,
        });
        checkout
            .files(base, &pull.head.sha, |done, total| {
                progress(Progress {
                    phase: "files",
                    read_order: None,
                    head: Some(pull.head.sha.clone()),
                    done,
                    total: Some(total),
                })
            })
            .await?
    } else {
        let total = comparison
            .files
            .iter()
            .map(|file| if file.status == "renamed" { 2 } else { 1 })
            .sum();
        progress(Progress {
            read_order: None,
            phase: "files",
            head: Some(pull.head.sha.clone()),
            done: 0,
            total: Some(total),
        });
        let mut files = Vec::new();
        let mut paths = std::collections::HashSet::new();
        let mut bytes = 0;
        let mut trees = Trees::new();
        for changed in comparison.files {
            let entries = match changed.status.as_str() {
                "added" | "copied" => vec![(changed.filename, "A")],
                "removed" => vec![(changed.filename, "D")],
                "modified" | "changed" => vec![(changed.filename, "M")],
                "renamed" => vec![
                    (
                        changed
                            .previous_filename
                            .ok_or("Missing previous filename")?,
                        "D",
                    ),
                    (changed.filename, "A"),
                ],
                _ => return Err("Unsupported GitHub file change type".into()),
            };
            for (path, status) in entries {
                if !paths.insert(path.clone()) {
                    return Err("Ambiguous duplicate paths in GitHub comparison".into());
                }
                let file = file(
                    binary,
                    repo,
                    (base, &pull.head.sha),
                    &path,
                    status,
                    &mut trees,
                )
                .await?;
                bytes += file.before.len() + file.after.len();
                if bytes > 24_000_000 {
                    return Err("Snapshot exceeds the 24 MB review limit".into());
                }
                files.push(file);
                progress(Progress {
                    read_order: None,
                    phase: "files",
                    head: Some(pull.head.sha.clone()),
                    done: files.len(),
                    total: Some(total),
                });
            }
        }
        files
    };
    let guide = format!(
        "GitHub PR review: {url}\n\nPR base: {}\nComparison merge base: {base}\nReview head: {}\n\nThe review runs in its own Git checkout of the PR branch when available. Review contents remain bound to the captured commits; renames appear as deletion/addition pairs. No GitHub review will be published. Pi reviewer and Quiz are explicit opt-ins.",
        pull.base.sha, pull.head.sha
    );
    let request = ReviewRequest {
        version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        title: format!("{repo} #{number}: {}", pull.title),
        source: Source {
            repo: root.into(),
            base: base.into(),
            head: pull.head.sha,
            base_ref: pull.base.name,
            head_ref: pull.head.name,
            pr_url: Some(url),
        },
        files,
    };
    if let Some(checkout) = checkout {
        reviews::publish_remote_with_checkout(root, request, guide, &checkout.path)
    } else {
        reviews::publish_remote(root, request, guide)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::github_test_support::{FakeGh, private_root, reply};
    use serde_json::{Value, json};
    const URL: &str = "https://github.com/carpe-lab/repo/pull/42";
    fn metadata(head: &str, files: Value) -> Vec<Value> {
        vec![
            reply(
                json!({"title":"Pinned example","base":{"sha":"a".repeat(40),"ref":"main"},"head":{"sha":head.repeat(40),"ref":"topic"}}),
            ),
            reply(json!({"merge_base_commit":{"sha":"c".repeat(40)},"files":files})),
        ]
    }
    fn blobs(head: &str) -> Vec<Value> {
        vec![
            reply(
                json!({"truncated":false,"tree":[{"path":"src","mode":"040000","sha":"d".repeat(40)}]}),
            ),
            reply(
                json!({"truncated":false,"tree":[{"path":"main.rs","mode":"100644","sha":"f".repeat(40),"size":7}]}),
            ),
            json!({"stdout":"old();\n"}),
            reply(
                json!({"truncated":false,"tree":[{"path":"src","mode":"040000","sha":"e".repeat(40)}]}),
            ),
            reply(
                json!({"truncated":false,"tree":[{"path":"main.rs","mode":"100755","sha":head.repeat(40),"size":7}]}),
            ),
            json!({"stdout":format!("new_{head}();\n")}),
        ]
    }
    #[tokio::test]
    async fn pinned_blobs_reuse_revision_and_new_head_preserves_old_feedback_and_cwd() {
        let changed = json!([{"filename":"src/main.rs","status":"modified"}]);
        let mut plan = metadata("b", changed.clone());
        plan.extend(blobs("b"));
        plan.extend(metadata("b", changed.clone()));
        plan.extend(metadata("1", changed));
        plan.extend(blobs("1"));
        let fake = FakeGh::new(plan);
        let root = private_root();
        let mut progress = Vec::new();
        let first = open_with_progress(&fake.binary, root.path(), URL, |update| {
            progress.push(update)
        })
        .await
        .unwrap();
        assert_eq!(
            progress
                .iter()
                .map(|update| update.phase)
                .collect::<Vec<_>>(),
            ["metadata", "comparison", "files", "files"]
        );
        assert!(progress[0].head.is_none());
        assert!(
            progress
                .iter()
                .skip(1)
                .all(|update| update.head.as_deref() == Some(&"b".repeat(40)))
        );
        assert_eq!(progress.last().unwrap().done, 1);
        assert_eq!(progress.last().unwrap().total, Some(1));
        assert_eq!(first.source.base, "c".repeat(40));
        assert_eq!(first.source.head, "b".repeat(40));
        assert_eq!(first.files[0].before, "old();\n");
        assert_eq!(first.files[0].after, "new_b();\n");
        assert!(first.source.repo.is_dir());
        assert!(
            first
                .source
                .repo
                .starts_with(root.path().canonicalize().unwrap())
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&first.source.repo)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        let context = reviews::context(root.path(), &first.id).unwrap().unwrap();
        assert_eq!(context.owner, reviews::ReviewOwner::Caller);
        assert!(!context.reviewer_enabled);
        reviews::submit(
            root.path(),
            &first.id,
            reviews::Feedback {
                head: first.source.head.clone(),
                comments: vec![],
                summary: Some("preserve me".into()),
                thread_states: vec![],
            },
        )
        .unwrap();
        assert_eq!(
            open(&fake.binary, root.path(), URL).await.unwrap().id,
            first.id
        );
        let next = open(&fake.binary, root.path(), URL).await.unwrap();
        assert_ne!(next.id, first.id);
        assert_eq!(next.source.head, "1".repeat(40));
        assert_eq!(
            reviews::read_request(root.path(), &first.id).unwrap().files[0].after,
            "new_b();\n"
        );
        assert_eq!(
            reviews::result(root.path(), &first.id)
                .unwrap()
                .unwrap()
                .feedback
                .unwrap()
                .summary
                .as_deref(),
            Some("preserve me")
        );
        let calls = fake.calls();
        assert!(
            calls[2]
                .last()
                .unwrap()
                .ends_with(&format!("git/trees/{}", "c".repeat(40)))
        );
        assert!(
            calls[5]
                .last()
                .unwrap()
                .ends_with(&format!("git/trees/{}", "b".repeat(40)))
        );
        for args in calls {
            assert!(args.contains(&"GET".into()));
            assert!(
                !args
                    .iter()
                    .any(|s| s.contains("raw_url") || s.contains("contents/"))
            );
        }
    }
    #[tokio::test]
    async fn limits_truncation_errors_and_unsafe_metadata_never_publish_partial_request() {
        let changed = json!([{"filename":"src/main.rs","status":"modified"}]);
        let mut plans = vec![metadata(
            "b",
            Value::Array(
                (0..300)
                    .map(|n| json!({"filename":format!("{n}.rs"),"status":"added"}))
                    .collect(),
            ),
        )];
        let mut truncated = metadata("b", changed.clone());
        truncated.push(reply(json!({"truncated":true,"tree":[]})));
        plans.push(truncated);
        let mut network = metadata("b", changed);
        network.push(json!({"stderr":"network connection refused secret","code":1}));
        plans.push(network);
        plans.push(metadata(
            "b",
            json!([{"filename":"../secret","status":"added"}]),
        ));
        for plan in plans {
            let fake = FakeGh::new(plan);
            let root = private_root();
            assert!(open(&fake.binary, root.path(), URL).await.is_err());
            assert!(reviews::list(root.path()).unwrap().is_empty());
        }
        let fake = FakeGh::new(vec![]);
        let root = private_root();
        assert!(
            open(
                &fake.binary,
                root.path(),
                "https://github.com/other/repo/pull/1"
            )
            .await
            .is_err()
        );
    }
    #[tokio::test]
    async fn nonblob_and_large_previews_are_explicit_and_do_not_follow_symlinks() {
        for (mode, size) in [("120000", 20), ("160000", 20), ("100644", 1_000_001)] {
            let mut plan = metadata("b", json!([{"filename":"link","status":"added"}]));
            plan.push(reply(json!({"truncated":false,"tree":[{"path":"link","mode":mode,"sha":"d".repeat(40),"size":size}]})));
            let fake = FakeGh::new(plan);
            let root = private_root();
            let request = open(&fake.binary, root.path(), URL).await.unwrap();
            assert!(request.files[0].unavailable.is_some());
            assert!(request.files[0].after.is_empty());
            assert_eq!(fake.calls().len(), 3);
        }
    }
    #[tokio::test]
    async fn cancelled_snapshot_reaps_its_cli_and_publishes_nothing() {
        let mut plan = metadata("b", json!([{"filename":"file.rs","status":"added"}]));
        plan.push(json!({"delayMs":10000,"stdout":"{}"}));
        let fake = FakeGh::new(plan);
        let root = private_root();
        let binary = fake.binary.clone();
        let directory = root.path().to_path_buf();
        let task = tokio::spawn(async move { open(&binary, &directory, URL).await });
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if std::fs::read_to_string(fake.directory.path().join("count"))
                    .ok()
                    .as_deref()
                    == Some("3")
                {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        let pid = std::fs::read_to_string(fake.directory.path().join("pid")).unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        assert!(
            !std::process::Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success()
        );
        assert!(reviews::list(root.path()).unwrap().is_empty());
    }
    #[test]
    fn github_paths_are_data_not_urls_or_local_paths() {
        for path in ["../secret", "/etc/passwd", "a/../b", "a\\b", "a//b", "a\0b"] {
            assert!(validate_path(path).is_err(), "{path}");
        }
        assert!(validate_path("src/a #?.rs").is_ok());
        assert!(sha("../../etc/passwd").is_err());
    }
}
