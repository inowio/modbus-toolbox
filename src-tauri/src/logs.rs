use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::db::open_workspace_db;
use crate::settings::get_client_settings;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEventInput {
    /// "app" or "workspace"
    pub scope: String,
    /// "debug" | "info" | "warn" | "error"
    pub level: String,
    pub workspace_name: Option<String>,
    pub source: String,
    pub message: String,
    /// Optional JSON-encoded details payload
    pub details_json: Option<String>,
}

fn ensure_workspace_logs_table(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS workspace_logs (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           ts_iso TEXT NOT NULL,
           level TEXT NOT NULL,
           severity INTEGER NOT NULL,
           source TEXT NOT NULL,
           message TEXT NOT NULL,
           details_json TEXT
         );",
        [],
    )
    .map_err(|e| format!("failed to ensure workspace_logs table: {e}"))?;

    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogEntry {
    pub id: i64,
    pub ts_iso: String,
    pub level: String,
    pub severity: i64,
    pub source: String,
    pub message: String,
    pub details_json: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLogEntry {
    pub id: i64,
    pub ts_iso: String,
    pub level: String,
    pub severity: i64,
    pub source: String,
    pub message: String,
    pub details_json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLogDeleteFilter {
    /// Delete logs older than this timestamp (RFC3339). If not provided, deletes all workspace logs.
    pub older_than_iso: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLogsDeletedPayload {
    pub workspace: String,
    pub deleted_count: i64,
    pub older_than_iso: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceLogPushed {
    pub workspace: String,
    pub entry: WorkspaceLogEntry,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogListFilter {
    /// Minimum level to include (default: "debug").
    pub min_level: Option<String>,
    /// Maximum number of rows to return (default: 200).
    pub limit: Option<i64>,
}

fn level_to_severity(level: &str) -> i64 {
    match level {
        "error" | "ERROR" => 40,
        "warn" | "WARNING" | "Warn" => 30,
        "info" | "INFO" => 20,
        "debug" | "DEBUG" => 10,
        _ => 20,
    }
}

fn normalize_level(level: &str) -> (&'static str, i64) {
    let sev = level_to_severity(level);
    let normalized = match level {
        "error" | "ERROR" => "error",
        "warn" | "WARNING" | "Warn" => "warn",
        "info" | "INFO" => "info",
        "debug" | "DEBUG" => "debug",
        _ => "info",
    };
    (normalized, sev)
}

fn app_logs_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("logs");

    fs::create_dir_all(&dir).map_err(|e| format!("failed to create logs dir: {e}"))?;
    Ok(dir.join("app-logs.db"))
}

fn open_app_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let db_path = app_logs_db_path(app)?;
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("failed to open app logs db {:?}: {e}", db_path))?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS app_logs (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           ts_iso TEXT NOT NULL,
           level TEXT NOT NULL,
           severity INTEGER NOT NULL,
           source TEXT NOT NULL,
           message TEXT NOT NULL,
           details_json TEXT
         );",
    )
    .map_err(|e| format!("failed to initialize app logs schema: {e}"))?;

    Ok(conn)
}

#[tauri::command]
pub fn log_event(app: tauri::AppHandle, event: LogEventInput) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let (level, severity) = normalize_level(&event.level);

    match event.scope.as_str() {
        "app" => {
            let conn = open_app_db(&app)?;
            conn.execute(
                "INSERT INTO app_logs (ts_iso, level, severity, source, message, details_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
                params![
                    now,
                    level,
                    severity,
                    event.source,
                    event.message,
                    event.details_json,
                ],
            )
            .map_err(|e| format!("failed to insert app log: {e}"))?;

            let id = conn.last_insert_rowid();
            let entry = AppLogEntry {
                id,
                ts_iso: now,
                level: level.to_string(),
                severity,
                source: event.source,
                message: event.message,
                details_json: event.details_json,
            };

            let _ = app.emit("app_log_appended", &entry);
        }
        "workspace" => {
            let workspace_name = event
                .workspace_name
                .as_deref()
                .ok_or_else(|| "workspaceName is required for workspace-scoped logs".to_string())?;

            // Respect minimum log level from settings if available.
            if let Ok(settings) = get_client_settings(app.clone(), workspace_name.to_string()) {
                if let Some(min_level) = settings.logging_min_level.as_deref() {
                    let min_severity = level_to_severity(min_level);
                    if severity < min_severity {
                        return Ok(());
                    }
                }
            }

            let conn = open_workspace_db(&app, workspace_name)?;
            conn.execute(
                "CREATE TABLE IF NOT EXISTS workspace_logs (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   ts_iso TEXT NOT NULL,
                   level TEXT NOT NULL,
                   severity INTEGER NOT NULL,
                   source TEXT NOT NULL,
                   message TEXT NOT NULL,
                   details_json TEXT
                 );",
                [],
            )
            .map_err(|e| format!("failed to ensure workspace_logs table: {e}"))?;

            conn.execute(
                "INSERT INTO workspace_logs (ts_iso, level, severity, source, message, details_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
                params![
                    now,
                    level,
                    severity,
                    event.source,
                    event.message,
                    event.details_json,
                ],
            )
            .map_err(|e| format!("failed to insert workspace log: {e}"))?;

            let id = conn.last_insert_rowid();
            let entry = WorkspaceLogEntry {
                id,
                ts_iso: now,
                level: level.to_string(),
                severity,
                source: event.source,
                message: event.message,
                details_json: event.details_json,
            };

            let payload = WorkspaceLogPushed {
                workspace: workspace_name.to_string(),
                entry,
            };

            let _ = app.emit("workspace_log_appended", &payload);
        }
        other => {
            return Err(format!("invalid log scope: {other}"));
        }
    }

    Ok(())
}

pub fn log_workspace_event(
    app: &tauri::AppHandle,
    workspace_name: &str,
    level: &str,
    source: &str,
    message: &str,
    details_json: Option<String>,
) {
    let _ = log_event(
        app.clone(),
        LogEventInput {
            scope: "workspace".to_string(),
            level: level.to_string(),
            workspace_name: Some(workspace_name.to_string()),
            source: source.to_string(),
            message: message.to_string(),
            details_json,
        },
    );
}

#[tauri::command]
pub fn prune_app_logs(app: tauri::AppHandle, max_rows: Option<i64>) -> Result<(), String> {
    let conn = open_app_db(&app)?;

    let limit = max_rows.unwrap_or(10_000).max(1);

    conn.execute(
        "DELETE FROM app_logs
         WHERE id < (
           SELECT COALESCE(MAX(id) - ?1, 0) FROM app_logs
         );",
        params![limit],
    )
    .map_err(|e| format!("failed to prune app logs: {e}"))?;

    Ok(())
}

pub fn log_app_event(
    app: &tauri::AppHandle,
    level: &str,
    source: &str,
    message: &str,
    details_json: Option<String>,
) {
    let _ = log_event(
        app.clone(),
        LogEventInput {
            scope: "app".to_string(),
            level: level.to_string(),
            workspace_name: None,
            source: source.to_string(),
            message: message.to_string(),
            details_json,
        },
    );
}

#[tauri::command]
pub fn list_app_logs(
    app: tauri::AppHandle,
    filter: Option<LogListFilter>,
) -> Result<Vec<AppLogEntry>, String> {
    let filter = filter.unwrap_or(LogListFilter {
        min_level: None,
        limit: None,
    });
    let min_level = filter.min_level.unwrap_or_else(|| "debug".to_string());
    let min_severity = level_to_severity(&min_level);
    let limit = filter.limit.unwrap_or(200).max(1).min(1000);

    let conn = open_app_db(&app)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, ts_iso, level, severity, source, message, details_json
             FROM app_logs
             WHERE severity >= ?1
             ORDER BY id DESC
             LIMIT ?2;",
        )
        .map_err(|e| format!("failed to prepare app log query: {e}"))?;

    let rows = stmt
        .query_map(params![min_severity, limit], |row| {
            Ok(AppLogEntry {
                id: row.get(0)?,
                ts_iso: row.get(1)?,
                level: row.get(2)?,
                severity: row.get(3)?,
                source: row.get(4)?,
                message: row.get(5)?,
                details_json: row.get(6)?,
            })
        })
        .map_err(|e| format!("failed to query app logs: {e}"))?;

    let mut out: Vec<AppLogEntry> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read app log row: {e}"))?);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{ensure_workspace_logs_table, level_to_severity, normalize_level};
    use rusqlite::Connection;

    #[test]
    fn maps_log_level_to_severity() {
        assert_eq!(level_to_severity("error"), 40);
        assert_eq!(level_to_severity("warn"), 30);
        assert_eq!(level_to_severity("info"), 20);
        assert_eq!(level_to_severity("debug"), 10);
        assert_eq!(level_to_severity("unknown"), 20);
    }

    #[test]
    fn normalizes_log_levels() {
        assert_eq!(normalize_level("ERROR"), ("error", 40));
        assert_eq!(normalize_level("Warn"), ("warn", 30));
        assert_eq!(normalize_level("INFO"), ("info", 20));
        assert_eq!(normalize_level("DEBUG"), ("debug", 10));
        assert_eq!(normalize_level("???"), ("info", 20));
    }

    #[test]
    fn ensures_workspace_logs_table() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        ensure_workspace_logs_table(&conn).expect("ensure table");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspace_logs';",
                [],
                |row| row.get(0),
            )
            .expect("query sqlite_master");
        assert_eq!(count, 1);
    }
}

#[tauri::command]
pub fn count_workspace_logs_to_delete(
    app: tauri::AppHandle,
    name: String,
    filter: Option<WorkspaceLogDeleteFilter>,
) -> Result<i64, String> {
    let conn = open_workspace_db(&app, &name)?;
    ensure_workspace_logs_table(&conn)?;

    let older_than_iso = filter.and_then(|f| f.older_than_iso);

    if let Some(ts) = older_than_iso {
        let mut stmt = conn
            .prepare("SELECT COUNT(*) FROM workspace_logs WHERE ts_iso < ?1;")
            .map_err(|e| format!("failed to prepare workspace log count query: {e}"))?;
        let count = stmt
            .query_row(params![ts], |row| row.get::<usize, i64>(0))
            .map_err(|e| format!("failed to query workspace log count: {e}"))?;
        Ok(count)
    } else {
        let mut stmt = conn
            .prepare("SELECT COUNT(*) FROM workspace_logs;")
            .map_err(|e| format!("failed to prepare workspace log count query: {e}"))?;
        let count = stmt
            .query_row([], |row| row.get::<usize, i64>(0))
            .map_err(|e| format!("failed to query workspace log count: {e}"))?;
        Ok(count)
    }
}

#[tauri::command]
pub fn delete_workspace_logs(
    app: tauri::AppHandle,
    name: String,
    filter: Option<WorkspaceLogDeleteFilter>,
) -> Result<i64, String> {
    let conn = open_workspace_db(&app, &name)?;
    ensure_workspace_logs_table(&conn)?;

    let older_than_iso = filter.and_then(|f| f.older_than_iso);

    let affected = if let Some(ts) = older_than_iso.as_deref() {
        conn.execute("DELETE FROM workspace_logs WHERE ts_iso < ?1;", params![ts])
            .map_err(|e| format!("failed to delete workspace logs: {e}"))?
    } else {
        conn.execute("DELETE FROM workspace_logs;", [])
            .map_err(|e| format!("failed to delete workspace logs: {e}"))?
    };

    let payload = WorkspaceLogsDeletedPayload {
        workspace: name,
        deleted_count: affected as i64,
        older_than_iso,
    };
    let _ = app.emit("workspace_logs_deleted", &payload);

    Ok(payload.deleted_count)
}

#[tauri::command]
pub fn list_workspace_logs(
    app: tauri::AppHandle,
    name: String,
    filter: Option<LogListFilter>,
) -> Result<Vec<WorkspaceLogEntry>, String> {
    let filter = filter.unwrap_or(LogListFilter {
        min_level: None,
        limit: None,
    });
    let min_level = filter.min_level.unwrap_or_else(|| "debug".to_string());
    let min_severity = level_to_severity(&min_level);
    let limit = filter.limit.unwrap_or(200).max(1).min(1000);

    let conn = open_workspace_db(&app, &name)?;

    ensure_workspace_logs_table(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, ts_iso, level, severity, source, message, details_json
             FROM workspace_logs
             WHERE severity >= ?1
             ORDER BY id DESC
             LIMIT ?2;",
        )
        .map_err(|e| format!("failed to prepare workspace log query: {e}"))?;

    let rows = stmt
        .query_map(params![min_severity, limit], |row| {
            Ok(WorkspaceLogEntry {
                id: row.get(0)?,
                ts_iso: row.get(1)?,
                level: row.get(2)?,
                severity: row.get(3)?,
                source: row.get(4)?,
                message: row.get(5)?,
                details_json: row.get(6)?,
            })
        })
        .map_err(|e| format!("failed to query workspace logs: {e}"))?;

    let mut out: Vec<WorkspaceLogEntry> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read workspace log row: {e}"))?);
    }

    Ok(out)
}
