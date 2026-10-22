#![cfg(unix)]
use ferropi::{Client, Config, MountRequest, read_record, write_record};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};

async fn state(client: &mut Client) -> Value {
    write_record(
        &mut client.writer,
        &json!({"type":"get_state","id":"state"}),
    )
    .await
    .unwrap();
    loop {
        let record = tokio::time::timeout(Duration::from_secs(5), read_record(&mut client.reader))
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if record["type"] == "response" && record["id"] == "state" {
            return record["data"].clone();
        }
    }
}

#[tokio::test]
async fn settings_are_per_session_not_whichever_client_started_the_daemon() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let executable = PathBuf::from(env!("CARGO_BIN_EXE_ferropi"));
    let config = Config {
        state_dir: root.path().join("state"),
        pi: executable.parent().unwrap().join("fake-pi"),
        pi_args: vec![],
        executable,
    };
    let mount = |name: &str, pi_args| MountRequest {
        session: root.path().join(name),
        cwd: root.path().into(),
        pi_args,
    };
    let ordinary = Client::mount(&config, mount("ordinary.jsonl", None))
        .await
        .unwrap();
    let mut restricted = Client::mount(
        &config,
        mount(
            "restricted.jsonl",
            Some(vec!["--no-tools".into(), "--no-mcp".into()]),
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        ordinary.mounted["daemonPid"],
        restricted.mounted["daemonPid"]
    );
    let data = state(&mut restricted).await;
    assert!(
        data["argv"]
            .as_array()
            .unwrap()
            .contains(&json!("--no-tools"))
    );
    assert!(
        data["argv"]
            .as_array()
            .unwrap()
            .contains(&json!("--no-mcp"))
    );
    let inherited = Client::mount(&config, mount("restricted.jsonl", None))
        .await
        .unwrap();
    assert_eq!(inherited.mounted["piPid"], restricted.mounted["piPid"]);
    let conflict = match Client::mount(
        &config,
        mount(
            "restricted.jsonl",
            Some(vec!["--tools".into(), "read".into()]),
        ),
    )
    .await
    {
        Ok(_) => panic!("conflicting options must not silently attach"),
        Err(error) => error,
    };
    assert!(conflict.to_string().contains("different Pi options"));
    let mut next = Client::mount(&config, mount("next.jsonl", None))
        .await
        .unwrap();
    assert!(
        !state(&mut next).await["argv"]
            .as_array()
            .unwrap()
            .contains(&json!("--no-tools"))
    );
    // Forks inherit the source's options, rather than the daemon's defaults.
    std::fs::write(root.path().join("restricted.jsonl"), "fixture\n").unwrap();
    let mut fork = Client::fork(&config, mount("restricted.jsonl", None))
        .await
        .unwrap();
    assert!(
        state(&mut fork).await["argv"]
            .as_array()
            .unwrap()
            .contains(&json!("--no-tools"))
    );
    drop((ordinary, restricted, inherited, next, fork));
    tokio::time::timeout(Duration::from_secs(6), async {
        while config.socket().exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}
