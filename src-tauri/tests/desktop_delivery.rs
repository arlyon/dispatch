//! CLI delivery contract, with a private fake desktop socket. Never launches a
//! GUI, starts Pi, modifies a real checkout, or publishes real feedback.
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::{fs::PermissionsExt, net::UnixListener},
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

fn git(repo: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "user.name=Dispatch test",
            "-c",
            "user.email=dispatch@example.invalid",
        ])
        .arg("-C")
        .arg(repo)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
}
fn repository() -> tempfile::TempDir {
    let repo = tempfile::tempdir().unwrap();
    git(repo.path(), &["init", "--quiet"]);
    fs::write(repo.path().join("file.rs"), "fn before() {}\n").unwrap();
    git(repo.path(), &["add", "."]);
    git(repo.path(), &["commit", "--quiet", "-m", "before"]);
    fs::write(repo.path().join("file.rs"), "fn after() {}\n").unwrap();
    git(repo.path(), &["add", "."]);
    git(repo.path(), &["commit", "--quiet", "-m", "after"]);
    repo
}
fn queue() -> tempfile::TempDir {
    let queue = tempfile::tempdir().unwrap();
    fs::set_permissions(queue.path(), fs::Permissions::from_mode(0o700)).unwrap();
    queue
}
fn desktop(root: &Path) -> (mpsc::Receiver<Value>, std::thread::JoinHandle<()>) {
    let listener = UnixListener::bind(root.join("desktop.sock")).unwrap();
    let (send, receive) = mpsc::channel();
    let task = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut line = String::new();
        BufReader::new(&mut stream).read_line(&mut line).unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();
        stream.write_all(b"{\"Ok\":null}\n").unwrap();
        send.send(value).unwrap();
    });
    (receive, task)
}
fn command(repo: &Path, queue: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_dispatch-review"));
    command
        .arg(repo)
        .args(["HEAD~1", "HEAD"])
        .env("DISPATCH_REVIEW_DIR", queue);
    command
}
#[test]
fn background_and_foreground_delivery_preserve_immutable_json_stdout() {
    let repo = repository();
    for background in [false, true] {
        let queue = queue();
        let (receive, task) = desktop(queue.path());
        let mut command = command(repo.path(), queue.path());
        if background {
            command.arg("--bg");
        }
        let output = command.output().unwrap();
        assert!(output.status.success());
        let request: Value = serde_json::from_slice(&output.stdout).unwrap();
        let activation = receive.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            activation,
            json!({"review":request["id"],"background":background})
        );
        assert!(
            queue
                .path()
                .join(request["id"].as_str().unwrap())
                .join("request.json")
                .is_file()
        );
        assert!(
            !queue
                .path()
                .join(request["id"].as_str().unwrap())
                .join("result.json")
                .exists()
        );
        task.join().unwrap();
    }
}
#[test]
fn bg_can_wait_without_implicitly_completing_the_review() {
    let repo = repository();
    let queue = queue();
    let (receive, task) = desktop(queue.path());
    let mut child = command(repo.path(), queue.path())
        .args(["--bg", "--wait"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let activation = receive.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(activation["background"], true);
    let id = activation["review"].as_str().unwrap();
    let folder = queue.path().join(id);
    let request: Value =
        serde_json::from_slice(&fs::read(folder.join("request.json")).unwrap()).unwrap();
    assert!(child.try_wait().unwrap().is_none());
    assert!(!folder.join("result.json").exists());
    let result = json!({"version":1,"requestId":id,"status":"complete","feedback":{
        "head":request["source"]["head"],"comments":[],"summary":"Explicit isolated test completion"
    }});
    let mut published = tempfile::NamedTempFile::new_in(&folder).unwrap();
    published
        .write_all(&serde_json::to_vec(&result).unwrap())
        .unwrap();
    published.as_file().sync_all().unwrap();
    published
        .persist_noclobber(folder.join("result.json"))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() > deadline {
            child.kill().unwrap();
            panic!("CLI did not observe explicit completion");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        result
    );
    task.join().unwrap();
}
#[test]
fn failed_gui_launch_does_not_lose_a_published_request_and_repeated_bg_is_rejected() {
    let repo = repository();
    let queue = queue();
    let output = command(repo.path(), queue.path())
        .arg("--bg")
        .env("DISPATCH_BIN", queue.path().join("missing-desktop"))
        .output()
        .unwrap();
    assert!(output.status.success());
    let request: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(String::from_utf8_lossy(&output.stderr).contains("still queued"));
    assert!(
        queue
            .path()
            .join(request["id"].as_str().unwrap())
            .join("request.json")
            .exists()
    );
    let output = command(repo.path(), queue.path())
        .args(["--bg", "--bg"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
}
