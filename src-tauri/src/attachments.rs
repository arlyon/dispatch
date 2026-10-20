//! Private, user-pasted review images. No remote fetching or arbitrary file reads.
use crate::reviews;
use serde::Serialize;
use std::{fs, io::Write, path::Path};
use uuid::Uuid;
const LIMIT: usize = 8 * 1024 * 1024;
#[derive(Serialize)]
pub struct SavedImage {
    pub path: String,
    pub name: String,
}
#[derive(Serialize)]
pub struct Image {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}
fn format(bytes: &[u8]) -> Result<(&'static str, &'static str), String> {
    if bytes.is_empty() || bytes.len() > LIMIT {
        return Err("Images must be between 1 byte and 8 MiB".into());
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok(("png", "image/png"))
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok(("jpg", "image/jpeg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok(("gif", "image/gif"))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok(("webp", "image/webp"))
    } else {
        Err("Paste a PNG, JPEG, GIF or WebP image; SVG/HTML are not accepted".into())
    }
}
pub fn save(root: &Path, id: &str, bytes: &[u8]) -> Result<SavedImage, String> {
    reviews::ensure_root(root)?;
    reviews::read_request(root, id)?;
    if reviews::result(root, id)?.is_some() {
        return Err("Archived reviews are read-only".into());
    }
    let (extension, _) = format(bytes)?;
    let review = root.join(id);
    if !fs::symlink_metadata(&review)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("Invalid review directory".into());
    }
    let directory = review.join("attachments");
    let mut builder = fs::DirBuilder::new();
    builder.recursive(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    if !fs::symlink_metadata(&directory)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("Attachment directory must not be a symlink".into());
    }
    let name = format!("{}.{}", Uuid::new_v4(), extension);
    let path = directory.join(&name);
    let mut file = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist_noclobber(&path).map_err(|e| e.to_string())?;
    Ok(SavedImage {
        path: path.to_string_lossy().into_owned(),
        name,
    })
}
pub fn read(root: &Path, reference: &str) -> Result<Image, String> {
    reviews::ensure_root(root)?;
    let path = Path::new(reference);
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > LIMIT as u64 {
        return Err("Invalid image file".into());
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    let relative = canonical
        .strip_prefix(base)
        .map_err(|_| "Image is outside the review directory")?;
    let parts = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    if parts.len() != 3 || parts[1] != "attachments" {
        return Err("Not a review attachment".into());
    }
    let id = Uuid::parse_str(&parts[0]).map_err(|_| "Invalid review id")?;
    if id.to_string() != parts[0] {
        return Err("Invalid review id".into());
    }
    reviews::read_request(root, &parts[0])?;
    let (stem, extension) = parts[2].rsplit_once('.').ok_or("Invalid attachment name")?;
    if Uuid::parse_str(stem)
        .map_err(|_| "Invalid attachment name")?
        .to_string()
        != stem
    {
        return Err("Invalid attachment name".into());
    }
    let bytes = fs::read(canonical).map_err(|e| e.to_string())?;
    let (actual, mime) = format(&bytes)?;
    if extension != actual {
        return Err("Image format does not match its filename".into());
    }
    Ok(Image { bytes, mime })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pasted_image_stays_private_and_readable_after_completion() {
        let root = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        }
        let id = Uuid::new_v4().to_string();
        let directory = root.path().join(&id);
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("request.json"),serde_json::to_vec(&serde_json::json!({"version":1,"id":id,"title":"image fixture","source":{"repo":"/fixture","base":"a".repeat(40),"head":"b".repeat(40),"baseRef":"main","headRef":"HEAD"},"files":[]})).unwrap()).unwrap();
        let bytes = b"\x89PNG\r\n\x1a\n";
        let saved = save(root.path(), &id, bytes).unwrap();
        assert!(saved.name.ends_with(".png"));
        assert_eq!(read(root.path(), &saved.path).unwrap().bytes, bytes);
        assert!(save(root.path(), &id, b"<svg/>").is_err());
        fs::write(directory.join("result.json"),serde_json::to_vec(&serde_json::json!({"version":1,"requestId":id,"status":"complete","feedback":{"head":"b".repeat(40),"comments":[],"summary":null}})).unwrap()).unwrap();
        assert!(save(root.path(), &id, bytes).is_err());
        assert_eq!(read(root.path(), &saved.path).unwrap().mime, "image/png");
    }
    #[test]
    fn rejects_active_content_and_unknown_files() {
        assert!(format(b"<svg onload=alert(1)>").is_err());
        assert!(format(b"plain text").is_err());
        assert!(format(&vec![0; LIMIT + 1]).is_err());
        assert_eq!(format(b"\x89PNG\r\n\x1a\n").unwrap().1, "image/png");
        let root = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        }
        assert!(read(root.path(), "/etc/passwd").is_err());
    }
}
