//! Fake gh lives wholly in a private temporary directory, never the live queue.
use serde_json::{Value, json};
pub struct FakeGh {
    pub directory: tempfile::TempDir,
    pub binary: String,
}
impl FakeGh {
    pub fn new(plan: Vec<Value>) -> Self {
        let directory = private_root();
        let path = directory.path().join("fake-gh.cjs");
        std::fs::write(&path, include_str!("../../tests/fixtures/fake-gh.cjs")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        std::fs::write(
            directory.path().join("plan.json"),
            serde_json::to_vec(&plan).unwrap(),
        )
        .unwrap();
        Self {
            directory,
            binary: path.to_string_lossy().into(),
        }
    }
    pub fn calls(&self) -> Vec<Vec<String>> {
        std::fs::read_to_string(self.directory.path().join("calls.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}
pub fn private_root() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    directory
}
pub fn reply(value: Value) -> Value {
    json!({"stdout":serde_json::to_string(&value).unwrap()})
}
pub fn item(number: usize) -> Value {
    json!({"html_url":format!("https://github.com/carpe-lab/repo/pull/{number}"),"number":number,"title":format!("PR {number}"),"user":{"login":"someone"},"updated_at":"2026-10-22T00:00:00Z","pull_request":{}})
}
pub fn page(total: usize, incomplete: bool, numbers: std::ops::Range<usize>) -> Value {
    reply(
        json!({"total_count":total,"incomplete_results":incomplete,"items":numbers.map(item).collect::<Vec<_>>()}),
    )
}
