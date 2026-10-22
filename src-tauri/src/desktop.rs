//! One resident tray owns the review agents, checkpoints and idle timer. The
//! GUI is a separate process: it can release WebKit without losing that state.
use crate::{
    agents::{AgentState, Agents},
    desktop_ipc::*,
    desktop_policy::{HIDDEN_LIFETIME, Lifetime},
    reviews,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::BufReader,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Listener, Manager};
use tauri_plugin_notification::NotificationExt;

struct GuiLink {
    bootstrap: Mutex<Bootstrap>,
    ready: AtomicBool,
    quit_requested: AtomicBool,
    quit_allowed: AtomicBool,
    pending_exit: Mutex<Option<(u64, u64)>>,
    next_rpc: AtomicU64,
    replies: Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Result<Value>>>>,
}
impl GuiLink {
    fn send(&self, message: &GuiEvent) -> Result<()> {
        write_frame(&mut std::io::stdout().lock(), message)
    }
}
pub fn is_gui(app: &tauri::AppHandle) -> bool {
    app.try_state::<GuiLink>().is_some()
}
pub(crate) async fn rpc<T: DeserializeOwned>(app: &tauri::AppHandle, request: Rpc) -> Result<T> {
    let link = app.state::<GuiLink>();
    let id = link.next_rpc.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    link.replies
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, sender);
    if let Err(error) = link.send(&GuiEvent::Rpc { id, request }) {
        link.replies.lock().map_err(|e| e.to_string())?.remove(&id);
        return Err(error);
    }
    let result = tokio::time::timeout(Duration::from_secs(15), receiver).await;
    link.replies.lock().map_err(|e| e.to_string())?.remove(&id);
    let value = result
        .map_err(|_| "Desktop service did not reply")?
        .map_err(|_| "Desktop service disconnected")??;
    serde_json::from_value(value).map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn desktop_bootstrap(app: tauri::AppHandle) -> Result<Bootstrap> {
    Ok(app
        .state::<GuiLink>()
        .bootstrap
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}
fn show_gui(app: &tauri::AppHandle) -> Result<()> {
    let link = app.state::<GuiLink>();
    // A local reopen can race the resident's already-sent disposal command.
    // Invalidate its acknowledgement before making editable state visible.
    *link.pending_exit.lock().map_err(|e| e.to_string())? = None;
    if link.ready.load(Ordering::Acquire) {
        let window = app
            .get_webview_window("main")
            .ok_or("Review window is unavailable")?;
        window.show().map_err(|e| e.to_string())?;
        if let Err(error) = window.set_focus() {
            eprintln!("Window manager declined focus: {error}");
        }
        link.send(&GuiEvent::Shown)?;
        app.emit("desktop-visibility", true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn desktop_ready(app: tauri::AppHandle) -> Result<()> {
    let link = app.state::<GuiLink>();
    link.ready.store(true, Ordering::Release);
    link.send(&GuiEvent::Ready)?;
    show_gui(&app)?;
    if link.quit_requested.load(Ordering::Acquire) {
        app.emit("desktop-quit", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn desktop_hide(app: tauri::AppHandle, checkpoint: Checkpoint) -> Result<()> {
    checkpoint.validate()?;
    let link = app.state::<GuiLink>();
    // Sending first guarantees a failed checkpoint never hides the only copy.
    link.send(&GuiEvent::Hidden { checkpoint })?;
    let window = app
        .get_webview_window("main")
        .ok_or("Review window is unavailable")?;
    if let Err(error) = window.hide() {
        link.send(&GuiEvent::Shown)?;
        return Err(error.to_string());
    }
    app.emit("desktop-visibility", false)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn desktop_checkpoint(
    app: tauri::AppHandle,
    checkpoint: Checkpoint,
    token: Option<u64>,
) -> Result<()> {
    checkpoint.validate()?;
    let link = app.state::<GuiLink>();
    if let Some(token) = token {
        *link.pending_exit.lock().map_err(|e| e.to_string())? = Some((token, checkpoint.revision));
        link.send(&GuiEvent::Checkpoint { token, checkpoint })
    } else {
        link.send(&GuiEvent::Latest { checkpoint })
    }
}
#[tauri::command]
pub(crate) fn desktop_checkpoint_failed(
    app: tauri::AppHandle,
    token: u64,
    error: String,
) -> Result<()> {
    app.state::<GuiLink>()
        .send(&GuiEvent::CheckpointFailed { token, error })
}
#[tauri::command]
pub(crate) fn desktop_quit(app: tauri::AppHandle, checkpoint: Option<Checkpoint>) -> Result<()> {
    let link = app.state::<GuiLink>();
    if let Some(checkpoint) = checkpoint {
        checkpoint.validate()?;
        if checkpoint.has_feedback {
            return Err("Unsubmitted feedback prevents quitting".into());
        }
        link.quit_allowed.store(true, Ordering::Release);
        link.send(&GuiEvent::QuitConfirmed { checkpoint })
    } else {
        link.quit_requested.store(false, Ordering::Release);
        link.send(&GuiEvent::QuitCancelled)
    }
}

struct Gui {
    child: Child,
    input: ChildStdin,
    generation: u64,
    lifetime: Lifetime,
    focused: bool,
}
impl Gui {
    fn send(&mut self, message: GuiCommand) -> Result<()> {
        write_frame(&mut self.input, &message)
    }
}
enum Event {
    Activate(Activation, Option<mpsc::Sender<Result<()>>>),
    Gui(u64, GuiEvent),
    TransportError(u64, String),
    Reply(u64, u64, Result<Value>),
    Agent(AgentState),
    Show,
    Hide,
    Quit,
}
struct Controller {
    app: tauri::AppHandle,
    root: PathBuf,
    executable: PathBuf,
    sender: mpsc::Sender<Event>,
    gui: Option<Gui>,
    generation: u64,
    checkpoint: Option<Checkpoint>,
    pending_show: Option<Option<String>>,
    pending_quit: bool,
    shutting_down: bool,
    known: HashSet<String>,
    announced: HashSet<String>,
    attention: bool,
    #[cfg(not(target_os = "macos"))]
    tray_attention: bool,
    #[cfg(target_os = "macos")]
    indicator: crate::tray_indicator::TrayIndicator,
}
fn queue_ids(root: &Path) -> Result<HashSet<String>> {
    let mut ids = HashSet::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if uuid::Uuid::parse_str(&id).is_ok() && entry.path().join("request.json").is_file() {
            ids.insert(id);
        }
    }
    Ok(ids)
}
#[cfg(any(target_os = "macos", test))]
fn outstanding_count(root: &Path, ids: &HashSet<String>) -> usize {
    ids.iter()
        .filter(|id| !root.join(id).join("result.json").exists())
        .count()
}
impl Controller {
    #[cfg(target_os = "macos")]
    fn update_tray(&mut self) -> Result<()> {
        if let Some(icon) = self.indicator.frame(self.attention, Instant::now()) {
            self.app
                .tray_by_id("dispatch")
                .ok_or("Dispatch tray is unavailable")?
                .set_icon_with_as_template(Some(icon), !self.attention)
                .map_err(|error| format!("Tray indicator could not be updated: {error}"))?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    fn update_tray(&mut self) -> Result<()> {
        if self.attention != self.tray_attention {
            // One update per state transition; never an animation timer or an
            // automatic retry loop if the native tray rejects an update.
            self.tray_attention = self.attention;
            let icon = if self.attention {
                #[cfg(target_os = "macos")]
                let attention = tauri::include_image!("icons/tray-macos-attention.png");
                #[cfg(not(target_os = "macos"))]
                let attention = tauri::include_image!("icons/tray-attention.png");
                attention
            } else {
                #[cfg(target_os = "macos")]
                let idle = tauri::include_image!("icons/tray-template.png");
                #[cfg(not(target_os = "macos"))]
                let idle = tauri::include_image!("icons/tray.png");
                idle
            };
            let tray = self
                .app
                .tray_by_id("dispatch")
                .ok_or("Dispatch tray is unavailable")?;
            // AppKit tints the idle alpha mask for light/dark menu bars. The
            // attention artwork is full colour so its pink-red badge survives.
            // Change both atomically: two separate calls visibly flash on macOS.
            tray.set_icon_with_as_template(
                Some(icon),
                cfg!(target_os = "macos") && !self.attention,
            )
            .map_err(|error| format!("Tray indicator could not be updated: {error}"))?;
        }
        Ok(())
    }
    fn notify(&self, title: &str, body: &str) {
        if let Err(error) = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
        {
            eprintln!("Dispatch notification: {error}");
        }
    }
    fn error(&mut self, message: String) {
        eprintln!("Dispatch desktop: {message}");
        if let Some(gui) = &mut self.gui {
            let _ = gui.send(GuiCommand::Error {
                message: message.clone(),
            });
        }
        self.notify("Dispatch needs attention", &message);
    }
    fn show(&mut self, review: Option<String>) -> Result<()> {
        if let Some(gui) = &mut self.gui {
            if gui.lifetime.exiting {
                self.pending_show = Some(review);
            } else {
                gui.lifetime.shown();
                gui.send(GuiCommand::Show { review })?;
            }
            return Ok(());
        }
        self.generation += 1;
        let generation = self.generation;
        let mut child = Command::new(&self.executable)
            .arg("--gui")
            .env("DISPATCH_GUI_CHILD", "1")
            .env("DISPATCH_REVIEW_DIR", &self.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Cannot start review window: {e}"))?;
        let mut input = child.stdin.take().ok_or("Missing GUI input pipe")?;
        let output = child.stdout.take().ok_or("Missing GUI output pipe")?;
        let bootstrap = Bootstrap {
            checkpoint: self.checkpoint.clone(),
            review,
        };
        if let Err(error) = write_frame(&mut input, &bootstrap) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        self.gui = Some(Gui {
            child,
            input,
            generation,
            lifetime: Lifetime::default(),
            focused: false,
        });
        let sender = self.sender.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                match read_frame(&mut reader) {
                    Ok(event) => {
                        if sender.send(Event::Gui(generation, event)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Event::TransportError(generation, error));
                        break;
                    }
                }
            }
        });
        Ok(())
    }
    fn accept_checkpoint(&mut self, checkpoint: Checkpoint) -> Result<()> {
        checkpoint.validate()?;
        if self
            .checkpoint
            .as_ref()
            .is_none_or(|old| old.revision <= checkpoint.revision)
        {
            self.checkpoint = Some(checkpoint);
        }
        Ok(())
    }
    fn arrival(&mut self, id: &str, notify: bool) -> Result<()> {
        if !self.announced.insert(id.into()) {
            return Ok(());
        }
        let request = reviews::read_request(&self.root, id)?;
        if notify
            && reviews::result(&self.root, id)?.is_none()
            && self
                .gui
                .as_ref()
                .is_none_or(|gui| gui.lifetime.is_hidden() || !gui.focused)
        {
            self.attention = true;
            self.notify("New review in Dispatch", &request.title);
        }
        if let Some(gui) = &mut self.gui {
            gui.send(GuiCommand::QueueChanged)?;
        }
        Ok(())
    }
    fn activation(&mut self, activation: Activation) -> Result<()> {
        activation.validate()?;
        if let Some(id) = &activation.review {
            reviews::read_request(&self.root, id)?;
            self.known.insert(id.clone());
            self.arrival(id, activation.background)?;
        }
        if !activation.background {
            self.show(activation.review)?;
        }
        Ok(())
    }
    fn quit(&mut self) -> Result<()> {
        if self.gui.is_none()
            && self
                .checkpoint
                .as_ref()
                .is_none_or(|saved| !saved.has_feedback)
        {
            self.app.exit(0);
            return Ok(());
        }
        self.pending_quit = true;
        self.show(None)?;
        if let Some(gui) = &mut self.gui {
            gui.send(GuiCommand::Quit)?;
        }
        Ok(())
    }
    fn gui_event(&mut self, generation: u64, event: GuiEvent) -> Result<()> {
        if self
            .gui
            .as_ref()
            .is_none_or(|gui| gui.generation != generation)
        {
            return Ok(());
        }
        match event {
            GuiEvent::Ready => {
                if self.pending_quit {
                    self.gui.as_mut().unwrap().send(GuiCommand::Quit)?;
                }
            }
            GuiEvent::Shown => {
                self.gui.as_mut().unwrap().lifetime.shown();
                self.attention = false;
                if let Some(review) = self.pending_show.take() {
                    self.show(review)?;
                }
            }
            GuiEvent::Focused { focused } => self.gui.as_mut().unwrap().focused = focused,
            GuiEvent::Hidden { checkpoint } => {
                self.accept_checkpoint(checkpoint)?;
                let gui = self.gui.as_mut().unwrap();
                gui.focused = false;
                gui.lifetime.hidden(Instant::now());
            }
            GuiEvent::Latest { checkpoint } => self.accept_checkpoint(checkpoint)?,
            GuiEvent::Checkpoint { token, checkpoint } => {
                self.accept_checkpoint(checkpoint)?;
                let revision = self.checkpoint.as_ref().unwrap().revision;
                let gui = self.gui.as_mut().unwrap();
                if gui.lifetime.acknowledge(token) {
                    gui.send(GuiCommand::Exit { token, revision })?;
                }
            }
            GuiEvent::CheckpointFailed { token, error } => {
                self.gui.as_mut().unwrap().lifetime.failed(token);
                self.error(format!("Kept the review window in memory: {error}"));
            }
            GuiEvent::QuitCancelled => self.pending_quit = false,
            GuiEvent::QuitConfirmed { checkpoint } => {
                if !self.pending_quit || checkpoint.has_feedback {
                    return Err("Unsubmitted feedback prevents quitting".into());
                }
                self.accept_checkpoint(checkpoint)?;
                self.shutting_down = true;
                self.gui.as_mut().unwrap().send(GuiCommand::QuitExit)?;
            }
            GuiEvent::Rpc {
                id,
                request: Rpc::ListAgents,
            } => {
                let result = serde_json::to_value(self.app.state::<Agents>().snapshots())
                    .map_err(|e| e.to_string());
                self.gui
                    .as_mut()
                    .unwrap()
                    .send(GuiCommand::Reply { id, result })?;
            }
            GuiEvent::Rpc {
                id,
                request: Rpc::StartAgent { id: review },
            } => {
                let app = self.app.clone();
                let sender = self.sender.clone();
                tauri::async_runtime::spawn(async move {
                    let result =
                        super::start_review_agent(app.clone(), review, app.state::<Agents>())
                            .await
                            .and_then(|state| {
                                serde_json::to_value(state).map_err(|e| e.to_string())
                            });
                    let _ = sender.send(Event::Reply(generation, id, result));
                });
            }
        }
        Ok(())
    }
    fn tick(&mut self) -> Result<()> {
        let mut stalled = false;
        if let Some(gui) = &mut self.gui {
            if let Some(status) = gui.child.try_wait().map_err(|e| e.to_string())? {
                self.gui = None;
                if self.shutting_down {
                    self.app.exit(0);
                    return Ok(());
                }
                if !status.success() {
                    self.error(format!("Review window exited ({status}); its latest acknowledged checkpoint is retained."));
                }
                if let Some(review) = self.pending_show.take() {
                    self.show(review)?;
                }
            } else if gui.lifetime.checkpoint_timed_out(Instant::now()) {
                stalled = true;
            } else if let Some(token) = gui.lifetime.poll(Instant::now(), hidden_lifetime()) {
                gui.send(GuiCommand::Checkpoint { token })?;
            }
        }
        if stalled {
            self.error("Kept the review window in memory because its draft checkpoint did not reply. Reopen Dispatch to inspect it.".into());
        }
        self.update_tray()
    }
}
fn hidden_lifetime() -> Duration {
    #[cfg(debug_assertions)]
    if let Ok(seconds) = std::env::var("DISPATCH_TEST_IDLE_SECONDS")
        && let Ok(seconds @ 1..=1800) = seconds.parse::<u64>()
    {
        return Duration::from_secs(seconds);
    }
    HIDDEN_LIFETIME
}
fn run_controller(mut controller: Controller, receiver: mpsc::Receiver<Event>) {
    let mut last_scan = Instant::now();
    loop {
        #[cfg(target_os = "macos")]
        let animating = controller.indicator.animating();
        #[cfg(not(target_os = "macos"))]
        let animating = false;
        let wait = Duration::from_millis(if animating { 16 } else { 100 });
        let result = match receiver.recv_timeout(wait) {
            Ok(Event::Activate(activation, reply)) => {
                let result = controller.activation(activation);
                if let Some(reply) = reply {
                    let _ = reply.send(result.clone());
                }
                result
            }
            Ok(Event::Show) => controller.show(None),
            Ok(Event::Hide) => controller
                .gui
                .as_mut()
                .map_or(Ok(()), |gui| gui.send(GuiCommand::Hide)),
            Ok(Event::Quit) => controller.quit(),
            Ok(Event::Gui(generation, event)) => controller.gui_event(generation, event),
            Ok(Event::Reply(generation, id, result)) => {
                if let Some(gui) = &mut controller.gui
                    && gui.generation == generation
                {
                    gui.send(GuiCommand::Reply { id, result })
                } else {
                    Ok(())
                }
            }
            Ok(Event::Agent(state)) => controller
                .gui
                .as_mut()
                .map_or(Ok(()), |gui| gui.send(GuiCommand::Agent { state })),
            Ok(Event::TransportError(generation, error)) => {
                // EOF normally precedes try_wait by a few milliseconds. Only a
                // still-running GUI with a broken control pipe needs attention.
                if let Some(gui) = &mut controller.gui
                    && gui.generation == generation
                    && gui.child.try_wait().ok().flatten().is_none()
                {
                    eprintln!("Dispatch GUI control channel: {error}");
                }
                Ok(())
            }
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(()),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if let Err(error) = result {
            controller.error(error);
        }
        if let Err(error) = controller.tick() {
            controller.error(error);
        }
        if last_scan.elapsed() >= Duration::from_secs(1) {
            match queue_ids(&controller.root) {
                Ok(ids) => {
                    #[cfg(target_os = "macos")]
                    {
                        let count = outstanding_count(&controller.root, &ids);
                        controller.indicator.set_count(count, Instant::now());
                        if let Some(tray) = controller.app.tray_by_id("dispatch") {
                            let tooltip = format!("Dispatch — {count} outstanding reviews");
                            let _ = tray.set_tooltip(Some(tooltip));
                        }
                    }
                    for id in ids
                        .difference(&controller.known)
                        .cloned()
                        .collect::<Vec<_>>()
                    {
                        controller.known.insert(id.clone());
                        if let Err(error) = controller.arrival(&id, true) {
                            controller.error(error);
                        }
                    }
                }
                Err(error) => eprintln!("Dispatch queue watcher: {error}"),
            }
            last_scan = Instant::now();
        }
    }
}
fn receive_gui_command(app: &tauri::AppHandle, command: GuiCommand) -> Result<()> {
    let link = app.state::<GuiLink>();
    match command {
        GuiCommand::Show { review } => {
            if let Some(id) = &review {
                link.bootstrap.lock().map_err(|e| e.to_string())?.review = Some(id.clone());
            }
            show_gui(app)?;
            app.emit("desktop-open-review", review)
                .map_err(|e| e.to_string())?;
        }
        GuiCommand::Hide => {
            app.emit("desktop-hide", ()).map_err(|e| e.to_string())?;
        }
        GuiCommand::QueueChanged => {
            app.emit("desktop-queue-changed", ())
                .map_err(|e| e.to_string())?;
        }
        GuiCommand::Checkpoint { token } => {
            app.emit("desktop-checkpoint", token)
                .map_err(|e| e.to_string())?;
        }
        GuiCommand::Exit { token, revision } => {
            if link
                .pending_exit
                .lock()
                .map_err(|e| e.to_string())?
                .is_some_and(|(pending, saved)| pending == token && revision >= saved)
            {
                app.exit(0);
            } else {
                return Err("Refusing unacknowledged GUI disposal".into());
            }
        }
        GuiCommand::Quit => {
            link.quit_requested.store(true, Ordering::Release);
            show_gui(app)?;
            if link.ready.load(Ordering::Acquire) {
                app.emit("desktop-quit", ()).map_err(|e| e.to_string())?;
            }
        }
        GuiCommand::QuitExit => {
            if link.quit_allowed.load(Ordering::Acquire) {
                app.exit(0);
            }
        }
        GuiCommand::Agent { state } => {
            app.emit("review-agent", state).map_err(|e| e.to_string())?;
        }
        GuiCommand::Reply { id, result } => {
            if let Some(sender) = link.replies.lock().map_err(|e| e.to_string())?.remove(&id) {
                let _ = sender.send(result);
            }
        }
        GuiCommand::Error { message } => {
            app.emit("desktop-error", message)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn run_gui(
    builder: tauri::Builder<tauri::Wry>,
    mut context: tauri::Context<tauri::Wry>,
) -> Result<()> {
    let bootstrap: Bootstrap = read_frame(&mut std::io::stdin().lock())?;
    if let Some(checkpoint) = &bootstrap.checkpoint {
        checkpoint.validate()?;
    }
    for window in &mut context.config_mut().app.windows {
        window.visible = false;
    }
    let app = builder.manage(GuiLink {
        bootstrap: Mutex::new(bootstrap), ready: AtomicBool::new(false),
        quit_requested: AtomicBool::new(false), quit_allowed: AtomicBool::new(false),
        pending_exit: Mutex::new(None), next_rpc: AtomicU64::new(1), replies: Mutex::new(HashMap::new()),
    }).setup(|app| {
        // Discovery and checkout belong to this GUI process, not a second tray poller.
        app.state::<crate::github::GitHub>().start();
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            let mut reader = std::io::stdin().lock();
            loop {
                match read_frame(&mut reader) {
                    Ok(command) => {
                        let app = handle.clone();
                        let _ = handle.run_on_main_thread(move || {
                            if let Err(error) = receive_gui_command(&app, command) { eprintln!("Dispatch GUI: {error}"); }
                        });
                    }
                    Err(error) => {
                        for (_, sender) in handle.state::<GuiLink>().replies.lock().unwrap().drain() {
                            let _ = sender.send(Err("Resident desktop service disconnected".into()));
                        }
                        let app = handle.clone();
                        let _ = handle.run_on_main_thread(move || {
                            let _ = show_gui(&app);
                            let _ = app.emit("desktop-error", format!("Desktop service disconnected. Keep this window open to preserve drafts: {error}"));
                        });
                        break;
                    }
                }
            }
        });
        Ok(())
    }).on_window_event(|window, event| {
        if let tauri::WindowEvent::Focused(focused) = event {
            let _ = window.state::<GuiLink>().send(&GuiEvent::Focused { focused: *focused });
        }
    }).build(context).map_err(|e| e.to_string())?;
    app.run(|_app, _event| {
        if matches!(_event, tauri::RunEvent::Exit) {
            _app.state::<crate::github::GitHub>().stop();
            _app.state::<crate::quiz::Quizzes>().stop_all();
        }
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            let _ = show_gui(_app);
        }
    });
    Ok(())
}
fn run_resident(
    builder: tauri::Builder<tauri::Wry>,
    mut context: tauri::Context<tauri::Wry>,
    instance: Instance,
    root: PathBuf,
    initial: Activation,
) -> Result<()> {
    context.config_mut().app.windows.clear();
    let listener = instance.listener.try_clone().map_err(|e| e.to_string())?;
    let known = queue_ids(&root)?;
    let (sender, receiver) = mpsc::channel();
    let reopen = sender.clone();
    let app = builder
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let open = MenuItem::with_id(app, "show", "Open Dispatch", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide review window", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Dispatch", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &hide, &quit])?;
            let menu_sender = sender.clone();
            #[cfg(target_os = "macos")]
            let tray_icon = tauri::include_image!("icons/tray-template.png");
            #[cfg(not(target_os = "macos"))]
            let tray_icon = tauri::include_image!("icons/tray.png");
            TrayIconBuilder::with_id("dispatch")
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Dispatch review inbox")
                .menu(&menu)
                .on_menu_event(move |_, item| {
                    let event = match item.id.as_ref() {
                        "show" => Event::Show,
                        "hide" => Event::Hide,
                        "quit" => Event::Quit,
                        _ => return,
                    };
                    let _ = menu_sender.send(event);
                })
                .build(app)?;
            let agent_sender = sender.clone();
            app.listen("review-agent", move |event| {
                if let Ok(state) = serde_json::from_str(event.payload()) {
                    let _ = agent_sender.send(Event::Agent(state));
                }
            });
            let connection_sender = sender.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else {
                        break;
                    };
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    let result = read_frame::<Activation>(&mut BufReader::new(&mut stream))
                        .and_then(|activation| {
                            activation.validate()?;
                            let (reply, received) = mpsc::channel();
                            connection_sender
                                .send(Event::Activate(activation, Some(reply)))
                                .map_err(|e| e.to_string())?;
                            received
                                .recv_timeout(Duration::from_secs(3))
                                .map_err(|e| e.to_string())?
                        });
                    let _ = write_frame(&mut stream, &result);
                }
            });
            #[cfg(target_os = "macos")]
            let indicator = {
                let mut indicator = crate::tray_indicator::TrayIndicator::default();
                indicator.set_count(outstanding_count(&root, &known), Instant::now());
                indicator
            };
            let controller = Controller {
                app: app.handle().clone(),
                root,
                executable: std::env::current_exe()?,
                sender: sender.clone(),
                gui: None,
                generation: 0,
                checkpoint: None,
                pending_show: None,
                pending_quit: false,
                shutting_down: false,
                known,
                announced: HashSet::new(),
                attention: false,
                #[cfg(not(target_os = "macos"))]
                tray_attention: false,
                #[cfg(target_os = "macos")]
                indicator,
            };
            sender.send(Event::Activate(initial, None))?;
            std::thread::spawn(move || run_controller(controller, receiver));
            Ok(())
        })
        .build(context)
        .map_err(|e| e.to_string())?;
    app.run(move |app, event| match event {
        tauri::RunEvent::ExitRequested {
            api, code: None, ..
        } => api.prevent_exit(),
        tauri::RunEvent::Exit => {
            app.state::<Agents>().stop_all();
            app.state::<crate::github::GitHub>().stop();
            // Tauri may terminate the process rather than unwind run(). Do not
            // rely on Drop alone to remove the private control socket.
            if let Err(error) = instance.cleanup() {
                eprintln!("Dispatch cleanup: {error}");
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            let _ = reopen.send(Event::Show);
        }
        _ => {
            let _ = &reopen;
        }
    });
    Ok(())
}
fn parse_args(args: &[String]) -> Result<Activation> {
    let mut activation = Activation::default();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bg" if !activation.background => activation.background = true,
            "--review" if activation.review.is_none() => {
                activation.review =
                    Some(args.next().ok_or("--review requires a review id")?.clone())
            }
            _ => return Err(format!("Unknown or repeated Dispatch option: {arg}")),
        }
    }
    activation.validate()?;
    Ok(activation)
}
pub(crate) fn run(
    builder: tauri::Builder<tauri::Wry>,
    context: tauri::Context<tauri::Wry>,
) -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--gui"] {
        if std::env::var("DISPATCH_GUI_CHILD").as_deref() != Ok("1") {
            return Err("--gui is an internal launch mode".into());
        }
        return run_gui(builder, context);
    }
    let activation = parse_args(&args)?;
    let root = reviews::root()?;
    reviews::ensure_root(&root)?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if activate(&root, &activation).is_ok() {
        return Ok(());
    }
    if let Some(instance) = Instance::acquire(&root)? {
        return run_resident(builder, context, instance, root, activation);
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
        if activate(&root, &activation).is_ok() {
            return Ok(());
        }
    }
    Err("Dispatch is already running, but its private desktop service did not respond".into())
}
/// Delivery is best effort after publication: GUI failure must not undo or
/// duplicate an immutable review request. The CLI reports failures on stderr.
pub fn deliver(id: &str, background: bool) -> Result<()> {
    let root = reviews::root()?;
    reviews::ensure_root(&root)?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let activation = Activation {
        review: Some(id.into()),
        background,
    };
    activation.validate()?;
    if activate(&root, &activation).is_ok() {
        return Ok(());
    }
    let executable = std::env::var_os("DISPATCH_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(|dir| dir.join("dispatch")))
                .filter(|path| path.is_file())
                .unwrap_or_else(|| "dispatch".into())
        });
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(root.join("desktop.log"))
        .map_err(|e| e.to_string())?;
    let mut command = Command::new(executable);
    command
        .args(["--review", id])
        .env("DISPATCH_REVIEW_DIR", root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log);
    if background {
        command.arg("--bg");
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Review is queued, but Dispatch could not be launched: {e}"))?;
    // Reap when --wait keeps this CLI alive. Otherwise process exit transfers
    // the detached resident to the OS; never retain its stdout/stderr pipes.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_tray_artwork_is_monochrome_with_a_static_lower_right_badge() {
        let idle = tauri::include_image!("icons/tray-template.png");
        let attention = tauri::include_image!("icons/tray-macos-attention.png");
        for icon in [&idle, &attention] {
            assert_eq!((icon.width(), icon.height()), (48, 48));
            assert!(icon.rgba().chunks_exact(4).any(|p| p[3] == 0));
            assert!(icon.rgba().chunks_exact(4).any(|p| p[3] == 255));
        }
        assert!(idle.rgba().chunks_exact(4).all(|p| p[..3] == [0, 0, 0]));
        let mut badge_pixels = 0;
        for (index, pixel) in attention.rgba().chunks_exact(4).enumerate() {
            if pixel[0] != pixel[1] || pixel[1] != pixel[2] {
                assert!(index % 48 >= 28 && index / 48 >= 28);
                if pixel[0] > 200 && pixel[1] < 120 && pixel[2] > 60 && pixel[3] > 200 {
                    badge_pixels += 1;
                }
            } else if pixel[3] > 0 {
                assert_eq!(pixel[0], pixel[1]);
                assert_eq!(pixel[1], pixel[2]);
            }
        }
        assert!(
            badge_pixels > 100,
            "badge must remain large at menu-bar size"
        );
    }

    #[test]
    fn count_includes_the_whole_queue_and_only_completion_clears_it() {
        let root = tempfile::tempdir().unwrap();
        let mut ids = HashSet::new();
        for _ in 0..60 {
            let id = uuid::Uuid::new_v4().to_string();
            let directory = root.path().join(&id);
            fs::create_dir(&directory).unwrap();
            fs::write(directory.join("request.json"), b"{}").unwrap();
            ids.insert(id);
        }
        assert_eq!(
            outstanding_count(root.path(), &queue_ids(root.path()).unwrap()),
            60
        );
        let completed = ids.iter().next().unwrap();
        fs::write(root.path().join(completed).join("result.json"), b"{}").unwrap();
        assert_eq!(
            outstanding_count(root.path(), &queue_ids(root.path()).unwrap()),
            59
        );
    }

    #[test]
    fn desktop_flags_are_explicit_and_background_does_not_imply_a_review() {
        assert!(parse_args(&["--bg".into()]).unwrap().background);
        assert!(!parse_args(&[]).unwrap().background);
        for args in [
            vec!["--bg", "--bg"],
            vec!["--review"],
            vec!["--review", "../oops"],
            vec!["--shell"],
        ] {
            assert!(parse_args(&args.into_iter().map(String::from).collect::<Vec<_>>()).is_err());
        }
    }
}
