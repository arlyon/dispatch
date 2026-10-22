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
    let parent_bytes = std::fs::read(root.path().join("restricted.jsonl")).unwrap();
    let mut quiz = Client::fork_with_args(
        &config,
        mount("restricted.jsonl", None),
        vec![
            "--tools".into(),
            "present_question,report_assessment".into(),
            "--no-mcp".into(),
        ],
    )
    .await
    .unwrap();
    let child = state(&mut quiz).await;
    assert!(
        !child["argv"]
            .as_array()
            .unwrap()
            .contains(&json!("--no-tools"))
    );
    assert!(
        child["argv"]
            .as_array()
            .unwrap()
            .contains(&json!("present_question,report_assessment"))
    );
    assert!(
        state(&mut restricted).await["argv"]
            .as_array()
            .unwrap()
            .contains(&json!("--no-tools"))
    );
    write_record(
        &mut quiz.writer,
        &json!({"type":"extension_ui_response","id":"dialog-from-pi","value":"answer"}),
    )
    .await
    .unwrap();
    loop {
        let wire = read_record(&mut quiz.reader).await.unwrap().unwrap();
        if wire["type"] == "event" {
            assert_eq!(wire["record"]["record"]["id"], "dialog-from-pi");
            break;
        }
    }
    assert_eq!(
        std::fs::read(root.path().join("restricted.jsonl")).unwrap(),
        parent_bytes
    );
    drop((ordinary, restricted, inherited, next, fork, quiz));
    tokio::time::timeout(Duration::from_secs(6), async {
        while config.socket().exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn quiz_fails_closed_before_mounting_on_an_older_daemon() {
    let root = tempfile::tempdir_in("/tmp").unwrap();
    let config = Config {
        state_dir: root.path().into(),
        pi: "must-not-start".into(),
        pi_args: vec![],
        executable: "must-not-start".into(),
    };
    let listener = tokio::net::UnixListener::bind(config.socket()).unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, mut write) = stream.into_split();
        let mut read = tokio::io::BufReader::new(read);
        assert_eq!(
            read_record(&mut read).await.unwrap().unwrap()["type"],
            "hello"
        );
        write_record(
            &mut write,
            &json!({"type":"hello","protocol":1,"capabilities":["sessionPiArgs"]}),
        )
        .await
        .unwrap();
        assert!(
            read_record(&mut read).await.unwrap().is_none(),
            "must not send mount/fork to an old daemon"
        );
    });
    let error = match Client::fork_with_args(
        &config,
        MountRequest {
            session: root.path().join("parent.jsonl"),
            cwd: root.path().into(),
            pi_args: None,
        },
        vec![
            "--tools".into(),
            "present_question,report_assessment".into(),
        ],
    )
    .await
    {
        Ok(_) => panic!("old daemon accepted quiz"),
        Err(error) => error,
    };
    assert!(
        error
            .to_string()
            .contains("lacks quiz fork/UI capabilities")
    );
    server.await.unwrap();
    assert!(!root.path().join("parent.jsonl").exists());
}
