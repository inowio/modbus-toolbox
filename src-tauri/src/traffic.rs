use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;

use std::collections::HashMap;
use std::sync::Mutex;

use crate::db::open_workspace_db;

#[derive(Default)]
pub struct TrafficCaptureState {
    enabled_by_workspace: Mutex<HashMap<String, bool>>,
}

impl TrafficCaptureState {
    fn is_enabled(&self, workspace: &str) -> bool {
        self.enabled_by_workspace
            .lock()
            .map(|m| *m.get(workspace).unwrap_or(&false))
            .unwrap_or(false)
    }

    fn set_enabled(&self, workspace: &str, enabled: bool) {
        if let Ok(mut m) = self.enabled_by_workspace.lock() {
            m.insert(workspace.to_string(), enabled);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficEventEntry {
    pub id: i64,
    pub ts_iso: String,
    pub function_kind: String, // read | write | poll | other
    pub packet_type: String,   // request | response
    pub proto: String,         // tcp | rtu
    pub dest_addr: Option<String>,
    pub slave_id: Option<i64>,
    pub unit_id: Option<i64>,
    pub function_code: Option<i64>,
    pub address: Option<i64>,
    pub quantity: Option<i64>,
    pub duration_ms: Option<i64>,
    pub ok: bool,
    pub error: Option<String>,
    pub checksum: Option<String>,
    pub data_hex: Option<String>,
    pub data_size: Option<i64>,
    pub decoded_data: Option<String>,
}

#[tauri::command]
pub fn set_traffic_capture_enabled(
    state: tauri::State<'_, TrafficCaptureState>,
    workspace: String,
    enabled: bool,
) -> Result<(), String> {
    let ws = workspace.trim();
    if ws.is_empty() {
        return Err("workspace is required".to_string());
    }
    state.set_enabled(ws, enabled);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficListFilter {
    /// Optional slave id to filter by.
    pub slave_id: Option<i64>,
    /// Return events with id greater than this value (useful for incremental polling).
    pub since_id: Option<i64>,
    /// Maximum number of rows to return (default: 200).
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficLogInput {
    pub function_kind: String, // read | write | poll | other
    pub packet_type: String,   // request | response
    pub proto: String,         // tcp | rtu
    pub dest_addr: Option<String>,
    pub slave_id: Option<i64>,
    pub unit_id: Option<i64>,
    pub function_code: Option<i64>,
    pub address: Option<i64>,
    pub quantity: Option<i64>,
    pub duration_ms: Option<i64>,
    pub ok: bool,
    pub error: Option<String>,
    pub checksum: Option<String>,
    pub data_hex: Option<String>,
    pub data_size: Option<i64>,
    pub decoded_data: Option<String>,
}

fn ensure_traffic_table(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS traffic_events (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           ts_iso TEXT NOT NULL,
           function_kind TEXT NOT NULL,
           packet_type TEXT NOT NULL,
           proto TEXT NOT NULL,
           dest_addr TEXT,
           slave_id INTEGER,
           unit_id INTEGER,
           function_code INTEGER,
           address INTEGER,
           quantity INTEGER,
           duration_ms INTEGER,
           ok INTEGER NOT NULL,
           error TEXT,
           checksum TEXT,
           data_hex TEXT,
           data_size INTEGER,
           decoded_data TEXT
         );",
        [],
    )
    .map_err(|e| format!("failed to ensure traffic_events table: {e}"))?;

    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrafficEventPushedPayload {
    pub workspace: String,
    pub entry: TrafficEventEntry,
}

pub fn log_traffic_event(
    app: &tauri::AppHandle,
    workspace: &str,
    input: TrafficLogInput,
) -> Result<(), String> {
    let capture_state = app.state::<TrafficCaptureState>();
    if !capture_state.is_enabled(workspace) {
        return Ok(());
    }

    let now = Utc::now().to_rfc3339();

    let conn = open_workspace_db(app, workspace)?;
    ensure_traffic_table(&conn)?;

    conn.execute(
        "INSERT INTO traffic_events (
           ts_iso,
           function_kind,
           packet_type,
           proto,
           dest_addr,
           slave_id,
           unit_id,
           function_code,
           address,
           quantity,
           duration_ms,
           ok,
           error,
           checksum,
           data_hex,
           data_size,
           decoded_data
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
         );",
        params![
            now,
            input.function_kind,
            input.packet_type,
            input.proto,
            input.dest_addr,
            input.slave_id,
            input.unit_id,
            input.function_code,
            input.address,
            input.quantity,
            input.duration_ms,
            if input.ok { 1 } else { 0 },
            input.error,
            input.checksum,
            input.data_hex,
            input.data_size,
            input.decoded_data,
        ],
    )
    .map_err(|e| format!("failed to insert traffic event: {e}"))?;

    let id = conn.last_insert_rowid();

    let entry = TrafficEventEntry {
        id,
        ts_iso: now,
        function_kind: input.function_kind,
        packet_type: input.packet_type,
        proto: input.proto,
        dest_addr: input.dest_addr,
        slave_id: input.slave_id,
        unit_id: input.unit_id,
        function_code: input.function_code,
        address: input.address,
        quantity: input.quantity,
        duration_ms: input.duration_ms,
        ok: input.ok,
        error: input.error,
        checksum: input.checksum,
        data_hex: input.data_hex,
        data_size: input.data_size,
        decoded_data: input.decoded_data,
    };

    let payload = TrafficEventPushedPayload {
        workspace: workspace.to_string(),
        entry,
    };

    let _ = app.emit("traffic_event_appended", &payload);

    Ok(())
}

#[tauri::command]
pub fn list_traffic_events(
    app: tauri::AppHandle,
    workspace: String,
    filter: TrafficListFilter,
) -> Result<Vec<TrafficEventEntry>, String> {
    let conn = open_workspace_db(&app, &workspace)?;
    ensure_traffic_table(&conn)?;

    let limit = filter.limit.unwrap_or(200);
    let limit = if limit <= 0 { 200 } else { limit.min(1000) };

    let mut stmt = conn
        .prepare(
            "SELECT
               id,
               ts_iso,
               function_kind,
               packet_type,
               proto,
               dest_addr,
               slave_id,
               unit_id,
               function_code,
               address,
               quantity,
               duration_ms,
               ok,
               error,
               checksum,
               data_hex,
               data_size,
               decoded_data
             FROM traffic_events
             WHERE (?1 IS NULL OR slave_id = ?1)
               AND (?2 IS NULL OR id > ?2)
             ORDER BY id ASC
             LIMIT ?3;",
        )
        .map_err(|e| format!("failed to prepare traffic_events query: {e}"))?;

    let rows = stmt
        .query_map(
            params![
                filter.slave_id,
                filter.since_id,
                limit,
            ],
            |row| {
                let ok_int: i64 = row.get(12)?;
                Ok(TrafficEventEntry {
                    id: row.get(0)?,
                    ts_iso: row.get(1)?,
                    function_kind: row.get(2)?,
                    packet_type: row.get(3)?,
                    proto: row.get(4)?,
                    dest_addr: row.get(5).ok(),
                    slave_id: row.get(6).ok(),
                    unit_id: row.get(7).ok(),
                    function_code: row.get(8).ok(),
                    address: row.get(9).ok(),
                    quantity: row.get(10).ok(),
                    duration_ms: row.get(11).ok(),
                    ok: ok_int != 0,
                    error: row.get(13).ok(),
                    checksum: row.get(14).ok(),
                    data_hex: row.get(15).ok(),
                    data_size: row.get(16).ok(),
                    decoded_data: row.get(17).ok(),
                })
            },
        )
        .map_err(|e| format!("failed to query traffic events: {e}"))?;

    let mut out: Vec<TrafficEventEntry> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read traffic_events row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn clear_traffic_events(app: tauri::AppHandle, workspace: String) -> Result<i64, String> {
    let conn = open_workspace_db(&app, &workspace)?;
    ensure_traffic_table(&conn)?;

    let affected = conn
        .execute("DELETE FROM traffic_events;", [])
        .map_err(|e| format!("failed to delete traffic events: {e}"))?;

    Ok(affected as i64)
}
