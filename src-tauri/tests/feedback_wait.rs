use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[test]
fn cli_waits_for_feedback_and_can_attach_after_completion() {
    let root = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }
    let id = uuid::Uuid::new_v4().to_string();
    let folder = root.path().join(&id);
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("request.json"), serde_json::to_vec(&json!({
        "version":1,"id":id,"title":"CLI wait fixture",
        "source":{"repo":"/fixture","base":"a".repeat(40),"head":"b".repeat(40),"baseRef":"main","headRef":"HEAD"},
        "files":[{"path":"file.rs","status":"A","before":"","after":"fn main() {}\n","unavailable":null}]
    })).unwrap()).unwrap();
    let command = || {
        let mut command = Command::new(env!("CARGO_BIN_EXE_dispatch-review"));
        command
            .args(["wait", &id])
            .env("DISPATCH_REVIEW_DIR", root.path());
        command
    };
    let mut child = command()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut ready = String::new();
    BufReader::new(child.stderr.take().unwrap())
        .read_line(&mut ready)
        .unwrap();
    assert!(ready.contains("Waiting for human feedback"), "{ready}");
    assert!(
        child.try_wait().unwrap().is_none(),
        "must remain running without feedback"
    );
    assert!(!folder.join("result.json").exists());

    let expected = json!({"version":1,"requestId":id,"status":"complete","feedback":{
        "head":"b".repeat(40),"comments":[],"summary":"The final comment arrived intact"
    }});
    let mut result = tempfile::NamedTempFile::new_in(&folder).unwrap();
    result
        .write_all(&serde_json::to_vec(&expected).unwrap())
        .unwrap();
    result.as_file().sync_all().unwrap();
    result
        .persist_noclobber(folder.join("result.json"))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() >= deadline {
            child.kill().unwrap();
            panic!("waiter did not finish after result publication");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        expected
    );
    let attached = command().output().unwrap();
    assert!(attached.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&attached.stdout).unwrap(),
        expected
    );
    assert_eq!(
        fs::read_dir(root.path()).unwrap().count(),
        1,
        "waiting must not enqueue another review"
    );
}
