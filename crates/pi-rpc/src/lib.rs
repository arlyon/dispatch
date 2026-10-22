//! Native Pi JSONL RPC. Pi owns persistence; this crate never edits session files.
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command as ProcessCommand,
    sync::{broadcast, mpsc, oneshot, watch},
};

/// The initial supported command surface; upstream message/event payloads stay lossless JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    GetState,
    GetMessages,
    GetEntries {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        since: Option<String>,
    },
    GetForkMessages,
    GetLastAssistantText,
    GetSessionStats,
    Prompt {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        streaming_behavior: Option<StreamingBehavior>,
    },
    Steer {
        message: String,
    },
    FollowUp {
        message: String,
    },
    Abort,
    ClearQueue,
    SetSessionName {
        name: String,
    },
    Fork {
        entry_id: String,
    },
    Clone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamingBehavior {
    Steer,
    FollowUp,
}

impl Command {
    /// These change the identity behind a mount; a broker must handle them explicitly.
    pub fn changes_session(&self) -> bool {
        matches!(self, Self::Fork { .. } | Self::Clone)
    }
}

/// Dialog replies are one-way records, not correlated RPC commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename = "extension_ui_response")]
pub struct UiResponse {
    pub id: String,
    #[serde(flatten)]
    pub reply: UiReply,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UiReply {
    Value { value: String },
    Cancelled { cancelled: bool },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Response {
    pub id: String,
    pub command: String,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub sequence: u64,
    pub record: Value,
}

type Reply = oneshot::Sender<std::result::Result<Response, String>>;
type Pending = Arc<Mutex<HashMap<String, Reply>>>;

/// A mount's strong reference is a lease. Worker tasks deliberately do not own one.
pub struct Session {
    pub pid: u32,
    commands: mpsc::Sender<Value>,
    events: broadcast::Sender<Event>,
    pending: Pending,
    next_id: AtomicU64,
    active: Arc<AtomicBool>,
    closed: watch::Receiver<bool>,
    shutdown: Option<oneshot::Sender<()>>,
}

impl Session {
    pub fn spawn(command: ProcessCommand) -> Result<Arc<Self>> {
        Self::spawn_guarded(command, ())
    }

    /// Hold a native-session ownership guard until the child has been reaped.
    pub fn spawn_guarded(
        mut command: ProcessCommand,
        guard: impl Send + 'static,
    ) -> Result<Arc<Self>> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .context("start Pi RPC")?;
        let pid = child.id().context("Pi has no process id")?;
        let mut stdin = child.stdin.take().context("missing Pi stdin")?;
        let stdout = child.stdout.take().context("missing Pi stdout")?;
        let (commands, mut commands_rx) = mpsc::channel::<Value>(64);
        let (events, _) = broadcast::channel(256);
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (closed_tx, closed) = watch::channel(false);
        let (shutdown, mut shutdown_rx) = oneshot::channel();
        let mut writer = tokio::spawn(async move {
            while let Some(record) = commands_rx.recv().await {
                let mut bytes = serde_json::to_vec(&record)?;
                bytes.push(b'\n');
                stdin.write_all(&bytes).await?;
                stdin.flush().await?;
            }
            stdin.shutdown().await?;
            Ok::<_, anyhow::Error>(())
        });
        let worker_events = events.clone();
        let worker_pending = pending.clone();
        let active = Arc::new(AtomicBool::new(false));
        let worker_active = active.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut sequence = 0;
            let mut writer_finished = false;
            let mut stopping = false;
            let mut deadline = tokio::time::Instant::now() + Duration::from_secs(3);
            let reason = loop {
                tokio::select! {
                    result = &mut writer, if !writer_finished => {
                        writer_finished = true;
                        match result {
                            Ok(Ok(())) => {},
                            other => break format!("Pi stdin writer stopped: {other:?}"),
                        }
                    }
                    _ = &mut shutdown_rx, if !stopping => {
                        stopping = true;
                        deadline = tokio::time::Instant::now() + Duration::from_secs(3);
                    }
                    _ = tokio::time::sleep_until(deadline), if stopping => {
                        break "Pi shutdown deadline exceeded".to_owned();
                    }
                    line = lines.next_line() => {
                        let line = match line {
                            Ok(Some(line)) => line,
                            Ok(None) => break "Pi stdout closed".to_owned(),
                            Err(error) => break format!("Pi stdout failed: {error}"),
                        };
                        let record: Value = match serde_json::from_str(&line) {
                            Ok(value) => value,
                            Err(error) => break format!("invalid Pi JSONL: {error}"),
                        };
                        if record.get("type").and_then(Value::as_str) == Some("response") {
                            if record["success"] == true
                                && matches!(record["command"].as_str(), Some("prompt" | "steer" | "follow_up"))
                                && matches!(record["data"]["disposition"].as_str(), Some("started" | "queued")) {
                                worker_active.store(true, Ordering::Release);
                            }
                            if let Some(id) = record.get("id").and_then(Value::as_str) {
                                let reply = worker_pending.lock().expect("pending mutex poisoned").remove(id);
                                if let Some(reply) = reply {
                                    let response = serde_json::from_value(record).map_err(|e| e.to_string());
                                    let _ = reply.send(response);
                                }
                            }
                        } else {
                            match record["type"].as_str() {
                                Some("agent_start") => worker_active.store(true, Ordering::Release),
                                Some("agent_settled") => worker_active.store(false, Ordering::Release),
                                _ => {},
                            }
                            sequence += 1;
                            let _ = worker_events.send(Event { sequence, record });
                        }
                    }
                }
            };
            writer.abort();
            if !writer_finished {
                let _ = writer.await;
            }
            // EOF requests orderly Pi shutdown. Bound the wait, then always reap.
            if tokio::time::timeout(Duration::from_secs(1), child.wait())
                .await
                .is_err()
            {
                let _ = child.kill().await;
            }
            for (_, reply) in worker_pending
                .lock()
                .expect("pending mutex poisoned")
                .drain()
            {
                let _ = reply.send(Err(reason.clone()));
            }
            sequence += 1;
            let _ = worker_events.send(Event {
                sequence,
                record: json!({"type":"ferropi_session_closed", "reason":reason}),
            });
            drop(guard);
            closed_tx.send_replace(true);
        });
        Ok(Arc::new(Self {
            pid,
            commands,
            events,
            pending,
            next_id: AtomicU64::new(1),
            active,
            closed,
            shutdown: Some(shutdown),
        }))
    }

    /// Subscribe before requesting state/messages so fast events aren't lost during hydration.
    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }
    pub fn closed(&self) -> watch::Receiver<bool> {
        self.closed.clone()
    }

    /// `agent_end` does not clear activity: retries can run until `agent_settled`.
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    pub async fn reply_ui(&self, response: UiResponse) -> Result<()> {
        if *self.closed.borrow() {
            bail!("Pi session is closed");
        }
        self.commands
            .send(serde_json::to_value(response)?)
            .await
            .context("Pi command writer closed")
    }

    pub async fn request(&self, command: Command, deadline: Duration) -> Result<Response> {
        if *self.closed.borrow() {
            bail!("Pi session is closed");
        }
        let id = format!("ferropi-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let mut record = serde_json::to_value(command)?;
        record["id"] = json!(id);
        let (send, receive) = oneshot::channel();
        self.pending
            .lock()
            .expect("pending mutex poisoned")
            .insert(id.clone(), send);
        let _cleanup = PendingGuard {
            id,
            pending: self.pending.clone(),
        };
        let request = async {
            self.commands
                .send(record)
                .await
                .context("Pi command writer closed")?;
            let response = receive
                .await
                .context("Pi response channel closed")?
                .map_err(anyhow::Error::msg)?;
            Ok::<_, anyhow::Error>(response)
        };
        tokio::time::timeout(deadline, request)
            .await
            .context("Pi command deadline exceeded; command may still execute")?
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

struct PendingGuard {
    id: String,
    pending: Pending,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.pending
            .lock()
            .expect("pending mutex poisoned")
            .remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_use_native_camel_case_fields() {
        assert_eq!(
            serde_json::to_value(Command::Fork {
                entry_id: "abc".into()
            })
            .unwrap(),
            json!({"type":"fork","entryId":"abc"})
        );
        assert_eq!(
            serde_json::to_value(Command::Prompt {
                message: "hello\u{2028}world".into(),
                streaming_behavior: Some(StreamingBehavior::FollowUp)
            })
            .unwrap()["streamingBehavior"],
            "followUp"
        );
    }
}
