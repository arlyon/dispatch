#![cfg(unix)]
use ferropi::{Client, Config, MountRequest, read_record, write_record};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

fn config(root: &Path, pi: PathBuf) -> Config {
    Config {
        state_dir: root.join("state"),
        pi,
        pi_args: vec![],
        executable: PathBuf::from(env!("CARGO_BIN_EXE_ferropi")),
    }
}
fn fake_pi() -> PathBuf {
    // Built by `cargo build --workspace --all-features`, as part of mise's test task.
    PathBuf::from(env!("CARGO_BIN_EXE_ferropi"))
        .parent()
        .unwrap()
        .join("fake-pi")
}
fn mount(root: &Path) -> MountRequest {
    MountRequest {
        session: root.join("native.jsonl"),
        cwd: root.into(),
        pi_args: None,
    }
}
async fn receive(client: &mut Client) -> Value {
    tokio::time::timeout(Duration::from_secs(8), read_record(&mut client.reader))
        .await
        .unwrap()
        .unwrap()
        .expect("unexpected EOF")
}
async fn response(client: &mut Client, id: &str) -> Value {
    loop {
        let record = receive(client).await;
        if record["type"] == "response" && record["id"] == id {
            return record;
        }
    }
}
async fn gone(path: &Path) {
    tokio::time::timeout(Duration::from_secs(8), async {
        while path.exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("daemon failed to remove its endpoint after last lease dropped");
}

#[tokio::test]
async fn mounts_share_one_process_route_duplicate_ids_and_fan_out_events() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let config = config(root.path(), fake_pi());
    assert!(
        config.pi.exists(),
        "run mise run test to build the fake Pi fixture first"
    );
    let (a, b) = tokio::join!(
        Client::mount(&config, mount(root.path())),
        Client::mount(&config, mount(root.path()))
    );
    let (mut a, mut b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.mounted["daemonPid"], b.mounted["daemonPid"]);
    assert_eq!(a.mounted["piPid"], b.mounted["piPid"]);
    // Deliberately identical caller IDs. The delayed request must not steal b's response.
    write_record(
        &mut a.writer,
        &json!({"id":"same","type":"set_session_name","name":"delay"}),
    )
    .await
    .unwrap();
    assert_eq!(receive(&mut a).await["record"]["type"], "test_delayed");
    assert_eq!(receive(&mut b).await["record"]["type"], "test_delayed");
    write_record(&mut b.writer, &json!({"id":"same","type":"get_state"}))
        .await
        .unwrap();
    let (ra, rb) = tokio::join!(response(&mut a, "same"), response(&mut b, "same"));
    assert_eq!(ra["command"], "set_session_name");
    assert_eq!(rb["command"], "get_state");
    write_record(
        &mut a.writer,
        &json!({"id":"prompt","type":"prompt","message":"hello\u{2028}world\u{2029}!"}),
    )
    .await
    .unwrap();
    async fn collect_run(client: &mut Client, needs_ack: bool) -> Vec<Value> {
        let mut ack = !needs_ack;
        let mut settled = false;
        let mut events = Vec::new();
        while !ack || !settled {
            let record = receive(client).await;
            if record["type"] == "response" {
                assert_eq!(record["data"]["disposition"], "started");
                ack = true;
            } else {
                settled = record["record"]["type"] == "agent_settled";
                events.push(record);
            }
        }
        events
    }
    let (ea, eb) = tokio::join!(collect_run(&mut a, true), collect_run(&mut b, false));
    assert_eq!(ea, eb);
    assert_eq!(
        ea.iter()
            .map(|e| e["record"]["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["message_update", "agent_end", "agent_settled"]
    );
    assert_eq!(
        ea[0]["record"]["assistantMessageEvent"]["delta"],
        "hello\u{2028}world\u{2029}!"
    );
    drop(a);
    tokio::time::sleep(Duration::from_millis(650)).await;
    write_record(&mut b.writer, &json!({"id":"alive","type":"get_state"}))
        .await
        .unwrap();
    assert!(
        response(&mut b, "alive").await["success"]
            .as_bool()
            .unwrap()
    );
    drop(b);
    gone(&config.socket()).await;
}

#[tokio::test]
async fn daemon_restarts_after_last_detach_and_refuses_cross_daemon_session_writers() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let config = config(root.path(), fake_pi());
    let a = Client::mount(&config, mount(root.path())).await.unwrap();
    let original = a.mounted["daemonPid"].clone();
    let mut other = config.clone();
    other.state_dir = root.path().join("other");
    let conflict = Client::mount(&other, mount(root.path())).await;
    assert!(
        conflict.is_err(),
        "a second daemon must not write the mounted session"
    );
    drop(a);
    gone(&config.socket()).await;
    let b = Client::mount(&config, mount(root.path())).await.unwrap();
    assert_ne!(original, b.mounted["daemonPid"]);
    drop(b);
    gone(&config.socket()).await;
    gone(&other.socket()).await;
}

#[tokio::test]
async fn immediate_remount_waits_for_old_pi_to_be_reaped() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let config = config(root.path(), fake_pi());
    for _ in 0..5 {
        let mut client = Client::mount(&config, mount(root.path())).await.unwrap();
        write_record(
            &mut client.writer,
            &json!({"id":"ready","type":"get_state"}),
        )
        .await
        .unwrap();
        assert_eq!(response(&mut client, "ready").await["success"], true);
        drop(client);
    }
    gone(&config.socket()).await;
}

#[tokio::test]
#[ignore = "requires FERROPI_PI_BINARY; starts real Pi offline without providers/tools/extensions"]
async fn native_pi_round_trip_and_clone_remain_native_sessions() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let mut config = config(
        root.path(),
        std::env::var_os("FERROPI_PI_BINARY")
            .expect("set FERROPI_PI_BINARY")
            .into(),
    );
    config.pi_args = [
        "--offline",
        "--no-extensions",
        "--no-mcp",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
        "--no-tools",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    config.pi_args.extend([
        "--session-dir".to_owned(),
        root.path().to_string_lossy().into_owned(),
    ]);
    // Native fixture, not Ferropi storage. No model calls required.
    let path = root.path().join("native.jsonl");
    let records = [
        json!({"type":"session","version":3,"id":"ferropi-native-smoke","timestamp":"2026-01-01T00:00:00.000Z","cwd":root.path()}),
        json!({"type":"message","id":"aaaa0001","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"Native session smoke fixture","timestamp":1767225601000u64}}),
        json!({"type":"message","id":"aaaa0002","parentId":"aaaa0001","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Native session acknowledged"}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-4-5","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1767225602000u64}}),
    ];
    std::fs::write(
        &path,
        records.iter().map(|v| format!("{v}\n")).collect::<String>(),
    )
    .unwrap();
    let original = std::fs::read(&path).unwrap();
    let (a, b) = tokio::join!(
        Client::mount(&config, mount(root.path())),
        Client::mount(&config, mount(root.path()))
    );
    let (mut a, mut b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.mounted["piPid"], b.mounted["piPid"]);
    write_record(&mut a.writer, &json!({"id":"state","type":"get_state"}))
        .await
        .unwrap();
    assert_eq!(
        response(&mut a, "state").await["data"]["sessionId"],
        "ferropi-native-smoke"
    );
    write_record(
        &mut b.writer,
        &json!({"id":"messages","type":"get_messages"}),
    )
    .await
    .unwrap();
    assert_eq!(
        response(&mut b, "messages").await["data"]["messages"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let mut forked = Client::fork(&config, mount(root.path())).await.unwrap();
    assert_eq!(forked.mounted["daemonPid"], a.mounted["daemonPid"]);
    assert_ne!(forked.mounted["piPid"], a.mounted["piPid"]);
    let broker_fork = PathBuf::from(forked.mounted["session"].as_str().unwrap());
    assert_ne!(broker_fork, path.canonicalize().unwrap());
    let header: Value = serde_json::from_str(
        std::fs::read_to_string(&broker_fork)
            .unwrap()
            .lines()
            .next()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        header["parentSession"],
        path.canonicalize().unwrap().to_str().unwrap()
    );
    write_record(
        &mut forked.writer,
        &json!({"id":"name","type":"set_session_name","name":"fork-only"}),
    )
    .await
    .unwrap();
    assert_eq!(response(&mut forked, "name").await["success"], true);
    write_record(&mut a.writer, &json!({"id":"original","type":"get_state"}))
        .await
        .unwrap();
    let original_state = response(&mut a, "original").await;
    assert_eq!(original_state["data"]["sessionId"], "ferropi-native-smoke");
    assert_ne!(original_state["data"]["sessionName"], "fork-only");
    drop(forked);
    // Shared mounts must not silently change identity underneath other clients.
    write_record(&mut a.writer, &json!({"id":"clone","type":"clone"}))
        .await
        .unwrap();
    assert_eq!(response(&mut a, "clone").await["success"], false);
    drop(a);
    drop(b);
    gone(&config.socket()).await;
    let persisted = std::fs::read(&path).unwrap();
    assert!(
        persisted.starts_with(&original),
        "native history must remain intact"
    );
    // Pi itself may append selected-model/thinking metadata while opening a session.
    for line in String::from_utf8(persisted[original.len()..].to_vec())
        .unwrap()
        .lines()
    {
        let entry: Value = serde_json::from_str(line).unwrap();
        assert!(matches!(
            entry["type"].as_str(),
            Some("model_change" | "thinking_level_change")
        ));
    }
    // Normal Pi can reopen the broker-created native fork, then clone it itself.
    let mut command = tokio::process::Command::new(&config.pi);
    command
        .args(&config.pi_args)
        .args(["--mode", "rpc", "--session"])
        .arg(&broker_fork)
        .current_dir(root.path());
    let pi = ferropi_pi_rpc::Session::spawn(command).unwrap();
    let reopened = pi
        .request(ferropi_pi_rpc::Command::GetState, Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(reopened.data.unwrap()["sessionName"], "fork-only");
    let result = pi
        .request(ferropi_pi_rpc::Command::Clone, Duration::from_secs(10))
        .await
        .unwrap();
    assert!(result.success, "{result:?}");
    let state = pi
        .request(ferropi_pi_rpc::Command::GetState, Duration::from_secs(10))
        .await
        .unwrap();
    let fork = PathBuf::from(state.data.unwrap()["sessionFile"].as_str().unwrap());
    assert_ne!(fork, path.canonicalize().unwrap());
    let mut closed = pi.closed();
    drop(pi);
    closed.wait_for(|v| *v).await.unwrap();
    let mut command = tokio::process::Command::new(&config.pi);
    command
        .args(&config.pi_args)
        .args(["--mode", "rpc", "--session"])
        .arg(&fork)
        .current_dir(root.path());
    let pi = ferropi_pi_rpc::Session::spawn(command).unwrap();
    let messages = pi
        .request(
            ferropi_pi_rpc::Command::GetMessages,
            Duration::from_secs(10),
        )
        .await
        .unwrap();
    assert_eq!(
        messages.data.unwrap()["messages"].as_array().unwrap().len(),
        2
    );
    let mut closed = pi.closed();
    drop(pi);
    closed.wait_for(|v| *v).await.unwrap();
}
