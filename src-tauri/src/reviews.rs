//! Immutable local review requests and explicit, atomic feedback handoff.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub repo: PathBuf,
    pub base: String,
    pub head: String,
    pub base_ref: String,
    pub head_ref: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewFile {
    pub path: String,
    pub status: String,
    pub before: String,
    pub after: String,
    pub unavailable: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewRequest {
    pub version: u8,
    pub id: String,
    pub title: String,
    pub source: Source,
    pub files: Vec<ReviewFile>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    pub id: String,
    pub title: String,
    pub source: Source,
    pub file_count: usize,
    pub complete: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Old,
    New,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Comment {
    pub path: String,
    pub side: Side,
    pub line: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
    pub body: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReviewOwner {
    #[default]
    Caller,
    App,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewContext {
    #[serde(default)]
    pub owner: ReviewOwner,
    #[serde(default)]
    pub reviewer_enabled: bool,
    #[serde(default)]
    pub guide: String,
    #[serde(default)]
    pub comments: Vec<Comment>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadUpdate {
    pub path: String,
    pub side: Side,
    pub line: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
    pub state: ThreadStatus,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThreadStatus {
    Open,
    Resolved,
    Dismissed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Feedback {
    pub head: String,
    pub comments: Vec<Comment>,
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thread_states: Vec<ThreadUpdate>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Complete,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewResult {
    pub version: u8,
    pub request_id: String,
    pub status: Status,
    pub feedback: Feedback,
}

pub fn root() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("DISPATCH_REVIEW_DIR") {
        return Ok(path.into());
    }
    let dirs = directories::BaseDirs::new().ok_or("No user data directory")?;
    Ok(dirs.data_local_dir().join("dispatch").join("reviews"))
}

pub fn ensure_root(root: &Path) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(root).map_err(|e| e.to_string())?;
    let metadata = fs::symlink_metadata(root).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Review directory must be a real private directory".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("Review directory must be private (mode 0700)".into());
        }
    }
    Ok(())
}

fn directory(root: &Path, id: &str) -> Result<PathBuf> {
    if Uuid::parse_str(id)
        .map_err(|_| "Invalid review id")?
        .to_string()
        != id
    {
        return Err("Invalid review id".into());
    }
    Ok(root.join(id))
}

fn git(repo: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("git")
        .arg("--no-pager")
        .arg("-C")
        .arg(repo)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(output.stdout)
}
fn revision(repo: &Path, name: &str) -> Result<String> {
    let value = git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{name}^{{commit}}"),
        ],
    )?;
    Ok(String::from_utf8(value)
        .map_err(|e| e.to_string())?
        .trim()
        .into())
}
fn blob(repo: &Path, sha: &str, path: &str) -> Result<Vec<u8>> {
    git(repo, &["cat-file", "blob", &format!("{sha}:{path}")])
}

fn publish(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing parent")?)
        .map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), value).map_err(|e| e.to_string())?;
    temporary.write_all(b"\n").map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary
        .persist_noclobber(path)
        .map_err(|e| format!("Cannot publish review file (already submitted?): {e}"))?;
    Ok(())
}

pub fn enqueue(root: &Path, repo: &Path, base: &str, head: &str) -> Result<ReviewRequest> {
    enqueue_with_context(root, repo, base, head, None)
}

pub fn enqueue_with_context(
    root: &Path,
    repo: &Path,
    base: &str,
    head: &str,
    context: Option<&ReviewContext>,
) -> Result<ReviewRequest> {
    ensure_root(root)?;
    let repo = repo.canonicalize().map_err(|e| e.to_string())?;
    let base_sha = revision(&repo, base)?;
    let head_sha = revision(&repo, head)?;
    let changed = git(
        &repo,
        &[
            "diff",
            "--name-status",
            "-z",
            "--no-renames",
            &base_sha,
            &head_sha,
            "--",
        ],
    )?;
    let fields: Vec<_> = changed
        .split(|b| *b == 0)
        .filter(|f| !f.is_empty())
        .collect();
    if fields.len() % 2 != 0 {
        return Err("Unexpected git name/status output".into());
    }
    let mut files = Vec::new();
    for entry in fields.chunks_exact(2) {
        let status = String::from_utf8(entry[0].to_vec()).map_err(|e| e.to_string())?;
        let path = String::from_utf8(entry[1].to_vec())
            .map_err(|_| "Non-UTF-8 paths are not supported yet")?;
        let before = if status == "A" {
            Ok(Vec::new())
        } else {
            blob(&repo, &base_sha, &path)
        };
        let after = if status == "D" {
            Ok(Vec::new())
        } else {
            blob(&repo, &head_sha, &path)
        };
        let (before, after, unavailable) = match (before, after) {
            (Ok(before), Ok(after)) if before.len() + after.len() <= 2_000_000 => {
                match (String::from_utf8(before), String::from_utf8(after)) {
                    (Ok(before), Ok(after)) if !before.contains('\0') && !after.contains('\0') => {
                        (before, after, None)
                    }
                    _ => (String::new(), String::new(), Some("Binary file".into())),
                }
            }
            (Ok(_), Ok(_)) => (
                String::new(),
                String::new(),
                Some("File exceeds the preview limit".into()),
            ),
            _ => (
                String::new(),
                String::new(),
                Some("Non-blob entry (for example, a submodule)".into()),
            ),
        };
        files.push(ReviewFile {
            path,
            status,
            before,
            after,
            unavailable,
        });
    }
    if files.is_empty() {
        return Err("There are no changes in this range".into());
    }
    let request = ReviewRequest {
        version: 1,
        id: Uuid::new_v4().to_string(),
        title: format!("{base} → {head}"),
        source: Source {
            repo,
            base: base_sha,
            head: head_sha,
            base_ref: base.into(),
            head_ref: head.into(),
        },
        files,
    };
    if let Some(context) = context {
        validate_context(context, &request)?;
    }
    let dir = directory(root, &request.id)?;
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    if let Some(context) = context {
        publish(&dir.join("context.json"), context)?;
    }
    publish(&dir.join("request.json"), &request)?;
    Ok(request)
}

pub fn read_request(root: &Path, id: &str) -> Result<ReviewRequest> {
    let path = directory(root, id)?.join("request.json");
    let request: ReviewRequest =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if request.version != 1 || request.id != id {
        return Err("Unsupported or mismatched review request".into());
    }
    Ok(request)
}

pub fn list(root: &Path) -> Result<Vec<ReviewSummary>> {
    ensure_root(root)?;
    let mut entries: Vec<_> = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();
    entries
        .sort_by_key(|entry| std::cmp::Reverse(entry.metadata().and_then(|m| m.modified()).ok()));
    let mut reviews = Vec::new();
    for entry in entries.into_iter().take(50) {
        let id = entry.file_name().to_string_lossy().into_owned();
        if let Ok(request) = read_request(root, &id) {
            reviews.push(ReviewSummary {
                id,
                title: request.title,
                source: request.source,
                file_count: request.files.len(),
                complete: entry.path().join("result.json").exists(),
            });
        }
    }
    Ok(reviews)
}

pub fn submit(root: &Path, id: &str, feedback: Feedback) -> Result<ReviewResult> {
    let request = read_request(root, id)?;
    if feedback.head != request.source.head {
        return Err("Feedback does not match this immutable revision".into());
    }
    for comment in &feedback.comments {
        let file = request
            .files
            .iter()
            .find(|f| f.path == comment.path)
            .ok_or("Comment references a file outside this review")?;
        let text = match comment.side {
            Side::Old => &file.before,
            Side::New => &file.after,
        };
        if file.unavailable.is_some()
            || comment.line == 0
            || comment.end_line.unwrap_or(comment.line) > text.lines().count().max(1)
            || comment.end_line.is_some_and(|end| end < comment.line)
            || comment.body.trim().is_empty()
        {
            return Err("Comment has an invalid line/range or empty body".into());
        }
    }
    for update in &feedback.thread_states {
        let file = request
            .files
            .iter()
            .find(|file| file.path == update.path)
            .ok_or("Thread state references a file outside this review")?;
        let text = match update.side {
            Side::Old => &file.before,
            Side::New => &file.after,
        };
        if file.unavailable.is_some()
            || update.line == 0
            || update.end_line.unwrap_or(update.line) > text.lines().count().max(1)
            || update.end_line.is_some_and(|end| end < update.line)
        {
            return Err("Invalid thread state anchor".into());
        }
    }
    let result = ReviewResult {
        version: 1,
        request_id: id.into(),
        status: Status::Complete,
        feedback,
    };
    publish(&directory(root, id)?.join("result.json"), &result)?;
    Ok(result)
}

pub fn result(root: &Path, id: &str) -> Result<Option<ReviewResult>> {
    let path = directory(root, id)?.join("result.json");
    if !path.exists() {
        return Ok(None);
    }
    let result: ReviewResult = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if result.version != 1 || result.request_id != id {
        return Err("Mismatched result".into());
    }
    Ok(Some(result))
}

/// Optional human review instructions; never part of the agent prompt or feedback payload.
pub fn context(root: &Path, id: &str) -> Result<Option<ReviewContext>> {
    let request = read_request(root, id)?;
    let path = directory(root, id)?.join("context.json");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Some(ReviewContext {
                reviewer_enabled: directory(root, id)?.join("reviewer-enabled.json").exists(),
                ..Default::default()
            }));
        }
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.len() > 256 * 1024 {
        return Err("Review guide must be a regular file of at most 256 KiB".into());
    }
    let mut context: ReviewContext =
        serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    validate_context(&context, &request)?;
    context.reviewer_enabled |= directory(root, id)?.join("reviewer-enabled.json").exists();
    Ok(Some(context))
}

pub fn enable_reviewer(root: &Path, id: &str) -> Result<()> {
    read_request(root, id)?;
    let path = directory(root, id)?.join("reviewer-enabled.json");
    if !path.exists() {
        publish(&path, &true)?;
    }
    Ok(())
}

fn validate_context(context: &ReviewContext, request: &ReviewRequest) -> Result<()> {
    if serde_json::to_vec(context)
        .map_err(|e| e.to_string())?
        .len()
        > 256 * 1024
    {
        return Err("Review context exceeds 256 KiB".into());
    }
    for comment in &context.comments {
        let file = request
            .files
            .iter()
            .find(|file| file.path == comment.path)
            .ok_or("Context comment references a file outside this review")?;
        let text = match comment.side {
            Side::Old => &file.before,
            Side::New => &file.after,
        };
        if file.unavailable.is_some()
            || comment.line == 0
            || comment.end_line.unwrap_or(comment.line) > text.lines().count().max(1)
            || comment.end_line.is_some_and(|end| end < comment.line)
            || comment.body.trim().is_empty()
        {
            return Err("Invalid context comment anchor or empty body".into());
        }
    }
    Ok(())
}

/// UI read markers use canonical per-file patches, not a review id or rendered markup.
pub fn file_identities(
    root: &Path,
    id: &str,
) -> Result<std::collections::BTreeMap<String, String>> {
    use sha2::{Digest, Sha256};
    let request = read_request(root, id)?;
    let repo = git(
        &request.source.repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .unwrap_or_else(|_| request.source.repo.to_string_lossy().as_bytes().to_vec());
    let valid_sha = |value: &str| {
        matches!(value.len(), 40 | 64) && value.bytes().all(|c| c.is_ascii_hexdigit())
    };
    let mut identities = std::collections::BTreeMap::new();
    for file in &request.files {
        let patch = if valid_sha(&request.source.base) && valid_sha(&request.source.head) {
            git(
                &request.source.repo,
                &[
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-renames",
                    "--no-color",
                    "--full-index",
                    if file.unavailable.is_some() {
                        "--raw"
                    } else {
                        "--patch"
                    },
                    &request.source.base,
                    &request.source.head,
                    "--",
                    &file.path,
                ],
            )
            .ok()
        } else {
            None
        };
        let canonical = patch.unwrap_or_else(|| {
            serde_json::to_vec(&serde_json::json!([
                file.path,
                file.status,
                file.before,
                file.after,
                if file.unavailable.is_some() || file.before == file.after {
                    Some((&request.source.base, &request.source.head))
                } else {
                    None
                }
            ]))
            .expect("snapshot is JSON")
        });
        let mut hash = Sha256::new();
        hash.update(b"dispatch:file-diff:v1\0");
        hash.update(&repo);
        hash.update(b"\0");
        hash.update(file.path.as_bytes());
        hash.update(b"\0");
        hash.update(canonical);
        hash.update(b"\0content\0");
        hash.update(
            serde_json::to_vec(&(
                file.status.as_str(),
                file.before.as_str(),
                file.after.as_str(),
                &file.unavailable,
            ))
            .expect("snapshot is JSON"),
        );
        identities.insert(file.path.clone(), format!("{:x}", hash.finalize()));
    }
    Ok(identities)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completion_is_explicit_and_cannot_overwrite_previous_feedback() {
        let root = tempfile::tempdir().unwrap();
        let id = Uuid::new_v4().to_string();
        let dir = directory(root.path(), &id).unwrap();
        fs::create_dir(&dir).unwrap();
        let source = Source {
            repo: root.path().into(),
            base: "a".repeat(40),
            head: "b".repeat(40),
            base_ref: "main".into(),
            head_ref: "HEAD".into(),
        };
        let request = ReviewRequest {
            version: 1,
            id: id.clone(),
            title: "fixture".into(),
            source,
            files: vec![ReviewFile {
                path: "file.rs".into(),
                status: "A".into(),
                before: String::new(),
                after: "first\nsecond\n".into(),
                unavailable: None,
            }],
        };
        publish(&dir.join("request.json"), &request).unwrap();
        assert_eq!(
            context(root.path(), &id).unwrap().unwrap().owner,
            ReviewOwner::Caller
        );
        let mut prefill = ReviewContext {
            guide: "What works and what to test".into(),
            comments: vec![Comment {
                path: "file.rs".into(),
                side: Side::New,
                line: 1,
                end_line: None,
                body: "Agent context, not human feedback".into(),
            }],
            ..Default::default()
        };
        validate_context(&prefill, &request).unwrap();
        prefill.comments[0].line = 99;
        assert!(validate_context(&prefill, &request).is_err());
        prefill.comments[0].line = 1;
        prefill.comments[0].end_line = Some(99);
        assert!(validate_context(&prefill, &request).is_err());
        prefill.comments[0].end_line = Some(0);
        assert!(validate_context(&prefill, &request).is_err());
        prefill.comments[0].end_line = Some(2);
        validate_context(&prefill, &request).unwrap();
        publish(&dir.join("context.json"), &prefill).unwrap();
        assert_eq!(
            context(root.path(), &id).unwrap().unwrap().comments.len(),
            1
        );
        enable_reviewer(root.path(), &id).unwrap();
        enable_reviewer(root.path(), &id).unwrap();
        assert!(context(root.path(), &id).unwrap().unwrap().reviewer_enabled);
        assert!(result(root.path(), &id).unwrap().is_none());
        let mut feedback = Feedback {
            head: "wrong".into(),
            comments: vec![],
            summary: None,
            thread_states: vec![],
        };
        assert!(submit(root.path(), &id, feedback.clone()).is_err());
        feedback.head = request.source.head.clone();
        feedback.comments.push(Comment {
            path: "other.rs".into(),
            side: Side::New,
            line: 1,
            end_line: None,
            body: "Fix this".into(),
        });
        assert!(submit(root.path(), &id, feedback.clone()).is_err());
        feedback.comments[0].path = "file.rs".into();
        feedback.comments[0].line = 3;
        assert!(submit(root.path(), &id, feedback.clone()).is_err());
        feedback.comments[0].line = 2;
        feedback.comments[0].end_line = Some(1);
        assert!(submit(root.path(), &id, feedback.clone()).is_err());
        feedback.comments[0].end_line = Some(3);
        assert!(submit(root.path(), &id, feedback.clone()).is_err());
        feedback.comments[0].end_line = Some(2);
        feedback.thread_states.push(ThreadUpdate {
            path: "file.rs".into(),
            side: Side::New,
            line: 99,
            end_line: None,
            state: ThreadStatus::Resolved,
        });
        assert!(submit(root.path(), &id, feedback.clone()).is_err());
        feedback.thread_states[0].line = 2;
        let completed = submit(root.path(), &id, feedback.clone()).unwrap();
        assert!(matches!(
            completed.feedback.thread_states[0].state,
            ThreadStatus::Resolved
        ));
        assert!(submit(root.path(), &id, feedback).is_err());
        assert_eq!(
            result(root.path(), &id)
                .unwrap()
                .unwrap()
                .feedback
                .comments
                .len(),
            1
        );
        assert!(directory(root.path(), "../escape").is_err());
    }
}
