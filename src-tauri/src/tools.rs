//! Finder/desktop launchers do not inherit the user's interactive toolchain PATH.
use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}
fn find(name: &str, paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().map(|dir| dir.join(name)).find(|path| {
        executable(path)
            && (name == "mise"
                || path
                    .canonicalize()
                    .ok()
                    .and_then(|real| real.file_name().map(|name| name != "mise"))
                    .unwrap_or(false))
    })
}
fn mise_query(mise: &Path, args: &[&str], home: &Path, path: &OsStr) -> Option<String> {
    // Never inspect or execute the PR checkout's mise configuration. No installs,
    // shell initialization, environment export, or automatic trust operations.
    let mut child = Command::new(mise)
        .args(args)
        .current_dir(home)
        .env("PATH", path)
        .env("MISE_AUTO_INSTALL", "false")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let output = child.wait_with_output().ok()?;
                return String::from_utf8(output.stdout).ok();
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}
fn mise_tool(mise: &Path, name: &str, home: &Path, path: &OsStr) -> Option<PathBuf> {
    if let Some(output) = mise_query(mise, &["which", name], home, path) {
        let candidate = PathBuf::from(output.trim());
        if candidate.is_absolute() && executable(&candidate) {
            return candidate.canonicalize().ok();
        }
    }
    // A desktop app can also use an already-installed, project-scoped tool
    // (e.g. gh) without activating or trusting the PR's project configuration.
    let tool = if name == "pi" {
        "npm:@earendil-works/pi-coding-agent"
    } else {
        name
    };
    let output = mise_query(mise, &["ls", "--installed", "--json", tool], home, path)?;
    let records: serde_json::Value = serde_json::from_str(&output).ok()?;
    for record in records.as_array()?.iter().rev() {
        if record["installed"] != true {
            continue;
        }
        let install = PathBuf::from(record["install_path"].as_str()?);
        if !install.is_absolute() {
            continue;
        }
        if let Some(candidate) = find(name, &[install.join("bin"), install]) {
            return candidate.canonicalize().ok();
        }
    }
    None
}
fn shims(path: &Path) -> bool {
    path.ends_with("mise/shims")
}

pub(crate) struct Environment {
    pub path: OsString,
    pub pi: Option<PathBuf>,
}
fn discover(home: &Path, inherited: &OsStr) -> Environment {
    let original: Vec<_> = std::env::split_paths(inherited)
        .filter(|path| path.is_absolute() && !shims(path))
        .collect();
    let common = vec![
        home.join(".local/bin"),
        home.join(".cargo/bin"),
        home.join(".local/share/mise/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
    ];
    let search: Vec<_> = original.iter().chain(&common).cloned().collect();
    let query_path = std::env::join_paths(&search).unwrap_or_else(|_| inherited.to_owned());
    let mise = find("mise", &search);
    let mut bins = Vec::new();
    let mut pi = None;
    for name in ["node", "pi", "gh", "git", "ferropi"] {
        let resolved = find(name, &original)
            .or_else(|| {
                mise.as_ref()
                    .and_then(|mise| mise_tool(mise, name, home, &query_path))
            })
            .or_else(|| find(name, &common));
        if let Some(program) = resolved {
            if name == "pi" {
                pi = Some(program.clone());
            }
            if let Some(parent) = program.parent() {
                let parent = parent.to_path_buf();
                if !bins.contains(&parent) {
                    bins.push(parent);
                }
            }
        }
    }
    // Real runtime directories precede shims, so a PR-local mise.toml cannot
    // redirect Pi's /usr/bin/env node shebang into an untrusted runtime.
    bins.extend(std::env::split_paths(inherited));
    bins.extend(common);
    Environment {
        path: std::env::join_paths(bins).unwrap_or_else(|_| inherited.to_owned()),
        pi,
    }
}

/// Must run at the start of main, before Tauri/Tokio starts threads.
pub(crate) fn prepare() {
    let Some(base) = directories::BaseDirs::new() else {
        return;
    };
    let environment = discover(
        base.home_dir(),
        &std::env::var_os("PATH").unwrap_or_default(),
    );
    // SAFETY: run() calls this before building Tauri or spawning application threads.
    unsafe {
        std::env::set_var("PATH", environment.path);
        if std::env::var_os("PI_BINARY").is_none()
            && let Some(pi) = environment.pi
        {
            std::env::set_var("PI_BINARY", pi);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    fn script(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn finder_path_resolves_mise_pi_and_node_without_project_configuration() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path();
        let bin = home.join("installed/bin");
        script(&bin.join("pi"), "exit 0");
        script(&bin.join("node"), "exit 0");
        script(
            &home.join(".local/bin/mise"),
            &format!(
                "[ \"$PWD\" = '{}' ] || exit 9\nif [ \"$1\" = which ]; then case \"$2\" in pi|node) printf '%s/%s\\n' '{}' \"$2\"; exit 0;; esac; fi\nexit 1",
                home.display(),
                bin.display()
            ),
        );
        let environment = discover(home, OsStr::new("/usr/bin:/bin"));
        assert_eq!(environment.pi, Some(bin.join("pi").canonicalize().unwrap()));
        let paths: Vec<_> = std::env::split_paths(&environment.path).collect();
        assert_eq!(find("node", &paths), Some(bin.join("node")));
    }
    #[test]
    #[ignore = "explicit local runtime probe; starts native Pi without a model prompt"]
    fn installed_ferropi_starts_pi_with_finder_path_and_discovered_tools() {
        let helper =
            std::env::var_os("DISPATCH_PROBE_FERROPI").expect("set installed Ferropi path");
        let home = directories::BaseDirs::new().unwrap();
        let environment = discover(home.home_dir(), OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin"));
        let pi = environment
            .pi
            .expect("installed Pi through PATH, mise or Homebrew");
        let root = tempfile::tempdir().unwrap();
        let mut command = Command::new(helper);
        command
            .args(["--state-dir"])
            .arg(root.path().join("ferropi"))
            .arg("--pi")
            .arg(&pi);
        for arg in crate::agents::review_args() {
            command.arg(format!("--pi-arg={arg}"));
        }
        let output = command
            .arg("rpc")
            .arg("--session")
            .arg(root.path().join("probe.jsonl"))
            .arg("--cwd")
            .arg(root.path())
            .args(["--request", "{\"type\":\"get_state\"}"])
            .env("PATH", environment.path)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let records = String::from_utf8(output.stdout).unwrap();
        let response = records
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find(|record| record["id"] == "cli")
            .expect("native get_state response");
        assert_eq!(response["success"], true);
        println!(
            "PASS installed Ferropi + discovered Pi/Node from Finder PATH; native get_state, no model prompt: {}",
            pi.display()
        );
    }
    #[test]
    fn only_mise_shim_directories_are_excluded_from_direct_resolution() {
        assert!(shims(Path::new("/home/a/.local/share/mise/shims")));
        assert!(!shims(Path::new("/opt/homebrew/bin")));
    }
}
