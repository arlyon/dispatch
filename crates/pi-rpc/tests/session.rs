#![cfg(feature = "test-fixture")]
use ferropi_pi_rpc::{Command, Session};
use std::{sync::Arc, time::Duration};
fn spawn() -> Arc<Session> {
    Session::spawn(tokio::process::Command::new(env!("CARGO_BIN_EXE_fake-pi"))).unwrap()
}

#[tokio::test]
async fn last_strong_lease_stops_worker_but_subscription_does_not_keep_it_alive() {
    let session = spawn();
    let mut closed = session.closed();
    let _events = session.subscribe();
    let weak = Arc::downgrade(&session);
    let other = session.clone();
    drop(session);
    assert!(
        other
            .request(Command::GetState, Duration::from_secs(2))
            .await
            .unwrap()
            .success
    );
    drop(other);
    assert!(weak.upgrade().is_none());
    tokio::time::timeout(Duration::from_secs(5), closed.wait_for(|v| *v))
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn timeout_is_not_retried_and_does_not_poison_following_requests() {
    let session = spawn();
    assert!(
        session
            .request(
                Command::SetSessionName {
                    name: "never".into()
                },
                Duration::from_millis(50)
            )
            .await
            .is_err()
    );
    assert!(
        session
            .request(Command::GetState, Duration::from_secs(2))
            .await
            .unwrap()
            .success
    );
    let mut closed = session.closed();
    drop(session);
    closed.wait_for(|v| *v).await.unwrap();
}

#[tokio::test]
async fn child_exit_and_malformed_stdout_fail_pending_requests() {
    for name in ["crash", "malformed"] {
        let session = spawn();
        assert!(
            session
                .request(
                    Command::SetSessionName { name: name.into() },
                    Duration::from_secs(3)
                )
                .await
                .is_err()
        );
        let mut closed = session.closed();
        tokio::time::timeout(Duration::from_secs(4), closed.wait_for(|v| *v))
            .await
            .unwrap()
            .unwrap();
        assert!(
            session
                .request(Command::GetState, Duration::from_secs(1))
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn ui_reply_preserves_dialog_id_without_waiting_or_consuming_command_ids() {
    use ferropi_pi_rpc::{UiReply, UiResponse};
    let session = spawn();
    let mut events = session.subscribe();
    let before = session
        .request(Command::GetState, Duration::from_secs(2))
        .await
        .unwrap();
    tokio::time::timeout(
        Duration::from_millis(100),
        session.reply_ui(UiResponse {
            id: "native-dialog-id".into(),
            reply: UiReply::Value {
                value: "{\"choice\":0}".into(),
            },
        }),
    )
    .await
    .unwrap()
    .unwrap();
    let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(event.sequence, 1);
    assert_eq!(event.record["record"]["id"], "native-dialog-id");
    assert_eq!(event.record["record"]["type"], "extension_ui_response");
    let after = session
        .request(Command::GetState, Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(before.id, "ferropi-1");
    assert_eq!(after.id, "ferropi-2");
}
