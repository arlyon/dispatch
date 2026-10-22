//! Private, bounded desktop control messages. Review requests/results remain
//! the existing immutable filesystem protocol; this transport only wakes the UI.
use crate::agents::AgentState;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    os::unix::{
        fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    time::Duration,
};

pub const MAX_FRAME: usize = 4 * 1024 * 1024;
pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    pub version: u8,
    pub revision: u64,
    pub has_feedback: bool,
    pub data: Value,
}
impl Checkpoint {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1 || !self.data.is_object() {
            return Err("Unsupported desktop checkpoint; keep the review window open".into());
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > MAX_FRAME - 4096 {
            return Err("Draft checkpoint exceeds 4 MiB; keep the review window open".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Activation {
    pub review: Option<String>,
    pub background: bool,
}
impl Activation {
    pub fn validate(&self) -> Result<()> {
        if let Some(id) = &self.review
            && uuid::Uuid::parse_str(id)
                .map_err(|_| "Invalid review id")?
                .to_string()
                != *id
        {
            return Err("Invalid review id".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub checkpoint: Option<Checkpoint>,
    pub review: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GuiEvent {
    Ready,
    Shown,
    Focused { focused: bool },
    Hidden { checkpoint: Checkpoint },
    Latest { checkpoint: Checkpoint },
    Checkpoint { token: u64, checkpoint: Checkpoint },
    CheckpointFailed { token: u64, error: String },
    QuitConfirmed { checkpoint: Checkpoint },
    QuitCancelled,
    Rpc { id: u64, request: Rpc },
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Rpc {
    StartAgent { id: String },
    AskAgent { id: String, message: String },
    ListAgents,
    UpdateStatus,
    CheckUpdates,
    InstallUpdate,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GuiCommand {
    Show { review: Option<String> },
    Hide,
    QueueChanged,
    Checkpoint { token: u64 },
    Exit { token: u64, revision: u64 },
    Quit,
    QuitExit,
    Agent { state: AgentState },
    Reply { id: u64, result: Result<Value> },
    Error { message: String },
}

pub fn write_frame(writer: &mut impl Write, message: &impl Serialize) -> Result<()> {
    let mut bytes = serde_json::to_vec(message).map_err(|e| e.to_string())?;
    if bytes.len() >= MAX_FRAME {
        return Err("Desktop control message exceeds 4 MiB".into());
    }
    bytes.push(b'\n');
    writer
        .write_all(&bytes)
        .and_then(|_| writer.flush())
        .map_err(|e| e.to_string())
}
pub fn read_frame<T: DeserializeOwned>(reader: &mut impl BufRead) -> Result<T> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_FRAME || bytes.last() != Some(&b'\n') {
        return Err("Desktop control message is incomplete or exceeds 4 MiB".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid desktop control message: {e}"))
}
pub fn activate(root: &Path, activation: &Activation) -> Result<()> {
    activation.validate()?;
    let mut stream = UnixStream::connect(root.join("desktop.sock")).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| e.to_string())?;
    write_frame(&mut stream, activation)?;
    read_frame::<Result<()>>(&mut BufReader::new(stream))?
}
pub struct Instance {
    _lock: File,
    pub listener: UnixListener,
    socket: PathBuf,
    socket_identity: (u64, u64),
}
impl Instance {
    pub fn acquire(root: &Path) -> Result<Option<Self>> {
        crate::reviews::ensure_root(root)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(root.join("desktop.lock"))
            .map_err(|e| e.to_string())?;
        let metadata = lock.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.permissions().mode() & 0o077 != 0 {
            return Err("Desktop lock must be a private regular file".into());
        }
        match fs2::FileExt::try_lock_exclusive(&lock) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(None),
            Err(error) => return Err(error.to_string()),
        }
        let socket = root.join("desktop.sock");
        match fs::symlink_metadata(&socket) {
            Ok(meta) if meta.file_type().is_socket() => {
                fs::remove_file(&socket).map_err(|e| e.to_string())?
            }
            Ok(_) => return Err("Desktop socket path is occupied by a non-socket file".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        let listener = UnixListener::bind(&socket)
            .map_err(|e| format!("Cannot bind desktop socket (path may be too long): {e}"))?;
        fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
        let metadata = fs::symlink_metadata(&socket).map_err(|e| e.to_string())?;
        Ok(Some(Self {
            _lock: lock,
            listener,
            socket,
            socket_identity: (metadata.dev(), metadata.ino()),
        }))
    }
    pub fn cleanup(&self) -> Result<()> {
        match fs::symlink_metadata(&self.socket) {
            Ok(metadata)
                if metadata.file_type().is_socket()
                    && (metadata.dev(), metadata.ino()) == self.socket_identity =>
            {
                fs::remove_file(&self.socket).map_err(|e| e.to_string())
            }
            Ok(_) => Err("Desktop socket was replaced; refusing to remove another file".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}
impl Drop for Instance {
    fn drop(&mut self) {
        let _ = self.cleanup();
        // A concurrent process spawn may briefly inherit this open description
        // until exec closes CLOEXEC descriptors. Release ownership explicitly;
        // dropping our File alone can otherwise leave the lock held by it.
        let _ = fs2::FileExt::unlock(&self._lock);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_are_bounded_and_do_not_consume_the_next_message() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &Activation::default()).unwrap();
        write_frame(
            &mut bytes,
            &Activation {
                background: true,
                ..Default::default()
            },
        )
        .unwrap();
        let mut reader = BufReader::new(bytes.as_slice());
        assert!(!read_frame::<Activation>(&mut reader).unwrap().background);
        assert!(read_frame::<Activation>(&mut reader).unwrap().background);
        assert!(read_frame::<Value>(&mut BufReader::new(&b"{}"[..])).is_err());
        assert!(
            read_frame::<Value>(&mut BufReader::new(vec![b' '; MAX_FRAME + 1].as_slice())).is_err()
        );
        assert!(write_frame(&mut Vec::new(), &"a".repeat(MAX_FRAME)).is_err());
    }
    #[test]
    fn instance_lock_prevents_duplicate_trays_and_rejects_symlinks() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let first = Instance::acquire(root.path()).unwrap().unwrap();
        assert!(Instance::acquire(root.path()).unwrap().is_none());
        drop(first);
        assert!(!root.path().join("desktop.sock").exists());
        fs::remove_file(root.path().join("desktop.lock")).unwrap();
        let target = root.path().join("do-not-open");
        fs::write(&target, "unchanged").unwrap();
        std::os::unix::fs::symlink(&target, root.path().join("desktop.lock")).unwrap();
        assert!(Instance::acquire(root.path()).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "unchanged");
    }
    #[test]
    fn explicit_cleanup_is_idempotent_without_releasing_the_singleton_lock() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let instance = Instance::acquire(root.path()).unwrap().unwrap();
        instance.cleanup().unwrap();
        instance.cleanup().unwrap();
        assert!(!root.path().join("desktop.sock").exists());
        assert!(Instance::acquire(root.path()).unwrap().is_none());
        drop(instance);
        assert!(Instance::acquire(root.path()).unwrap().is_some());
    }
    #[test]
    fn cleanup_never_removes_a_replacement_socket_or_regular_file() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let instance = Instance::acquire(root.path()).unwrap().unwrap();
        let socket = root.path().join("desktop.sock");
        fs::remove_file(&socket).unwrap();
        let replacement = UnixListener::bind(&socket).unwrap();
        assert!(instance.cleanup().is_err());
        assert!(socket.exists());
        fs::remove_file(&socket).unwrap();
        fs::write(&socket, "do not remove").unwrap();
        assert!(instance.cleanup().is_err());
        drop(instance);
        assert_eq!(fs::read_to_string(&socket).unwrap(), "do not remove");
        drop(replacement);
    }
    #[test]
    fn checkpoint_and_activation_validate_protocol_shapes() {
        let mut checkpoint = Checkpoint {
            version: 1,
            revision: 1,
            has_feedback: true,
            data: serde_json::json!({"drafts":{}}),
        };
        checkpoint.validate().unwrap();
        checkpoint.version = 2;
        assert!(checkpoint.validate().is_err());
        assert!(
            Activation {
                review: Some("../escape".into()),
                background: true
            }
            .validate()
            .is_err()
        );
        assert!(
            serde_json::from_str::<Activation>(r#"{"background":true,"arbitraryCommand":"rm"}"#)
                .is_err()
        );
    }
}
