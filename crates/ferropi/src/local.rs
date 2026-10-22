use anyhow::{Context, Result, bail};
use ferropi_pi_rpc::{Command, Session};
use futures_util::{FutureExt, StreamExt, stream::FuturesUnordered};
use kunobi_daemon::{
    ProcessLock,
    launch::{DaemonCommand, DaemonOutput},
    local::unix_socket::{self, Bound, SocketGuard},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex, Weak},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{
        UnixListener, UnixStream,
        unix::{OwnedReadHalf, OwnedWriteHalf},
    },
    sync::{Mutex, RwLock},
    task::JoinSet,
};

const GRACE: Duration = Duration::from_millis(500);
const SETUP: Duration = Duration::from_secs(10);

#[derive(Clone, Debug)]
pub struct Config {
    pub state_dir: PathBuf,
    pub pi: PathBuf,
    pub pi_args: Vec<String>,
    pub executable: PathBuf,
}
impl Config {
    pub fn socket(&self) -> PathBuf {
        self.state_dir.join("rpc.sock")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MountRequest {
    pub session: PathBuf,
    pub cwd: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pi_args: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Call {
    id: String,
    #[serde(flatten)]
    command: Command,
}

type Lease = (Arc<Session>, Arc<RwLock<()>>);

struct Entry {
    session: Weak<Session>,
    closed: tokio::sync::watch::Receiver<bool>,
    cwd: PathBuf,
    gate: Arc<RwLock<()>>,
    pi_args: Vec<String>,
}

fn session_lock(path: &Path) -> Result<ProcessLock> {
    let mut lock_path = path.as_os_str().to_owned();
    lock_path.push(".ferropi.lock");
    ProcessLock::try_acquire(PathBuf::from(lock_path))?
        .context("session is owned by another Ferropi daemon")
}

#[derive(Default)]
struct Manager {
    sessions: Mutex<HashMap<PathBuf, Entry>>,
}
impl Manager {
    async fn mount(&self, request: &MountRequest, config: &Config) -> Result<Lease> {
        let mut sessions = self.sessions.lock().await;
        if let Some(entry) = sessions.get_mut(&request.session) {
            if entry.cwd != request.cwd {
                bail!("session is already mounted with a different working directory");
            }
            if !*entry.closed.borrow() {
                if let Some(session) = entry.session.upgrade() {
                    if request
                        .pi_args
                        .as_ref()
                        .is_some_and(|args| args != &entry.pi_args)
                    {
                        bail!("session is already mounted with different Pi options");
                    }
                    return Ok((session, entry.gate.clone()));
                }
                // Last lease dropped, but EOF shutdown/reaping may still be in flight.
                entry.closed.wait_for(|closed| *closed).await?;
            }
        }
        let lock = session_lock(&request.session)?;
        let pi_args = request
            .pi_args
            .clone()
            .unwrap_or_else(|| config.pi_args.clone());
        let mut command = tokio::process::Command::new(&config.pi);
        command
            .args(&pi_args)
            .args(["--mode", "rpc", "--session"])
            .arg(&request.session)
            .current_dir(&request.cwd);
        let session = Session::spawn_guarded(command, lock)?;
        let gate = Arc::new(RwLock::new(()));
        sessions.insert(
            request.session.clone(),
            Entry {
                session: Arc::downgrade(&session),
                closed: session.closed(),
                cwd: request.cwd.clone(),
                gate: gate.clone(),
                pi_args,
            },
        );
        Ok((session, gate))
    }

    async fn fork(&self, source: &MountRequest, config: &Config) -> Result<(MountRequest, Lease)> {
        let (parent, gate) = self.mount(source, config).await?;
        // Prevent client mutations while native Pi reads the persisted source tree.
        let _snapshot = gate.write().await;
        let pi_args = self
            .sessions
            .lock()
            .await
            .get(&source.session)
            .context("fork source is not registered")?
            .pi_args
            .clone();
        let state = parent.request(Command::GetState, SETUP).await?;
        if !state.success {
            bail!("cannot inspect fork source: {:?}", state.error);
        }
        let state = state.data.context("Pi omitted source state")?;
        if parent.is_active()
            || state["isStreaming"] != false
            || state["isCompacting"] != false
            || state["pendingMessageCount"] != 0
        {
            bail!("source session is busy; wait for agent_settled before forking");
        }
        if !source.session.is_file() {
            bail!("source session has not been persisted by Pi yet");
        }
        // Pi chooses and writes its own new native file. Do not clone/switch the
        // shared subprocess or rewrite history ourselves.
        let owner = Arc::new(StdMutex::new(None::<ProcessLock>));
        let mut command = tokio::process::Command::new(&config.pi);
        command
            .args(&pi_args)
            .args(["--mode", "rpc", "--fork"])
            .arg(&source.session)
            .arg("--session-dir")
            .arg(
                source
                    .session
                    .parent()
                    .context("source has no parent directory")?,
            )
            .current_dir(&source.cwd);
        let session = Session::spawn_guarded(command, owner.clone())?;
        let response = session.request(Command::GetState, SETUP).await?;
        if !response.success {
            bail!("cannot inspect native fork: {:?}", response.error);
        }
        let state = response.data.context("Pi omitted fork state")?;
        let path = PathBuf::from(
            state["sessionFile"]
                .as_str()
                .context("Pi omitted fork sessionFile")?,
        );
        let mount = normalize_mount(MountRequest {
            session: path,
            cwd: source.cwd.clone(),
            pi_args: Some(pi_args.clone()),
        })?;
        if mount.session == source.session {
            bail!("Pi did not create a separate fork session");
        }
        *owner.lock().expect("ownership mutex poisoned") = Some(session_lock(&mount.session)?);
        let gate = Arc::new(RwLock::new(()));
        self.sessions.lock().await.insert(
            mount.session.clone(),
            Entry {
                session: Arc::downgrade(&session),
                closed: session.closed(),
                cwd: mount.cwd.clone(),
                gate: gate.clone(),
                pi_args,
            },
        );
        Ok((mount, (session, gate)))
    }

    async fn wait_closed(&self) {
        for entry in self.sessions.lock().await.values_mut() {
            let _ = entry.closed.wait_for(|closed| *closed).await;
        }
    }
}

/// Resolve aliases before registry lookup: two paths must not mean two Pi writers.
pub fn normalize_mount(request: MountRequest) -> Result<MountRequest> {
    let cwd = request
        .cwd
        .canonicalize()
        .context("resolve working directory")?;
    let path = if request.session.is_absolute() {
        request.session
    } else {
        cwd.join(request.session)
    };
    let session = if path.exists() {
        path.canonicalize()?
    } else {
        let parent = path
            .parent()
            .context("session requires a parent directory")?
            .canonicalize()
            .context("session parent must exist")?;
        parent.join(path.file_name().context("session requires a filename")?)
    };
    if session.extension().and_then(|s| s.to_str()) != Some("jsonl") {
        bail!("session must be a native Pi .jsonl file path");
    }
    Ok(MountRequest {
        session,
        cwd,
        pi_args: request.pi_args,
    })
}

pub async fn write_record(
    writer: &mut (impl tokio::io::AsyncWrite + Unpin),
    value: &Value,
) -> Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    tokio::time::timeout(SETUP, async {
        writer.write_all(&bytes).await?;
        writer.flush().await
    })
    .await
    .context("client write deadline")??;
    Ok(())
}

pub async fn read_record(
    reader: &mut (impl tokio::io::AsyncBufRead + Unpin),
) -> Result<Option<Value>> {
    let mut line = String::new();
    if reader.read_line(&mut line).await? == 0 {
        return Ok(None);
    }
    Ok(Some(
        serde_json::from_str(&line).context("invalid JSONL record")?,
    ))
}

async fn handle(stream: UnixStream, manager: Arc<Manager>, config: Config) -> Result<()> {
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);
    let mut request = tokio::time::timeout(SETUP, read_record(&mut reader))
        .await??
        .context("missing mount request")?;
    if request["type"] == "hello" {
        write_record(
            &mut write,
            &json!({"type":"hello", "protocol":1, "capabilities":["sessionPiArgs"]}),
        )
        .await?;
        request = tokio::time::timeout(SETUP, read_record(&mut reader))
            .await??
            .context("missing mount request")?;
    }
    let fork = match request["type"].as_str() {
        Some("mount") => false,
        Some("fork_mount") => true,
        _ => bail!("first record must be mount or fork_mount"),
    };
    let mount = normalize_mount(serde_json::from_value(request)?)?;
    let attached = if fork {
        manager.fork(&mount, &config).await
    } else {
        manager
            .mount(&mount, &config)
            .await
            .map(|lease| (mount, lease))
    };
    let (mount, (session, gate)) = match attached {
        Ok(attached) => attached,
        Err(error) => {
            write_record(
                &mut write,
                &json!({"type":"mount_error", "error":error.to_string()}),
            )
            .await?;
            return Ok(());
        }
    };
    let mut events = session.subscribe();
    write_record(&mut write, &json!({"type":"mounted", "daemonPid":std::process::id(), "piPid":session.pid, "session":mount.session, "cwd":mount.cwd})).await?;
    let mut pending = FuturesUnordered::new();
    // Lines::next_line is cancellation-safe across concurrent event delivery.
    let mut lines = reader.lines();
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Some(line) = line? else { break; };
                let call: Call = serde_json::from_str(&line)?;
                if call.command.changes_session() {
                    write_record(&mut write, &json!({"type":"response", "id":call.id, "success":false, "error":"use fork_mount; fork/clone must not change the identity of a shared mount"})).await?;
                    continue;
                }
                if pending.len() >= 64 { bail!("too many outstanding commands"); }
                let session = session.clone();
                let gate = gate.clone();
                pending.push(async move {
                    let _command = gate.read().await;
                    let mut value = match session.request(call.command, Duration::from_secs(30)).await {
                        Ok(response) => serde_json::to_value(response).expect("response is JSON"),
                        Err(error) => json!({"type":"response", "success":false, "error":error.to_string()}),
                    };
                    value["id"] = json!(call.id);
                    value
                }.boxed());
            }
            Some(response) = pending.next(), if !pending.is_empty() => {
                write_record(&mut write, &response).await?;
            }
            event = events.recv() => {
                // Lag is an explicit disconnect, never silent loss or Pi stdout backpressure.
                let event = event.context("event stream lost; remount and hydrate state/messages")?;
                write_record(&mut write, &json!({"type":"event", "sequence":event.sequence, "record":event.record})).await?;
                if event.record["type"] == "ferropi_session_closed" { break; }
            }
        }
    }
    Ok(())
}

/// Endpoint acquisition, stale recovery and cleanup are provided by kunobi-daemon.
/// The service owns weak client leases; each socket-handler task owns its lease.
pub async fn serve(config: Config) -> Result<()> {
    unix_socket::ensure_private_dir(&config.state_dir)?;
    let Some(_ownership) = ProcessLock::try_acquire(config.state_dir.join("owner.lock"))? else {
        return Ok(());
    };
    let socket = config.socket();
    let Bound::Won(listener) =
        unix_socket::acquire(&socket).map_err(|e| anyhow::anyhow!("bind daemon: {e:?}"))?
    else {
        return Ok(());
    };
    let _cleanup = SocketGuard::capture(&socket)?;
    listener.set_nonblocking(true)?;
    let listener = UnixListener::from_std(listener)?;
    let manager = Arc::new(Manager::default());
    let mut clients: Vec<Weak<()>> = Vec::new();
    let mut handlers = JoinSet::new();
    let mut deadline = tokio::time::Instant::now() + SETUP;
    loop {
        clients.retain(|client| client.upgrade().is_some());
        tokio::select! {
            connection = listener.accept() => {
                let (stream, _) = connection?;
                let lease = Arc::new(());
                clients.push(Arc::downgrade(&lease));
                let manager = manager.clone();
                let config = config.clone();
                handlers.spawn(async move {
                    let _lease = lease;
                    if let Err(error) = handle(stream, manager, config).await { eprintln!("client disconnected: {error:#}"); }
                });
            }
            Some(result) = handlers.join_next(), if !handlers.is_empty() => {
                if let Err(error) = result { eprintln!("client task failed: {error}"); }
                deadline = tokio::time::Instant::now() + GRACE;
            }
            _ = tokio::time::sleep_until(deadline), if clients.is_empty() => break,
        }
    }
    // Keep singleton ownership until every Pi has closed stdin and been reaped.
    manager.wait_closed().await;
    Ok(())
}

/// Connect first. Only transient absence permits starting a detached singleton.
async fn discover(config: &Config) -> Result<UnixStream> {
    match UnixStream::connect(config.socket()).await {
        Ok(stream) => return Ok(stream),
        Err(error) if kunobi_daemon::local::is_transient(&error) => {}
        Err(error) => return Err(error.into()),
    }
    let config = config.clone();
    let socket = config.socket();
    let spawned = tokio::task::spawn_blocking(move || -> Result<_> {
        unix_socket::ensure_private_dir(&config.state_dir)?;
        let lock = ProcessLock::acquire_private_until(
            config.state_dir.join("start.lock"),
            std::time::Instant::now() + SETUP,
        )?
        .context("daemon startup lock deadline")?;
        // Another starter may already have bound while we waited for the lock.
        if std::os::unix::net::UnixStream::connect(config.socket()).is_ok() {
            return Ok((lock, None));
        }
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(config.state_dir.join("daemon.log"))?;
        let mut command = DaemonCommand::new(&config.executable);
        command
            .arg("__serve")
            .arg("--state-dir")
            .arg(&config.state_dir)
            .arg("--pi")
            .arg(&config.pi)
            .stderr(DaemonOutput::File(log));
        let child = command.spawn().context("launch Ferropi daemon")?;
        Ok((lock, Some(child)))
    })
    .await??;
    // Hold the crate's start lock through successful endpoint discovery.
    let deadline = tokio::time::Instant::now() + SETUP;
    let stream = loop {
        match UnixStream::connect(&socket).await {
            Ok(stream) => break stream,
            Err(error)
                if kunobi_daemon::local::is_transient(&error)
                    && tokio::time::Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(25)).await
            }
            Err(error) => {
                return Err(error).context("daemon did not become reachable; inspect daemon.log");
            }
        }
    };
    drop(spawned);
    Ok(stream)
}

pub struct Client {
    pub reader: BufReader<OwnedReadHalf>,
    pub writer: OwnedWriteHalf,
    pub mounted: Value,
}
impl Client {
    pub async fn mount(config: &Config, request: MountRequest) -> Result<Self> {
        Self::attach(config, request, "mount").await
    }

    /// Fork the persisted native session tree without changing existing mounts.
    pub async fn fork(config: &Config, source: MountRequest) -> Result<Self> {
        Self::attach(config, source, "fork_mount").await
    }

    async fn attach(config: &Config, request: MountRequest, operation: &str) -> Result<Self> {
        let mut mount = normalize_mount(request)?;
        if mount.pi_args.is_none() && !config.pi_args.is_empty() {
            mount.pi_args = Some(config.pi_args.clone());
        }
        let stream = discover(config).await?;
        let (read, mut writer) = stream.into_split();
        let mut reader = BufReader::new(read);
        // Negotiate before mounting: an old daemon must not start Pi with the wrong tools.
        write_record(&mut writer, &json!({"type":"hello"})).await?;
        let hello = tokio::time::timeout(SETUP, read_record(&mut reader))
            .await??
            .context("incompatible Ferropi daemon; detach existing clients so it can restart")?;
        if hello["type"] != "hello"
            || hello["protocol"] != 1
            || !hello["capabilities"]
                .as_array()
                .is_some_and(|items| items.contains(&json!("sessionPiArgs")))
        {
            bail!(
                "Ferropi daemon does not support session-scoped Pi options; restart it before mounting"
            );
        }
        let mut request = serde_json::to_value(mount)?;
        request["type"] = json!(operation);
        write_record(&mut writer, &request).await?;
        let mounted = tokio::time::timeout(SETUP, read_record(&mut reader))
            .await??
            .context("daemon disconnected during mount; inspect daemon.log")?;
        if mounted["type"] != "mounted" {
            bail!("daemon rejected mount: {mounted}");
        }
        Ok(Self {
            reader,
            writer,
            mounted,
        })
    }
}
