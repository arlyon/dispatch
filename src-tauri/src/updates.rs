//! Tauri owns format selection, signatures and installation. The resident owns
//! checks/downloads; desktop's existing quit handshake protects unfinished work.
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    Manager,
    utils::{config::BundleType, platform::bundle_type},
};
use tauri_plugin_updater::{Update, UpdaterExt};

type Result<T> = std::result::Result<T, String>;
const MAX_DOWNLOAD: usize = 256 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub format: Option<String>,
    pub phase: String,
    pub version: Option<String>,
    pub error: Option<String>,
}
struct Entry {
    status: Status,
    candidate: Option<Update>,
}
pub struct Updates(Mutex<Entry>);
impl Default for Updates {
    fn default() -> Self {
        let format = match bundle_type() {
            Some(BundleType::Rpm) => Some("rpm"),
            Some(BundleType::AppImage) => Some("appimage"),
            Some(BundleType::App) if cfg!(target_os = "macos") => Some("macos"),
            _ => None,
        };
        Self(Mutex::new(Entry {
            status: Status {
                format: format.map(str::to_owned),
                phase: "idle".into(),
                version: None,
                error: None,
            },
            candidate: None,
        }))
    }
}
impl Updates {
    pub fn status(&self) -> Status {
        self.0.lock().expect("update state poisoned").status.clone()
    }
    pub fn error(&self, message: &str) {
        let mut entry = self.0.lock().expect("update state poisoned");
        entry.status.phase = "error".into();
        entry.status.error = Some(message.into());
    }
    pub fn cancel(&self) {
        let mut entry = self.0.lock().expect("update state poisoned");
        entry.status.phase = if entry.candidate.is_some() {
            "available"
        } else {
            "idle"
        }
        .into();
        entry.status.error =
            Some("Finish or explicitly discard pending work before installing an update.".into());
    }
    pub fn installing(&self) {
        self.0.lock().expect("update state poisoned").status.phase = "installing".into();
    }
}
pub fn start(app: tauri::AppHandle) {
    if app.state::<Updates>().status().format.is_none() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            check(app.clone());
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
}
pub fn check(app: tauri::AppHandle) -> Status {
    {
        let state = app.state::<Updates>();
        let mut entry = state.0.lock().expect("update state poisoned");
        if entry.status.format.is_none()
            || matches!(
                entry.status.phase.as_str(),
                "checking" | "downloading" | "installing"
            )
        {
            return entry.status.clone();
        }
        entry.status.phase = "checking".into();
        entry.status.error = None;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            handle
                .updater_builder()
                .timeout(Duration::from_secs(45))
                .build()
                .map_err(|_| ())?
                .check()
                .await
                .map_err(|_| ())
        }
        .await;
        let state = handle.state::<Updates>();
        let mut entry = state.0.lock().expect("update state poisoned");
        match result {
            Ok(candidate) => {
                entry.status.version = candidate.as_ref().map(|update| update.version.clone());
                entry.status.phase = if candidate.is_some() {
                    "available"
                } else {
                    "idle"
                }
                .into();
                entry.candidate = candidate;
            }
            Err(()) => {
                entry.candidate = None;
                entry.status.version = None;
                entry.status.phase = "error".into();
                entry.status.error = Some("Could not check for updates. Your installation is unchanged; retry when online.".into());
            }
        }
    });
    app.state::<Updates>().status()
}
pub struct Prepared {
    update: Update,
    bytes: Vec<u8>,
}
impl Prepared {
    pub fn install(self) -> Result<()> {
        // install() verifies the signature and its version binding again.
        self.update.install(self.bytes).map_err(|_| "Update installation failed or authorization was cancelled. The existing review state is retained.".into())
    }
}
pub fn candidate(app: &tauri::AppHandle) -> Result<Update> {
    let state = app.state::<Updates>();
    let mut entry = state.0.lock().expect("update state poisoned");
    if entry.status.phase != "available" {
        return Err("Check for an available update first".into());
    }
    let update = entry.candidate.clone().ok_or("No update is available")?;
    entry.status.phase = "downloading".into();
    entry.status.error = None;
    Ok(update)
}
pub async fn download(update: Update) -> Result<Prepared> {
    let overflow = Arc::new(tokio::sync::Notify::new());
    let signal = overflow.clone();
    let mut received: usize = 0;
    let bytes = tokio::select! {
        biased;
        _ = overflow.notified() => return Err("Update exceeds the 256 MiB download limit".into()),
        result = tokio::time::timeout(Duration::from_secs(5 * 60), update.download(move |size, total| {
            received = received.saturating_add(size);
            if received > MAX_DOWNLOAD || total.is_some_and(|n| n > MAX_DOWNLOAD as u64) { signal.notify_one(); }
        }, || {})) => result.map_err(|_| "Update download timed out; nothing installed")?
            .map_err(|_| "Update download or signature verification failed; nothing installed")?,
    };
    if bytes.len() > MAX_DOWNLOAD {
        return Err("Update exceeds the 256 MiB download limit".into());
    }
    Ok(Prepared { update, bytes })
}
#[tauri::command]
pub async fn update_status(app: tauri::AppHandle) -> Result<Status> {
    if crate::desktop::is_gui(&app) {
        crate::desktop::rpc(&app, crate::desktop_ipc::Rpc::UpdateStatus).await
    } else {
        Ok(app.state::<Updates>().status())
    }
}
#[tauri::command]
pub async fn check_updates(app: tauri::AppHandle) -> Result<Status> {
    if crate::desktop::is_gui(&app) {
        crate::desktop::rpc(&app, crate::desktop_ipc::Rpc::CheckUpdates).await
    } else {
        Ok(check(app))
    }
}
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<()> {
    if !crate::desktop::is_gui(&app) {
        return Err("Install updates from the review window".into());
    }
    crate::desktop::rpc(&app, crate::desktop_ipc::Rpc::InstallUpdate).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn tauri_verifies_real_version_bound_signature_and_rejects_tampering() {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        context
            .config_mut()
            .plugins
            .0
            .insert("updater".into(), config["plugins"]["updater"].clone());
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app.updater().unwrap();
        let os = if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        };
        let target = format!("{os}-{}", std::env::consts::ARCH);
        let signature = include_str!("../../tests/fixtures/updater-validation.sig");
        let manifest = |version: &str| json!({"version":version,"platforms":{target.clone():{"url":"https://github.com/arlyon/dispatch/releases/download/v0.1.2/fixture","signature":signature}}});
        let update = updater.restore_update(manifest("0.1.2")).unwrap().unwrap();
        let bytes = include_bytes!("../../tests/fixtures/updater-validation.txt");
        update.verify(bytes).unwrap();
        assert!(update.verify(b"tampered payload").is_err());
        let wrong_version = updater.restore_update(manifest("0.1.3")).unwrap().unwrap();
        assert!(
            wrong_version.verify(bytes).is_err(),
            "a new manifest must not replay a signed older artifact"
        );
    }
    #[test]
    fn cancellation_is_not_installation() {
        let updates = Updates::default();
        updates.installing();
        updates.cancel();
        assert_eq!(updates.status().phase, "idle");
        assert!(updates.status().error.unwrap().contains("pending work"));
        updates.error("signature rejected");
        assert_eq!(updates.status().phase, "error");
    }
}
