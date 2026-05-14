use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use base64::{engine::general_purpose, Engine as _};

use crate::workspace::load_workspace;

fn validate_attachment_path(dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    // Reject file names with path separators to prevent traversal
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("invalid attachment file name".to_string());
    }
    let path = dir.join(file_name);
    // Double-check: the resolved path must still be inside the attachment dir
    if let (Ok(canon_dir), Ok(canon_path)) = (dir.canonicalize(), path.canonicalize()) {
        if !canon_path.starts_with(&canon_dir) {
            return Err("invalid attachment path".to_string());
        }
    }
    Ok(path)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentItem {
    pub file_name: String,
    pub display_name: String,
    pub ext: String,
    pub size_bytes: u64,
    pub modified_at_iso: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentPreview {
    pub kind: String,
    pub data: String,
    pub mime_type: String,
}

fn workspace_attachments_dir(app: &tauri::AppHandle, name: &str, slave_id: i64) -> Result<PathBuf, String> {
    if slave_id <= 0 {
        return Err("slave_id must be > 0".to_string());
    }
    let (_ws, folder) = load_workspace(app, name)?;
    let dir = folder.join("attachments").join(format!("slave-{}", slave_id));
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create attachments dir {:?}: {e}", dir))?;
    Ok(dir)
}

fn workspace_attachments_dir_readonly(
    app: &tauri::AppHandle,
    name: &str,
    slave_id: i64,
) -> Result<PathBuf, String> {
    if slave_id <= 0 {
        return Err("slave_id must be > 0".to_string());
    }
    let (_ws, folder) = load_workspace(app, name)?;
    Ok(folder.join("attachments").join(format!("slave-{}", slave_id)))
}

fn system_time_to_iso(t: SystemTime) -> String {
    // Fallback to a fixed epoch timestamp if conversion fails.
    match t.duration_since(UNIX_EPOCH) {
        Ok(dur) => {
            let secs = dur.as_secs() as i64;
            if let Some(dt) = chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0) {
                dt.format("%Y-%m-%dT%H:%M:%S").to_string()
            } else {
                "1970-01-01T00:00:00".to_string()
            }
        }
        Err(_) => "1970-01-01T00:00:00".to_string(),
    }
}

fn build_attachment_item(path: &Path) -> Result<AttachmentItem, String> {
    let meta = fs::metadata(path)
        .map_err(|e| format!("failed to read metadata for attachment {:?}: {e}", path))?;
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid attachment file name".to_string())?
        .to_string();
    let display_name = file_name.clone();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let size_bytes = meta.len();
    let modified_at = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let modified_at_iso = system_time_to_iso(modified_at);

    Ok(AttachmentItem {
        file_name,
        display_name,
        ext,
        size_bytes,
        modified_at_iso,
        path: path.to_string_lossy().to_string(),
    })
}

fn classify_attachment(ext: &str) -> (String, String) {
    let lower = ext.to_ascii_lowercase();
    match lower.as_str() {
        "" => ("text".to_string(), "text/plain;charset=utf-8".to_string()),
        "png" => ("image".to_string(), "image/png".to_string()),
        "jpg" | "jpeg" => ("image".to_string(), "image/jpeg".to_string()),
        "gif" => ("image".to_string(), "image/gif".to_string()),
        "bmp" => ("image".to_string(), "image/bmp".to_string()),
        "webp" => ("image".to_string(), "image/webp".to_string()),
        "svg" => ("image".to_string(), "image/svg+xml".to_string()),
        "pdf" => ("pdf".to_string(), "application/pdf".to_string()),
        "txt" | "md" | "log" | "json" | "csv" | "rs" | "c" | "cpp" | "h" | "ts" | "tsx" | "js" | "jsx" => {
            ("text".to_string(), "text/plain;charset=utf-8".to_string())
        }
        _ => ("binary".to_string(), "application/octet-stream".to_string()),
    }
}

fn unique_target_path(dir: &Path, file_name: &str) -> PathBuf {
    let mut base = file_name.to_string();
    let mut ext = String::new();
    if let Some(dot) = file_name.rfind('.') {
        base = file_name[..dot].to_string();
        ext = file_name[dot + 1..].to_string();
    }

    let mut candidate = if ext.is_empty() {
        dir.join(&base)
    } else {
        dir.join(format!("{}.{}", base, ext))
    };
    let mut idx = 1;
    while candidate.exists() {
        let name = if ext.is_empty() {
            format!("{} ({})", base, idx)
        } else {
            format!("{} ({}).{}", base, idx, ext)
        };
        candidate = dir.join(name);
        idx += 1;
    }
    candidate
}

#[tauri::command]
pub fn list_slave_attachments(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
) -> Result<Vec<AttachmentItem>, String> {
    let dir = workspace_attachments_dir_readonly(&app, &name, slave_id)?;
    let mut out: Vec<AttachmentItem> = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    let rd = fs::read_dir(&dir)
        .map_err(|e| format!("failed to read attachments dir {:?}: {e}", dir))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("failed to read dir entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        out.push(build_attachment_item(&path)?);
    }
    out.sort_by(|a, b| b.modified_at_iso.cmp(&a.modified_at_iso));
    Ok(out)
}

#[tauri::command]
pub fn add_slave_attachment(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
    source_path: String,
) -> Result<AttachmentItem, String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err("source_path must point to a file".to_string());
    }
    let dir = workspace_attachments_dir(&app, &name, slave_id)?;
    let file_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid source file name".to_string())?;
    let target = unique_target_path(&dir, file_name);
    fs::copy(&src, &target)
        .map_err(|e| format!("failed to copy attachment {:?} -> {:?}: {e}", src, target))?;
    build_attachment_item(&target)
}

#[tauri::command]
pub fn delete_slave_attachment(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
    file_name: String,
) -> Result<(), String> {
    let dir = workspace_attachments_dir_readonly(&app, &name, slave_id)?;
    let path = validate_attachment_path(&dir, &file_name)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("failed to delete attachment {:?}: {e}", path))?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_slave_attachment(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
    file_name: String,
) -> Result<AttachmentPreview, String> {
    let dir = workspace_attachments_dir_readonly(&app, &name, slave_id)?;
    let path = validate_attachment_path(&dir, &file_name)?;
    if !path.is_file() {
        return Err("attachment not found".to_string());
    }

    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let (kind, mime_type) = classify_attachment(&ext);

    if kind == "text" {
        match fs::read_to_string(&path) {
            Ok(content) => Ok(AttachmentPreview {
                kind,
                data: content,
                mime_type,
            }),
            Err(_) => {
                let bytes = fs::read(&path)
                    .map_err(|e| format!("failed to read attachment bytes {:?}: {e}", path))?;
                let encoded = general_purpose::STANDARD.encode(bytes);
                Ok(AttachmentPreview {
                    kind: "binary".to_string(),
                    data: encoded,
                    mime_type: "application/octet-stream".to_string(),
                })
            }
        }
    } else {
        let bytes = fs::read(&path)
            .map_err(|e| format!("failed to read attachment bytes {:?}: {e}", path))?;
        let encoded = general_purpose::STANDARD.encode(bytes);
        Ok(AttachmentPreview {
            kind,
            data: encoded,
            mime_type,
        })
    }
}

#[tauri::command]
pub fn export_slave_attachment(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
    file_name: String,
    target_path: String,
) -> Result<(), String> {
    let dir = workspace_attachments_dir_readonly(&app, &name, slave_id)?;
    let src = validate_attachment_path(&dir, &file_name)?;
    if !src.is_file() {
        return Err("attachment not found".to_string());
    }

    let dest = PathBuf::from(&target_path);
    fs::copy(&src, &dest)
        .map_err(|e| format!("failed to export attachment {:?} -> {:?}: {e}", src, dest))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{classify_attachment, system_time_to_iso, unique_target_path};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn classifies_attachment_types() {
        assert_eq!(classify_attachment("png").0, "image");
        assert_eq!(classify_attachment("pdf").0, "pdf");
        assert_eq!(classify_attachment("txt").0, "text");
        assert_eq!(classify_attachment("bin").0, "binary");
    }

    #[test]
    fn formats_system_time_to_iso() {
        let iso = system_time_to_iso(UNIX_EPOCH);
        assert!(iso.starts_with("1970-01-01T"));
    }

    #[test]
    fn generates_unique_target_paths() {
        let dir = std::env::temp_dir().join(format!(
            "attachments_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));
        fs::create_dir_all(&dir).expect("temp dir");

        let first = dir.join("note.txt");
        fs::write(&first, "data").expect("write temp");

        let candidate = unique_target_path(&dir, "note.txt");
        let file_name = candidate.file_name().and_then(|s| s.to_str()).unwrap_or_default();
        assert!(file_name.starts_with("note (1)"));

        fs::remove_dir_all(&dir).ok();
    }
}
