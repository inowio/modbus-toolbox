use rusqlite::Connection;
use std::path::PathBuf;

use crate::workspace::load_workspace;

pub(crate) fn open_workspace_db(app: &tauri::AppHandle, name: &str) -> Result<Connection, String> {
    let (ws, folder) = load_workspace(app, name)?;
    ensure_workspace_db(&folder, &ws.db_file)?;
    let db_path = folder.join(&ws.db_file);
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("failed to open workspace db {:?}: {e}", db_path))?;

    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA wal_autocheckpoint = 2000;
         PRAGMA busy_timeout = 2000;",
    )
    .map_err(|e| format!("failed to configure workspace db pragmas: {e}"))?;
    Ok(conn)
}

pub(crate) fn ensure_workspace_db(workspace_folder: &PathBuf, db_file: &str) -> Result<(), String> {
    let db_path = workspace_folder.join(db_file);
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("failed to open workspace db {:?}: {e}", db_path))?;

    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("failed to enable foreign_keys: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|e| format!("failed to enable WAL mode: {e}"))?;

    // Single-shot schema for MVP: create all tables/indexes if they don't exist.
    conn.execute_batch(
        "BEGIN;
        CREATE TABLE IF NOT EXISTS settings_connection (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          kind TEXT NOT NULL,

          serial_port TEXT,
          serial_baud INTEGER,
          serial_parity TEXT,
          serial_data_bits INTEGER,
          serial_stop_bits INTEGER,
          serial_flow_control TEXT,

          tcp_host TEXT,
          tcp_port INTEGER,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS settings_client (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          response_timeout_ms INTEGER,
          connect_timeout_ms INTEGER,
          retries INTEGER,
          retry_delay_ms INTEGER,
          logging_min_level TEXT,
          logs_pane_open INTEGER,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS slaves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          unit_id INTEGER NOT NULL,
          poll_interval_ms INTEGER,
          connection_kind TEXT NOT NULL DEFAULT 'serial',
          address_offset INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS slave_register_rows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slave_id INTEGER NOT NULL,
          function_code INTEGER NOT NULL,
          address INTEGER NOT NULL,
          alias TEXT NOT NULL DEFAULT '',
          data_type TEXT NOT NULL,
          \"order\" TEXT NOT NULL DEFAULT 'ABCD',
          display_format TEXT NOT NULL,
          write_value INTEGER,
          updated_at TEXT NOT NULL,
          UNIQUE(slave_id, function_code, address),
          FOREIGN KEY(slave_id) REFERENCES slaves(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS traffic_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts_iso TEXT NOT NULL,
          function_kind TEXT NOT NULL,   -- read | write | poll | other
          packet_type TEXT NOT NULL,     -- request | response
          proto TEXT NOT NULL,           -- tcp | rtu
          dest_addr TEXT,                -- slave address/host
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
          decoded_data TEXT,
          FOREIGN KEY(slave_id) REFERENCES slaves(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_traffic_events_ts
          ON traffic_events(ts_iso);

        CREATE INDEX IF NOT EXISTS idx_traffic_events_slave_ts
          ON traffic_events(slave_id, ts_iso);

        CREATE TABLE IF NOT EXISTS analyzer_tiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          config_json TEXT NOT NULL DEFAULT '',
          polling_enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(id)
        );

        CREATE TABLE IF NOT EXISTS analyzer_tile_layouts (
          tile_id INTEGER NOT NULL,
          breakpoint TEXT NOT NULL,
          x INTEGER NOT NULL,
          y INTEGER NOT NULL,
          w INTEGER NOT NULL,
          h INTEGER NOT NULL,
          PRIMARY KEY(tile_id, breakpoint),
          FOREIGN KEY(tile_id) REFERENCES analyzer_tiles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS analyzer_signals (
          id TEXT PRIMARY KEY,
          slave_id INTEGER NOT NULL,
          connection_kind TEXT NOT NULL,
          function_kind TEXT NOT NULL,
          register_row_id INTEGER NOT NULL,
          decoder_json TEXT NOT NULL DEFAULT '',
          last_value_json TEXT,
          last_updated_ts_ms INTEGER,
          state TEXT NOT NULL DEFAULT 'DISCONNECTED',
          error_json TEXT,
          FOREIGN KEY(slave_id) REFERENCES slaves(id) ON DELETE RESTRICT,
          FOREIGN KEY(register_row_id) REFERENCES slave_register_rows(id) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS idx_analyzer_signals_slave
          ON analyzer_signals(slave_id);

        CREATE TABLE IF NOT EXISTS analyzer_tile_signals (
          tile_id INTEGER NOT NULL,
          signal_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'primary',
          poll_interval_ms INTEGER NOT NULL DEFAULT 1000,
          PRIMARY KEY(tile_id, signal_id),
          FOREIGN KEY(tile_id) REFERENCES analyzer_tiles(id) ON DELETE CASCADE,
          FOREIGN KEY(signal_id) REFERENCES analyzer_signals(id) ON DELETE CASCADE
        );
        COMMIT;",
    )
    .map_err(|e| format!("failed to initialize workspace db schema: {e}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO settings_connection (
            id, kind,
            serial_port, serial_baud, serial_parity, serial_data_bits, serial_stop_bits,
            tcp_host, tcp_port,
            updated_at
        ) VALUES (
            1, ?1,
            ?2, ?3, ?4, ?5, ?6,
            ?7, ?8,
            ?9
        );",
        (
            "serial".to_string(),
            Option::<String>::None,
            Option::<i64>::Some(9600),
            Option::<String>::Some("none".to_string()),
            Option::<i64>::Some(8),
            Option::<i64>::Some(1),
            Option::<String>::Some("127.0.0.1".to_string()),
            Option::<i64>::Some(502),
            Option::<String>::None,
        ),
    )
    .map_err(|e| format!("failed to seed default connection settings: {e}"))?;

    conn.execute(
        "UPDATE settings_connection
         SET serial_flow_control = 'none'
         WHERE id = 1 AND (serial_flow_control IS NULL OR serial_flow_control = '');",
        [],
    )
    .map_err(|e| format!("failed to seed default serial flow control: {e}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO settings_client (
            id,
            response_timeout_ms, connect_timeout_ms, retries, retry_delay_ms,
            logging_min_level,
            logs_pane_open,
            updated_at
        ) VALUES (
            1,
            ?1, ?2, ?3, ?4,
            ?5,
            ?6,
            ?7
        );",
        (
            Option::<i64>::Some(1000),
            Option::<i64>::Some(2000),
            Option::<i64>::Some(1),
            Option::<i64>::Some(200),
            Option::<String>::Some("info".to_string()),
            Option::<i64>::Some(0),
            Option::<String>::None,
        ),
    )
    .map_err(|e| format!("failed to seed default settings: {e}"))?;

    Ok(())
}
