#![cfg(unix)]
use ferropi::{Client, Config, MountRequest, read_record, write_record};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

fn config(root: &Path) -> Config {
    let executable = PathBuf::from(env!("CARGO_BIN_EXE_ferropi"));
    Config {
        state_dir: root.join("state"),
        pi: executable.parent().unwrap().join("fake-pi"),
        pi_args: vec![],
        executable,
    }
}
fn source(root: &Path) -> MountRequest {
    MountRequest {
        session: root.join("native.jsonl"),
        cwd: root.into(),
        pi_args: None,
    }
}
async fn next(client: &mut Client) -> Value {
    tokio::time::timeout(Duration::from_secs(5), read_record(&mut client.reader))
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}
async fn call(client: &mut Client, request: Value) -> Value {
    write_record(&mut client.writer, &request).await.unwrap();
    loop {
        let record = next(client).await;
        if record["type"] == "response" && record["id"] == request["id"] {
            return record;
        }
    }
}
async fn gone(path: &Path) {
    tokio::time::timeout(Duration::from_secs(6), async {
        while path.exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn fork_has_independent_identity_events_and_leases() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let config = config(root.path());
    let source = source(root.path());
    // Fake fixture only; real native format compatibility is covered by the opt-in Pi test.
    std::fs::write(&source.session, "source-history\n").unwrap();
    let mut parent = Client::mount(&config, source.clone()).await.unwrap();
    let mut fork = Client::fork(&config, source.clone()).await.unwrap();
    assert_eq!(fork.mounted["daemonPid"], parent.mounted["daemonPid"]);
    assert_ne!(fork.mounted["piPid"], parent.mounted["piPid"]);
    let fork_path = PathBuf::from(fork.mounted["session"].as_str().unwrap());
    assert_ne!(fork_path, source.session.canonicalize().unwrap());
    let mut alias = Client::mount(
        &config,
        MountRequest {
            session: fork_path,
            cwd: root.path().into(),
            pi_args: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(alias.mounted["piPid"], fork.mounted["piPid"]);
    assert_eq!(
        call(
            &mut fork,
            json!({"type":"set_session_name","id":"name","name":"fork-only"})
        )
        .await["success"],
        true
    );
    call(
        &mut fork,
        json!({"type":"prompt","id":"prompt","message":"only in fork"}),
    )
    .await;
    write_record(
        &mut parent.writer,
        &json!({"type":"get_state","id":"parent"}),
    )
    .await
    .unwrap();
    let state = next(&mut parent).await;
    assert_eq!(
        state["type"], "response",
        "fork events must not leak to the parent"
    );
    assert_eq!(state["data"]["sessionName"], Value::Null);
    assert_eq!(
        std::fs::read_to_string(&source.session).unwrap(),
        "source-history\n"
    );
    // Exercise the real CLI entry point, not only the Rust Client API.
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new(&config.executable)
            .arg("--state-dir")
            .arg(&config.state_dir)
            .args(["fork", "--session"])
            .arg(&source.session)
            .arg("--cwd")
            .arg(root.path())
            .stdin(std::process::Stdio::null())
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mounted: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(mounted["type"], "mounted");
    assert_eq!(mounted["daemonPid"], parent.mounted["daemonPid"]);
    assert_ne!(mounted["piPid"], parent.mounted["piPid"]);
    assert_ne!(mounted["session"], fork.mounted["session"]);
    drop(parent);
    drop(fork);
    tokio::time::sleep(Duration::from_millis(650)).await;
    assert_eq!(
        call(&mut alias, json!({"type":"get_state","id":"alive"})).await["data"]["sessionName"],
        "fork-only"
    );
    drop(alias);
    gone(&config.socket()).await;
}

#[tokio::test]
async fn fork_rejects_retrying_sources_until_agent_settled() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let config = config(root.path());
    let source = source(root.path());
    std::fs::write(&source.session, "source-history\n").unwrap();
    let mut parent = Client::mount(&config, source.clone()).await.unwrap();
    write_record(
        &mut parent.writer,
        &json!({"type":"set_session_name","id":"busy","name":"busy"}),
    )
    .await
    .unwrap();
    loop {
        if next(&mut parent).await["record"]["type"] == "agent_end" {
            break;
        }
    }
    // Fake get_state says isStreaming=false: agent_end must still not be mistaken for settled.
    let error = match Client::fork(&config, source.clone()).await {
        Ok(_) => panic!("busy fork unexpectedly accepted"),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("wait for agent_settled"),
        "{error:#}"
    );
    write_record(
        &mut parent.writer,
        &json!({"type":"set_session_name","id":"settle","name":"settle"}),
    )
    .await
    .unwrap();
    loop {
        if next(&mut parent).await["record"]["type"] == "agent_settled" {
            break;
        }
    }
    let fork = Client::fork(&config, source).await.unwrap();
    drop(fork);
    drop(parent);
    gone(&config.socket()).await;
}

#[tokio::test]
async fn fork_rejects_unpersisted_sources_without_creating_a_fork() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let config = config(root.path());
    let error = match Client::fork(&config, source(root.path())).await {
        Ok(_) => panic!("unpersisted fork unexpectedly accepted"),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("not been persisted"),
        "{error:#}"
    );
    assert!(
        !std::fs::read_dir(root.path()).unwrap().any(|entry| entry
            .unwrap()
            .path()
            .extension()
            .and_then(|x| x.to_str())
            == Some("jsonl"))
    );
    gone(&config.socket()).await;
}
