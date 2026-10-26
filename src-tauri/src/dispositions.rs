//! Local PR visibility only. Never edits GitHub or publishes review feedback.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Disposition {
    pub url: String,
    pub title: String,
    pub head: Option<String>,
    pub until: Option<u64>,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    SnoozeHour,
    SnoozeDay,
    IgnoreRevision,
    IgnorePr,
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn directory(root: &Path) -> Result<PathBuf> {
    crate::reviews::ensure_root(root)?;
    let directory = root.join("pr-dispositions");
    crate::reviews::ensure_root(&directory)?;
    Ok(directory)
}
fn filename(root: &Path, url: &str) -> Result<PathBuf> {
    let url = crate::canonical_pr_url(url)?;
    Ok(directory(root)?.join(format!("{:x}.json", Sha256::digest(url.as_bytes()))))
}
pub fn list(root: &Path) -> Result<Vec<Disposition>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory(root)?).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let value: Disposition =
            serde_json::from_slice(&fs::read(&path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        if filename(root, &value.url)? != path {
            return Err("Invalid PR visibility record".into());
        }
        entries.push(value);
    }
    entries.sort_by(|a, b| a.url.cmp(&b.url));
    Ok(entries)
}
pub fn set(
    root: &Path,
    url: &str,
    title: String,
    action: Action,
    head: Option<String>,
) -> Result<Vec<Disposition>> {
    let url = crate::canonical_pr_url(url)?;
    let revision = matches!(action, Action::IgnoreRevision);
    if revision
        && !head.as_ref().is_some_and(|head| {
            head.len() == 40 && head.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    {
        return Err("Cannot ignore this revision without a verified head commit".into());
    }
    let value = Disposition {
        url: url.clone(),
        title,
        head: if revision {
            head.map(|head| head.to_ascii_lowercase())
        } else {
            None
        },
        until: match action {
            Action::SnoozeHour => Some(now() + 3600),
            Action::SnoozeDay => Some(now() + 86400),
            _ => None,
        },
    };
    let path = filename(root, &url)?;
    let temporary = tempfile::NamedTempFile::new_in(path.parent().unwrap())
        .map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(temporary.as_file(), &value).map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary.persist(path).map_err(|error| error.to_string())?;
    list(root)
}
pub fn restore(root: &Path, url: &str) -> Result<Vec<Disposition>> {
    match fs::remove_file(filename(root, url)?) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    list(root)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn visibility_is_persistent_scoped_reversible_and_separate_from_results() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let url = "https://github.com/acme/repo/pull/42";
        assert!(set(root.path(), url, "PR".into(), Action::IgnoreRevision, None).is_err());
        let rule = set(
            root.path(),
            url,
            "PR".into(),
            Action::IgnoreRevision,
            Some("a".repeat(40)),
        )
        .unwrap()
        .remove(0);
        assert_eq!(rule.head, Some("a".repeat(40)));
        assert_eq!(rule.until, None);
        let rule = set(root.path(), url, "PR".into(), Action::IgnorePr, None)
            .unwrap()
            .remove(0);
        assert_eq!(rule.head, None);
        assert_eq!(list(root.path()).unwrap().len(), 1);
        let rule = set(root.path(), url, "PR".into(), Action::SnoozeHour, None)
            .unwrap()
            .remove(0);
        assert!(rule.until.unwrap() >= now() + 3590);
        assert_eq!(crate::reviews::list(root.path()).unwrap().len(), 0);
        assert!(restore(root.path(), url).unwrap().is_empty());
        assert!(restore(root.path(), url).unwrap().is_empty());
        assert!(
            set(
                root.path(),
                "file:///tmp/no",
                "PR".into(),
                Action::IgnorePr,
                None
            )
            .is_err()
        );
    }
}
