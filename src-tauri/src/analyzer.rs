use crate::db::open_workspace_db;
use crate::models::{
    AnalyzerSignal, AnalyzerSignalUpsert, AnalyzerTile, AnalyzerTileCreate, AnalyzerTileLayout,
    AnalyzerTileLayoutUpsert, AnalyzerTileSignalInfo, AnalyzerTileUpdate,
};
use rusqlite::{params, OptionalExtension};

fn normalize_tile_inputs(kind: String, title: String, config_json: String) -> Result<(String, String, String), String> {
    let normalized_kind = kind.trim().to_lowercase();
    if normalized_kind != "widget" && normalized_kind != "chart" {
        return Err("tile kind must be 'widget' or 'chart'".to_string());
    }

    let normalized_title = title.trim().to_string();
    let normalized_config = config_json.trim().to_string();

    Ok((normalized_kind, normalized_title, normalized_config))
}

#[tauri::command]
pub fn list_analyzer_tile_layouts(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<AnalyzerTileLayout>, String> {
    let conn = open_workspace_db(&app, &name)?;
    let mut stmt = conn
        .prepare(
            "SELECT l.tile_id, l.breakpoint, l.x, l.y, l.w, l.h\n             FROM analyzer_tile_layouts l\n             JOIN analyzer_tiles t ON t.id = l.tile_id\n             ORDER BY l.tile_id ASC, l.breakpoint ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AnalyzerTileLayout {
                tile_id: row.get(0)?,
                breakpoint: row.get(1)?,
                x: row.get(2)?,
                y: row.get(3)?,
                w: row.get(4)?,
                h: row.get(5)?,
            })
        })
        .map_err(|e| format!("failed to query analyzer tile layouts: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer tile layout row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn update_analyzer_tile(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
    patch: AnalyzerTileUpdate,
    now_iso: String,
) -> Result<AnalyzerTile, String> {
    if tile_id <= 0 {
        return Err("tile_id must be > 0".to_string());
    }

    let (kind, title, config_json) =
        normalize_tile_inputs(patch.kind, patch.title, patch.config_json)?;

    let mut conn = open_workspace_db(&app, &name)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    let updated = tx
        .execute(
            "UPDATE analyzer_tiles\n             SET kind=?1, title=?2, config_json=?3, polling_enabled=?4, updated_at=?5\n             WHERE id=?6;",
            params![
                kind,
                title,
                config_json,
                if patch.polling_enabled { 1 } else { 0 },
                now_iso,
                tile_id
            ],
        )
        .map_err(|e| format!("failed to update analyzer tile: {e}"))?;

    if updated == 0 {
        return Err("tile not found".to_string());
    }

    tx.execute(
        "DELETE FROM analyzer_tile_signals WHERE tile_id = ?1;",
        (tile_id,),
    )
    .map_err(|e| format!("failed to clear tile signals: {e}"))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO analyzer_tile_signals (tile_id, signal_id, role)\n                 VALUES (?1, ?2, ?3);",
            )
            .map_err(|e| format!("failed to prepare tile signal insert: {e}"))?;

        for link in patch.signal_links {
            let role = link.role.trim();
            if role.is_empty() {
                return Err("signal link role is required".to_string());
            }
            let signal_id = link.signal_id.trim();
            if signal_id.is_empty() {
                return Err("signal_id is required".to_string());
            }
            stmt.execute(params![tile_id, signal_id, role])
                .map_err(|e| format!("failed to link tile signal: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    let conn = open_workspace_db(&app, &name)?;
    conn.query_row(
        "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at\n         FROM analyzer_tiles\n         WHERE id = ?1;",
        (tile_id,),
        |row| {
            let polling_int: i64 = row.get(4)?;
            Ok(AnalyzerTile {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                config_json: row.get(3)?,
                polling_enabled: polling_int != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| format!("failed to read updated analyzer tile: {e}"))
}

#[tauri::command]
pub fn list_analyzer_tiles(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<AnalyzerTile>, String> {
    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at\n             FROM analyzer_tiles\n             ORDER BY id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let polling_int: i64 = row.get(4)?;
            Ok(AnalyzerTile {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                config_json: row.get(3)?,
                polling_enabled: polling_int != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("failed to query analyzer tiles: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer tile row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn create_analyzer_tile(
    app: tauri::AppHandle,
    name: String,
    tile: AnalyzerTileCreate,
    now_iso: String,
) -> Result<AnalyzerTile, String> {
    let (kind, title, config_json) =
        normalize_tile_inputs(tile.kind, tile.title, tile.config_json)?;

    let mut conn = open_workspace_db(&app, &name)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    tx.execute(
        "INSERT INTO analyzer_tiles (kind, title, config_json, polling_enabled, created_at, updated_at)\n         VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
        params![
            kind,
            title,
            config_json,
            if tile.polling_enabled { 1 } else { 0 },
            now_iso.clone(),
            now_iso.clone()
        ],
    )
    .map_err(|e| format!("failed to create analyzer tile: {e}"))?;

    let tile_id = tx.last_insert_rowid();

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO analyzer_tile_layouts (tile_id, breakpoint, x, y, w, h)\n                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)\n                 ON CONFLICT(tile_id, breakpoint) DO UPDATE SET\n                   x=excluded.x, y=excluded.y, w=excluded.w, h=excluded.h;",
            )
            .map_err(|e| format!("failed to prepare layouts insert: {e}"))?;

        for l in tile.layouts {
            stmt.execute(params![tile_id, l.breakpoint, l.x, l.y, l.w, l.h])
                .map_err(|e| format!("failed to upsert tile layout: {e}"))?;
        }
    }

    {
        let mut stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO analyzer_tile_signals (tile_id, signal_id, role)\n                 VALUES (?1, ?2, ?3);",
            )
            .map_err(|e| format!("failed to prepare tile signal insert: {e}"))?;

        for link in tile.signal_links {
            stmt.execute(params![tile_id, link.signal_id.trim(), link.role.trim()])
                .map_err(|e| format!("failed to link tile signal: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    let conn = open_workspace_db(&app, &name)?;
    conn.query_row(
        "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at\n         FROM analyzer_tiles\n         WHERE id = ?1;",
        (tile_id,),
        |row| {
            let polling_int: i64 = row.get(4)?;
            Ok(AnalyzerTile {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                config_json: row.get(3)?,
                polling_enabled: polling_int != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| format!("failed to read created analyzer tile: {e}"))
}

#[cfg(test)]
mod tests {
    use super::normalize_tile_inputs;

    #[test]
    fn normalizes_tile_inputs() {
        let (kind, title, config) = normalize_tile_inputs(
            " Widget ".to_string(),
            "  Title  ".to_string(),
            "  {}  ".to_string(),
        )
        .expect("normalize");

        assert_eq!(kind, "widget");
        assert_eq!(title, "Title");
        assert_eq!(config, "{}");
    }

    #[test]
    fn rejects_invalid_tile_kind() {
        let err = normalize_tile_inputs("bad".to_string(), "t".to_string(), "{}".to_string())
            .expect_err("expected error");
        assert_eq!(err, "tile kind must be 'widget' or 'chart'");
    }
}

#[tauri::command]
pub fn save_analyzer_tile_layouts(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
    layouts: Vec<AnalyzerTileLayoutUpsert>,
) -> Result<(), String> {
    let mut conn = open_workspace_db(&app, &name)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO analyzer_tile_layouts (tile_id, breakpoint, x, y, w, h)\n                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)\n                 ON CONFLICT(tile_id, breakpoint) DO UPDATE SET\n                   x=excluded.x, y=excluded.y, w=excluded.w, h=excluded.h;",
            )
            .map_err(|e| format!("failed to prepare layout upsert: {e}"))?;

        for l in layouts {
            stmt.execute(params![tile_id, l.breakpoint, l.x, l.y, l.w, l.h])
                .map_err(|e| format!("failed to upsert layout: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn delete_analyzer_tile(app: tauri::AppHandle, name: String, tile_id: i64) -> Result<(), String> {
    let conn = open_workspace_db(&app, &name)?;
    conn.execute("DELETE FROM analyzer_tiles WHERE id = ?1;", (tile_id,))
        .map_err(|e| format!("failed to delete analyzer tile: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_analyzer_signal(app: tauri::AppHandle, name: String, signal_id: String) -> Result<(), String> {
    let id = signal_id.trim();
    if id.is_empty() {
        return Err("signal_id is required".to_string());
    }

    let conn = open_workspace_db(&app, &name)?;
    conn.execute("DELETE FROM analyzer_signals WHERE id = ?1;", (id,))
        .map_err(|e| format!("failed to delete analyzer signal: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn set_analyzer_tile_polling_enabled(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
    polling_enabled: bool,
    now_iso: String,
) -> Result<AnalyzerTile, String> {
    if tile_id <= 0 {
        return Err("tile_id must be > 0".to_string());
    }

    let conn = open_workspace_db(&app, &name)?;
    conn.execute(
        "UPDATE analyzer_tiles\n         SET polling_enabled=?1, updated_at=?2\n         WHERE id=?3;",
        params![if polling_enabled { 1 } else { 0 }, now_iso, tile_id],
    )
    .map_err(|e| format!("failed to update tile polling: {e}"))?;

    conn.query_row(
        "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at\n         FROM analyzer_tiles\n         WHERE id = ?1;",
        (tile_id,),
        |row| {
            let polling_int: i64 = row.get(4)?;
            Ok(AnalyzerTile {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                config_json: row.get(3)?,
                polling_enabled: polling_int != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| format!("failed to read updated tile: {e}"))
}

#[tauri::command]
pub fn list_analyzer_tile_signals(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
) -> Result<Vec<AnalyzerTileSignalInfo>, String> {
    if tile_id <= 0 {
        return Err("tile_id must be > 0".to_string());
    }

    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(
            "SELECT
                ats.tile_id,
                ats.signal_id,
                ats.role,
                rr.function_code,
                rr.address,
                rr.alias,
                rr.data_type,
                rr.\"order\",
                rr.display_format,
                s.decoder_json,
                s.last_value_json,
                s.last_updated_ts_ms,
                s.state,
                s.error_json
             FROM analyzer_tile_signals ats
             JOIN analyzer_signals s ON s.id = ats.signal_id
             JOIN slave_register_rows rr ON rr.id = s.register_row_id
             WHERE ats.tile_id = ?1
             ORDER BY ats.signal_id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map((tile_id,), |row| {
            Ok(AnalyzerTileSignalInfo {
                tile_id: row.get(0)?,
                signal_id: row.get(1)?,
                role: row.get(2)?,
                function_code: row.get(3)?,
                address: row.get(4)?,
                alias: row.get(5)?,
                data_type: row.get(6)?,
                order: row.get(7)?,
                display_format: row.get(8)?,
                decoder_json: row.get(9)?,
                last_value_json: row.get(10).ok(),
                last_updated_ts_ms: row.get(11).ok(),
                state: row.get(12)?,
                error_json: row.get(13).ok(),
            })
        })
        .map_err(|e| format!("failed to query analyzer tile signals: {e}"))?;

    let mut out: Vec<AnalyzerTileSignalInfo> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer tile signal row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn upsert_analyzer_signal(
    app: tauri::AppHandle,
    name: String,
    signal: AnalyzerSignalUpsert,
) -> Result<AnalyzerSignal, String> {
    if signal.id.trim().is_empty() {
        return Err("signal id is required".to_string());
    }

    let conn = open_workspace_db(&app, &name)?;

    let effective_connection_kind: String = conn
        .query_row(
            "SELECT connection_kind FROM slaves WHERE id = ?1;",
            (signal.slave_id,),
            |row| row.get(0),
        )
        .map_err(|e| format!("failed to resolve slave connection_kind: {e}"))?;

    let function_kind_lc = signal.function_kind.trim().to_lowercase();
    if function_kind_lc.is_empty() {
        return Err("function_kind is required".to_string());
    }

    let address: i64 = conn
        .query_row(
            "SELECT address FROM slave_register_rows WHERE id = ?1;",
            (signal.register_row_id,),
            |row| row.get(0),
        )
        .map_err(|e| format!("failed to resolve register row address: {e}"))?;

    let existing_id: Option<String> = conn
        .query_row(
            "SELECT s.id
             FROM analyzer_signals s
             JOIN slave_register_rows rr ON rr.id = s.register_row_id
             WHERE s.slave_id = ?1
               AND lower(s.function_kind) = ?2
               AND rr.address = ?3
               AND s.id <> ?4
             LIMIT 1;",
            params![signal.slave_id, function_kind_lc, address, signal.id.trim()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("failed to check duplicate analyzer signal: {e}"))?;

    if let Some(existing_id) = existing_id {
        return Err(format!(
            "Signal already exists for Slave {} {} Addr {} (existing: {})",
            signal.slave_id,
            signal.function_kind.trim().to_uppercase(),
            address,
            existing_id
        ));
    }

    conn.execute(
        "INSERT INTO analyzer_signals (
            id,
            slave_id,
            connection_kind,
            function_kind,
            register_row_id,
            decoder_json,
            last_value_json,
            last_updated_ts_ms,
            state,
            error_json
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            NULL, NULL, 'DISCONNECTED', NULL
        )
        ON CONFLICT(id) DO UPDATE SET
            slave_id=excluded.slave_id,
            connection_kind=excluded.connection_kind,
            function_kind=excluded.function_kind,
            register_row_id=excluded.register_row_id,
            decoder_json=excluded.decoder_json;",
        params![
            signal.id.trim(),
            signal.slave_id,
            effective_connection_kind.trim(),
            signal.function_kind.trim(),
            signal.register_row_id,
            signal.decoder_json.trim(),
        ],
    )
    .map_err(|e| format!("failed to upsert analyzer signal: {e}"))?;

    let out: AnalyzerSignal = conn
        .query_row(
            "SELECT s.id, s.slave_id, sl.connection_kind, s.function_kind, s.register_row_id,
                    rr.address,
                    s.decoder_json,
                    s.last_value_json, s.last_updated_ts_ms,
                    s.state, s.error_json
             FROM analyzer_signals s
             JOIN slave_register_rows rr ON rr.id = s.register_row_id
             JOIN slaves sl ON sl.id = s.slave_id
             WHERE s.id = ?1;",
            (signal.id.trim(),),
            |row| {
                Ok(AnalyzerSignal {
                    id: row.get(0)?,
                    slave_id: row.get(1)?,
                    connection_kind: row.get::<_, String>(2).unwrap_or_else(|_| "".to_string()),
                    function_kind: row.get(3)?,
                    register_row_id: row.get(4)?,
                    address: row.get(5)?,
                    decoder_json: row.get(6)?,
                    last_value_json: row.get(7).ok(),
                    last_updated_ts_ms: row.get(8).ok(),
                    state: row.get(9)?,
                    error_json: row.get(10).ok(),
                })
            },
        )
        .map_err(|e| format!("failed to read analyzer signal: {e}"))?;

    Ok(out)
}

#[tauri::command]
pub fn list_analyzer_signals(app: tauri::AppHandle, name: String) -> Result<Vec<AnalyzerSignal>, String> {
    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.slave_id, sl.connection_kind, s.function_kind, s.register_row_id,
                    rr.address,
                    s.decoder_json,
                    s.last_value_json, s.last_updated_ts_ms,
                    s.state, s.error_json
             FROM analyzer_signals s
             JOIN slaves sl ON sl.id = s.slave_id
             JOIN slave_register_rows rr ON rr.id = s.register_row_id
             ORDER BY s.id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AnalyzerSignal {
                id: row.get(0)?,
                slave_id: row.get(1)?,
                connection_kind: row.get(2)?,
                function_kind: row.get(3)?,
                register_row_id: row.get(4)?,
                address: row.get(5)?,
                decoder_json: row.get(6)?,
                last_value_json: row.get(7).ok(),
                last_updated_ts_ms: row.get(8).ok(),
                state: row.get(9)?,
                error_json: row.get(10).ok(),
            })
        })
        .map_err(|e| format!("failed to query analyzer signals: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer signal row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn can_delete_slave_register_row(
    app: tauri::AppHandle,
    name: String,
    register_row_id: i64,
) -> Result<bool, String> {
    let conn = open_workspace_db(&app, &name)?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM analyzer_signals WHERE register_row_id = ?1;",
            (register_row_id,),
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(count == 0)
}
