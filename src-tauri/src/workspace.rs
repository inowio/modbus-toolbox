use std::fs;
use std::io::{Cursor, Read, Write as IoWrite};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::json;
use tauri::Manager;
use zip::{ZipWriter, ZipArchive, write::SimpleFileOptions};
use tauri_plugin_dialog::DialogExt;

use crate::db::ensure_workspace_db;
use crate::logs::log_app_event;
use crate::models::{Workspace, ImportCache, ImportValidation};

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkspaceWithStats {
    #[serde(flatten)]
    pub ws: Workspace,
    pub slave_count: i64,
}

#[tauri::command]
pub fn get_workspace(app: tauri::AppHandle, name: String) -> Result<Workspace, String> {
    let name = validate_workspace_name(&name)?;
    let dir = workspace_dir(&app)?;
    let file_path = find_workspace_json(&dir, &name)?;

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("failed to read workspace file {:?}: {e}", file_path))?;
    let ws: Workspace = serde_json::from_str(&content)
        .map_err(|e| format!("invalid workspace json {:?}: {e}", file_path))?;

    if let Some(folder) = file_path.parent().map(|p| p.to_path_buf()) {
        ensure_workspace_db(&folder, &ws.db_file)?;
    }

    let details = json!({ "name": ws.name }).to_string();
    log_app_event(&app, "info", "workspace/get", "Loaded workspace", Some(details));

    Ok(ws)
}

fn delete_workspace_inner(app: &tauri::AppHandle, name: String) -> Result<(), String> {
    let name = validate_workspace_name(&name)?;
    let dir = workspace_dir(app)?;
    let file_path = find_workspace_json(&dir, &name)?;

    let folder = file_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "invalid workspace folder".to_string())?;

    fs::remove_dir_all(&folder)
        .map_err(|e| format!("failed to delete workspace folder {:?}: {e}", folder))?;

    Ok(())
}

#[tauri::command]
pub fn delete_workspace(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let name_for_log = name.clone();
    let result = delete_workspace_inner(&app, name);

    let details = json!({ "name": name_for_log }).to_string();
    match &result {
        Ok(()) => {
            log_app_event(&app, "info", "workspace/delete", "Deleted workspace", Some(details));
        }
        Err(err) => {
            log_app_event(&app, "error", "workspace/delete", err, Some(details));
        }
    }

    result
}

fn update_workspace_description_inner(
    app: &tauri::AppHandle,
    name: String,
    description: String,
    now_iso: String,
) -> Result<Workspace, String> {
    let name = validate_workspace_name(&name)?;
    let dir = workspace_dir(app)?;
    let file_path = find_workspace_json(&dir, &name)?;

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("failed to read workspace file {:?}: {e}", file_path))?;
    let mut ws: Workspace = serde_json::from_str(&content)
        .map_err(|e| format!("invalid workspace json {:?}: {e}", file_path))?;

    let t = description.trim().to_string();
    ws.description = if t.is_empty() { None } else { Some(t) };
    ws.updated_at = now_iso;

    let json = serde_json::to_string_pretty(&ws)
        .map_err(|e| format!("failed to serialize workspace: {e}"))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("failed to write workspace file {:?}: {e}", file_path))?;

    if let Some(folder) = file_path.parent().map(|p| p.to_path_buf()) {
        ensure_workspace_db(&folder, &ws.db_file)?;
    }

    Ok(ws)
}

#[tauri::command]
pub fn update_workspace_description(
    app: tauri::AppHandle,
    name: String,
    description: String,
    now_iso: String,
) -> Result<Workspace, String> {
    let name_for_log = name.clone();
    let result = update_workspace_description_inner(&app, name, description, now_iso);

    match &result {
        Ok(ws) => {
            let details = json!({ "name": ws.name }).to_string();
            log_app_event(
                &app,
                "info",
                "workspace/updateDescription",
                "Updated workspace description",
                Some(details),
            );
        }
        Err(err) => {
            let details = json!({ "name": name_for_log }).to_string();
            log_app_event(
                &app,
                "error",
                "workspace/updateDescription",
                err,
                Some(details),
            );
        }
    }

    result
}

pub(crate) fn load_workspace(
    app: &tauri::AppHandle,
    name: &str,
) -> Result<(Workspace, PathBuf), String> {
    let name = validate_workspace_name(name)?;
    let dir = workspace_dir(app)?;
    let file_path = find_workspace_json(&dir, &name)?;

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("failed to read workspace file {:?}: {e}", file_path))?;
    let ws: Workspace = serde_json::from_str(&content)
        .map_err(|e| format!("invalid workspace json {:?}: {e}", file_path))?;

    let folder = file_path
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "invalid workspace folder".to_string())?;
    Ok((ws, folder))
}

fn workspace_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("workspace");

    fs::create_dir_all(&dir).map_err(|e| format!("failed to create workspace dir: {e}"))?;
    Ok(dir)
}

fn find_workspace_folder(dir: &PathBuf, name: &str) -> Result<PathBuf, String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("failed to read workspace dir: {e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("failed to read dir entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        if folder_name.eq_ignore_ascii_case(name) {
            return Ok(path);
        }
    }

    Err("workspace not found".to_string())
}

fn legacy_workspace_file(dir: &PathBuf, name: &str) -> Result<PathBuf, String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("failed to read workspace dir: {e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("failed to read dir entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .eq_ignore_ascii_case("workspace.json")
        {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        if stem.eq_ignore_ascii_case(name) {
            return Ok(path);
        }
    }

    Err("workspace not found".to_string())
}

fn migrate_legacy_workspace_file(dir: &PathBuf, legacy_file: &PathBuf) -> Result<PathBuf, String> {
    let name = legacy_file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if name.is_empty() {
        return Err("invalid legacy workspace file".to_string());
    }

    let folder = dir.join(name);
    fs::create_dir_all(&folder)
        .map_err(|e| format!("failed to create workspace folder {:?}: {e}", folder))?;

    let target = folder.join("workspace.json");
    if target.exists() {
        return Ok(target);
    }

    fs::rename(legacy_file, &target).map_err(|e| {
        format!(
            "failed to migrate workspace file {:?} -> {:?}: {e}",
            legacy_file, target
        )
    })?;
    Ok(target)
}

fn find_workspace_json(dir: &PathBuf, name: &str) -> Result<PathBuf, String> {
    if let Ok(folder) = find_workspace_folder(dir, name) {
        let json_path = folder.join("workspace.json");
        if json_path.exists() {
            return Ok(json_path);
        }
    }

    let legacy = legacy_workspace_file(dir, name)?;
    migrate_legacy_workspace_file(dir, &legacy)
}

fn add_dir_to_zip(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: SimpleFileOptions,
    base_dir: &Path,
    current_dir: &Path,
) -> Result<(), String> {
    let entries = fs::read_dir(current_dir)
        .map_err(|e| format!("Failed to read directory: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base_dir)
            .map_err(|e| format!("Path error: {e}"))?
            .to_string_lossy()
            .replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(&format!("{relative}/"), options)
                .map_err(|e| format!("Failed to add directory {relative}: {e}"))?;
            add_dir_to_zip(zip, options, base_dir, &path)?;
        } else {
            let content = fs::read(&path)
                .map_err(|e| format!("Failed to read {relative}: {e}"))?;
            zip.start_file(&relative, options)
                .map_err(|e| format!("Failed to add {relative}: {e}"))?;
            IoWrite::write_all(zip, &content)
                .map_err(|e| format!("Failed to write {relative}: {e}"))?;
        }
    }
    Ok(())
}

pub fn validate_workspace_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("workspace name is required".to_string());
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("workspace name cannot contain path separators".to_string());
    }

    let invalid_chars = ['<', '>', ':', '"', '|', '?', '*'];
    if trimmed.chars().any(|c| invalid_chars.contains(&c)) {
        return Err("workspace name contains invalid filename characters".to_string());
    }

    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("workspace name cannot end with '.' or space".to_string());
    }

    let upper = trimmed.to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.contains(&upper.as_str()) {
        return Err("workspace name is a reserved device name".to_string());
    }

    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_workspace_name;

    #[test]
    fn rejects_empty_names() {
        assert!(validate_workspace_name("").is_err());
        assert!(validate_workspace_name("   ").is_err());
    }

    #[test]
    fn rejects_invalid_characters() {
        assert!(validate_workspace_name("bad/name").is_err());
        assert!(validate_workspace_name("bad\\name").is_err());
        assert!(validate_workspace_name("bad:name").is_err());
        assert!(validate_workspace_name("bad*").is_err());
    }

    #[test]
    fn rejects_reserved_device_names() {
        assert!(validate_workspace_name("CON").is_err());
        assert!(validate_workspace_name("lpt1").is_err());
    }

    #[test]
    fn rejects_trailing_period() {
        assert!(validate_workspace_name("name.").is_err());
    }

    #[test]
    fn accepts_trimmed_valid_names() {
        assert_eq!(validate_workspace_name("  Project  ").unwrap(), "Project");
    }
}

#[tauri::command]
pub fn list_workspaces(app: tauri::AppHandle) -> Result<Vec<WorkspaceWithStats>, String> {
    let dir = workspace_dir(&app)?;
    let mut items: Vec<WorkspaceWithStats> = Vec::new();

    let rd = fs::read_dir(&dir).map_err(|e| format!("failed to read workspace dir: {e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("failed to read dir entry: {e}"))?;
        let path = entry.path();

        if path.is_dir() {
            let json_path = path.join("workspace.json");
            if !json_path.exists() {
                continue;
            }

            let content = match fs::read_to_string(&json_path) {
                Ok(c) => c,
                Err(e) => {
                    let details = json!({ "path": json_path.to_string_lossy().to_string(), "error": e.to_string() }).to_string();
                    log_app_event(&app, "warn", "workspace/list", "Skipping unreadable workspace", Some(details));
                    continue;
                }
            };
            let ws: Workspace = match serde_json::from_str(&content) {
                Ok(w) => w,
                Err(e) => {
                    let details = json!({ "path": json_path.to_string_lossy().to_string(), "error": e.to_string() }).to_string();
                    log_app_event(&app, "warn", "workspace/list", "Skipping malformed workspace", Some(details));
                    continue;
                }
            };

            let slave_count = count_workspace_slaves(&app, &path, &ws);
            items.push(WorkspaceWithStats { ws, slave_count });
            continue;
        }

        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .eq_ignore_ascii_case("workspace.json")
        {
            continue;
        }

        let migrated_path = migrate_legacy_workspace_file(&dir, &path)?;
        let content = fs::read_to_string(&migrated_path)
            .map_err(|e| format!("failed to read workspace file {:?}: {e}", migrated_path))?;
        let ws: Workspace = serde_json::from_str(&content)
            .map_err(|e| format!("invalid workspace json {:?}: {e}", migrated_path))?;

        let folder = migrated_path
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "invalid workspace folder".to_string())?;
        let slave_count = count_workspace_slaves(&app, &folder, &ws);
        items.push(WorkspaceWithStats { ws, slave_count });
    }

    items.sort_by(|a, b| b.ws.updated_at.cmp(&a.ws.updated_at));
    Ok(items)
}

fn count_workspace_slaves(app: &tauri::AppHandle, folder: &PathBuf, ws: &Workspace) -> i64 {
    if let Err(e) = ensure_workspace_db(folder, &ws.db_file) {
        let details = json!({ "name": ws.name.clone(), "error": e }).to_string();
        log_app_event(app, "error", "workspace/list", "Failed to init workspace DB", Some(details));
        return 0;
    }

    let db_path = folder.join(&ws.db_file);
    match Connection::open(&db_path)
        .and_then(|conn| conn.query_row("SELECT COUNT(*) FROM slaves;", [], |row| row.get::<_, i64>(0)))
    {
        Ok(count) => count,
        Err(e) => {
            let details = json!({ "name": ws.name.clone(), "dbPath": db_path, "error": e.to_string() }).to_string();
            log_app_event(app, "error", "workspace/list", "Failed to count slaves", Some(details));
            0
        }
    }
}

#[tauri::command]
pub fn create_workspace(
    app: tauri::AppHandle,
    name: String,
    description: Option<String>,
    now_iso: String,
) -> Result<Workspace, String> {
    let name_for_log = name.clone();
    let result = create_workspace_inner(&app, name, description, now_iso);

    match &result {
        Ok(ws) => {
            let details = json!({ "name": ws.name }).to_string();
            log_app_event(&app, "info", "workspace/create", "Created workspace", Some(details));
        }
        Err(err) => {
            let details = json!({ "name": name_for_log }).to_string();
            log_app_event(&app, "error", "workspace/create", err, Some(details));
        }
    }

    result
}

fn create_workspace_inner(
    app: &tauri::AppHandle,
    name: String,
    description: Option<String>,
    now_iso: String,
) -> Result<Workspace, String> {
    let name = validate_workspace_name(&name)?;
    let dir = workspace_dir(app)?;

    let existing = list_workspaces(app.clone())?;
    if existing
        .iter()
        .any(|w| w.ws.name.eq_ignore_ascii_case(&name))
    {
        return Err("duplicate workspace name".to_string());
    }

    let ws = Workspace {
        name: name.clone(),
        description: description.and_then(|d| {
            let t = d.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        }),
        db_file: crate::models::default_workspace_db_file(),
        created_at: now_iso.clone(),
        updated_at: now_iso,
    };

    let folder_path = dir.join(&name);
    if folder_path.exists() {
        return Err("workspace already exists".to_string());
    }
    fs::create_dir_all(&folder_path)
        .map_err(|e| format!("failed to create workspace folder {:?}: {e}", folder_path))?;

    let file_path = folder_path.join("workspace.json");
    let json = serde_json::to_string_pretty(&ws)
        .map_err(|e| format!("failed to serialize workspace: {e}"))?;

    fs::write(&file_path, json)
        .map_err(|e| format!("failed to write workspace file {:?}: {e}", file_path))?;

    if let Some(folder) = file_path.parent().map(|p| p.to_path_buf()) {
        ensure_workspace_db(&folder, &ws.db_file)?;
    }

    Ok(ws)
}

#[tauri::command]
pub fn touch_workspace(
    app: tauri::AppHandle,
    name: String,
    now_iso: String,
) -> Result<Workspace, String> {
    let name_for_log = name.clone();
    let result = touch_workspace_inner(&app, name, now_iso);

    match &result {
        Ok(ws) => {
            let details = json!({ "name": ws.name }).to_string();
            log_app_event(
                &app,
                "info",
                "workspace/touch",
                "Touched workspace (updated last opened)",
                Some(details),
            );
        }
        Err(err) => {
            let details = json!({ "name": name_for_log }).to_string();
            log_app_event(
                &app,
                "error",
                "workspace/touch",
                err,
                Some(details),
            );
        }
    }

    result
}

fn touch_workspace_inner(
    app: &tauri::AppHandle,
    name: String,
    now_iso: String,
) -> Result<Workspace, String> {
    let name = validate_workspace_name(&name)?;
    let dir = workspace_dir(app)?;

    let file_path = find_workspace_json(&dir, &name)?;
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("failed to read workspace file {:?}: {e}", file_path))?;
    let mut ws: Workspace = serde_json::from_str(&content)
        .map_err(|e| format!("invalid workspace json {:?}: {e}", file_path))?;

    ws.updated_at = now_iso;
    let json = serde_json::to_string_pretty(&ws)
        .map_err(|e| format!("failed to serialize workspace: {e}"))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("failed to write workspace file {:?}: {e}", file_path))?;

    if let Some(folder) = file_path.parent().map(|p| p.to_path_buf()) {
        ensure_workspace_db(&folder, &ws.db_file)?;
    }

    Ok(ws)
}

fn rename_workspace_inner(
    app: &tauri::AppHandle,
    old_name: String,
    new_name: String,
    description: Option<String>,
    now_iso: String,
) -> Result<Workspace, String> {
    let trimmed_new = validate_workspace_name(&new_name)?;
    let _validated_old = validate_workspace_name(&old_name)?;
    let ws_root = workspace_dir(app)?;
    let old_dir = find_workspace_folder(&ws_root, &old_name)?;

    let name_changed = !old_name.eq_ignore_ascii_case(&trimmed_new);

    let target_dir = if name_changed {
        let candidate = ws_root.join(&trimmed_new);
        for entry in fs::read_dir(&ws_root).map_err(|e| format!("Failed to read workspace dir: {e}"))? {
            let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
            let entry_name = entry.file_name().to_string_lossy().to_string();
            if entry_name.eq_ignore_ascii_case(&trimmed_new)
                && !entry_name.eq_ignore_ascii_case(&old_name)
            {
                return Err("A workspace with this name already exists".to_string());
            }
        }

        fs::rename(&old_dir, &candidate)
            .map_err(|e| format!("Failed to rename workspace folder: {e}"))?;
        candidate
    } else {
        old_dir
    };

    let json_path = target_dir.join("workspace.json");
    let json_text = fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read workspace.json: {e}"))?;
    let mut ws: Workspace = serde_json::from_str(&json_text)
        .map_err(|e| format!("Failed to parse workspace.json: {e}"))?;

    ws.name = trimmed_new;
    if let Some(desc) = description {
        let trimmed = desc.trim().to_string();
        ws.description = if trimmed.is_empty() { None } else { Some(trimmed) };
    }
    ws.updated_at = now_iso;

    let updated_json = serde_json::to_string_pretty(&ws)
        .map_err(|e| format!("Failed to serialize workspace: {e}"))?;
    fs::write(&json_path, updated_json)
        .map_err(|e| format!("Failed to write workspace.json: {e}"))?;

    Ok(ws)
}

#[tauri::command]
pub fn rename_workspace(
    app: tauri::AppHandle,
    old_name: String,
    new_name: String,
    description: Option<String>,
    now_iso: String,
) -> Result<Workspace, String> {
    let details = json!({ "old_name": old_name, "new_name": new_name }).to_string();
    let result = rename_workspace_inner(&app, old_name, new_name, description, now_iso);

    match &result {
        Ok(ws) => {
            log_app_event(&app, "info", "workspace/rename",
                &format!("Renamed workspace to '{}'", ws.name), Some(details));
        }
        Err(err) => {
            log_app_event(&app, "error", "workspace/rename", err, Some(details));
        }
    }

    result
}

fn export_workspace_package_inner(
    app: &tauri::AppHandle,
    name: String,
    file_name: String,
) -> Result<bool, String> {
    let ws_root = workspace_dir(app)?;
    let ws_dir = find_workspace_folder(&ws_root, &name)?;

    let buffer = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buffer);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    add_dir_to_zip(&mut zip, options, &ws_dir, &ws_dir)?;

    let result = zip.finish().map_err(|e| format!("Failed to finalize zip: {e}"))?;
    let zip_bytes = result.into_inner();

    let target = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("ZIP Archive", &["zip"])
        .blocking_save_file();

    let Some(target_path) = target else {
        return Ok(false);
    };

    let destination = target_path
        .into_path()
        .map_err(|_| "Invalid destination path".to_string())?;

    fs::write(&destination, zip_bytes)
        .map_err(|e| format!("Failed to save zip: {e}"))?;

    Ok(true)
}

#[tauri::command]
pub fn export_workspace_package(
    app: tauri::AppHandle,
    name: String,
    file_name: String,
) -> Result<bool, String> {
    let details = json!({ "name": name }).to_string();
    let result = export_workspace_package_inner(&app, name, file_name);

    match &result {
        Ok(true) => {
            log_app_event(&app, "info", "workspace/export", "Exported workspace", Some(details));
        }
        Ok(false) => {} // User cancelled — no log
        Err(err) => {
            log_app_event(&app, "error", "workspace/export", err, Some(details));
        }
    }

    result
}

fn unique_workspace_name(ws_root: &Path, base_name: &str) -> String {
    let mut candidate = base_name.to_string();
    let mut index: u32 = 1;

    while ws_root
        .read_dir()
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .any(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(&candidate))
    {
        candidate = format!("{base_name} {index}");
        index = index.saturating_add(1);
    }

    candidate
}

fn read_zip_entry_string(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    entry_name: &str,
) -> Result<String, String> {
    let mut file = archive
        .by_name(entry_name)
        .map_err(|_| "Invalid workspace package".to_string())?;
    if !file.is_file() {
        return Err("Invalid workspace package".to_string());
    }
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|_| "Invalid workspace package".to_string())?;
    if content.trim().is_empty() {
        return Err("Invalid workspace package".to_string());
    }
    Ok(content)
}

fn read_zip_entry_bytes(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    entry_name: &str,
) -> Result<Vec<u8>, String> {
    let mut file = archive
        .by_name(entry_name)
        .map_err(|_| "Invalid workspace package".to_string())?;
    if !file.is_file() {
        return Err("Invalid workspace package".to_string());
    }
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|_| "Invalid workspace package".to_string())?;
    Ok(buf)
}

#[tauri::command]
pub fn validate_import_workspace(
    app: tauri::AppHandle,
    cache: tauri::State<'_, ImportCache>,
) -> Result<Option<ImportValidation>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("ZIP Archive", &["zip"])
        .blocking_pick_file();

    let Some(selected_path) = selected else {
        return Ok(None);
    };

    let source = selected_path
        .into_path()
        .map_err(|_| "Invalid workspace package".to_string())?;

    let zip_bytes = fs::read(&source)
        .map_err(|_| "Invalid workspace package".to_string())?;

    let mut archive = ZipArchive::new(Cursor::new(zip_bytes.clone()))
        .map_err(|_| "Invalid workspace package".to_string())?;

    let ws_json_text = read_zip_entry_string(&mut archive, "workspace.json")?;
    let imported_ws: Workspace = serde_json::from_str(&ws_json_text)
        .map_err(|_| "Invalid workspace package".to_string())?;

    // Validate db file exists in the ZIP (early feedback before conflict modal)
    let _ = read_zip_entry_bytes(&mut archive, &imported_ws.db_file)?;

    if imported_ws.name.trim().is_empty() {
        return Err("Invalid workspace package".to_string());
    }

    let base_name = validate_workspace_name(&imported_ws.name)
        .map_err(|_| "Invalid workspace package".to_string())?;

    let ws_root = workspace_dir(&app)?;
    let conflict = ws_root
        .read_dir()
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .any(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(&base_name));

    let mut guard = cache.0.lock().map_err(|_| "Lock poisoned".to_string())?;
    *guard = Some(zip_bytes);

    Ok(Some(ImportValidation {
        workspace_name: base_name,
        conflict,
    }))
}

fn import_workspace_zip(
    app: &tauri::AppHandle,
    zip_bytes: &[u8],
    now_iso: &str,
    overwrite_name: Option<&str>,
) -> Result<Workspace, String> {
    let ws_root = workspace_dir(app)?;

    let mut archive = ZipArchive::new(Cursor::new(zip_bytes.to_vec()))
        .map_err(|_| "Invalid workspace package".to_string())?;

    let ws_json_text = read_zip_entry_string(&mut archive, "workspace.json")?;
    let imported_ws: Workspace = serde_json::from_str(&ws_json_text)
        .map_err(|_| "Invalid workspace package".to_string())?;

    let _ = read_zip_entry_bytes(&mut archive, &imported_ws.db_file)?;

    if imported_ws.name.trim().is_empty() {
        return Err("Invalid workspace package".to_string());
    }

    let base_name = validate_workspace_name(&imported_ws.name)
        .map_err(|_| "Invalid workspace package".to_string())?;

    let target_name = if let Some(name) = overwrite_name {
        let existing_dir = ws_root.join(name);
        if existing_dir.exists() {
            fs::remove_dir_all(&existing_dir)
                .map_err(|e| format!("Failed to remove existing workspace: {e}"))?;
        }
        name.to_string()
    } else {
        unique_workspace_name(&ws_root, &base_name)
    };

    let target_dir = ws_root.join(&target_name);
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create workspace folder: {e}"))?;

    let write_result = (|| -> Result<Workspace, String> {
        let normalized = Workspace {
            name: target_name.clone(),
            description: imported_ws.description.clone(),
            db_file: imported_ws.db_file.clone(),
            created_at: if imported_ws.created_at.trim().is_empty() {
                now_iso.to_string()
            } else {
                imported_ws.created_at.clone()
            },
            updated_at: now_iso.to_string(),
        };

        let ws_json = serde_json::to_string_pretty(&normalized)
            .map_err(|e| format!("Failed to serialize workspace: {e}"))?;
        fs::write(target_dir.join("workspace.json"), ws_json)
            .map_err(|e| format!("Failed to write workspace.json: {e}"))?;

        let mut archive2 = ZipArchive::new(Cursor::new(zip_bytes.to_vec()))
            .map_err(|_| "Invalid workspace package".to_string())?;

        let db_file_name = &normalized.db_file;
        let db_bytes = read_zip_entry_bytes(&mut archive2, db_file_name)?;
        fs::write(target_dir.join(db_file_name), db_bytes)
            .map_err(|e| format!("Failed to write {}: {e}", db_file_name))?;

        for i in 0..archive2.len() {
            let mut entry = archive2.by_index(i)
                .map_err(|e| format!("Failed to read zip entry: {e}"))?;

            let entry_name = entry.name().replace('\\', "/");

            if entry_name == "workspace.json" || entry_name == *db_file_name {
                continue;
            }

            let target_path = target_dir.join(&entry_name);

            // Security: reject any path that escapes the target directory
            if !target_path.starts_with(&target_dir) {
                continue;
            }

            if entry.is_dir() {
                fs::create_dir_all(&target_path)
                    .map_err(|e| format!("Failed to create directory {entry_name}: {e}"))?;
            } else if entry.is_file() {
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent dir: {e}"))?;
                }
                let mut buf = Vec::new();
                entry.read_to_end(&mut buf)
                    .map_err(|e| format!("Failed to read {entry_name}: {e}"))?;
                fs::write(&target_path, buf)
                    .map_err(|e| format!("Failed to write {entry_name}: {e}"))?;
            }
        }

        Ok(normalized)
    })();

    match write_result {
        Ok(ws) => Ok(ws),
        Err(e) => {
            let _ = fs::remove_dir_all(&target_dir);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn execute_workspace_import(
    app: tauri::AppHandle,
    cache: tauri::State<'_, ImportCache>,
    mode: String,
    now_iso: String,
) -> Result<Workspace, String> {
    let zip_bytes = {
        let mut guard = cache.0.lock().map_err(|_| "Lock poisoned".to_string())?;
        guard.take().ok_or_else(|| "No pending import. Please validate first.".to_string())?
    };

    let overwrite_name = if mode == "overwrite" {
        let mut archive = ZipArchive::new(Cursor::new(zip_bytes.clone()))
            .map_err(|_| "Invalid workspace package".to_string())?;
        let ws_json_text = read_zip_entry_string(&mut archive, "workspace.json")?;
        let imported_ws: Workspace = serde_json::from_str(&ws_json_text)
            .map_err(|_| "Invalid workspace package".to_string())?;
        let name = validate_workspace_name(&imported_ws.name)
            .map_err(|_| "Invalid workspace package".to_string())?;
        Some(name)
    } else {
        None
    };

    let result = import_workspace_zip(&app, &zip_bytes, &now_iso, overwrite_name.as_deref());

    let details = json!({ "mode": mode }).to_string();
    match &result {
        Ok(ws) => {
            let action = if mode == "overwrite" { "Overwritten" } else { "Imported" };
            log_app_event(&app, "info", "workspace/import",
                &format!("{} workspace '{}'", action, ws.name), Some(details));
        }
        Err(err) => {
            log_app_event(&app, "error", "workspace/import", err, Some(details));
        }
    }

    result
}

#[tauri::command]
pub fn clear_import_cache(
    cache: tauri::State<'_, ImportCache>,
) -> Result<(), String> {
    let mut guard = cache.0.lock().map_err(|_| "Lock poisoned".to_string())?;
    *guard = None;
    Ok(())
}
