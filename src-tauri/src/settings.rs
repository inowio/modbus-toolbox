use crate::db::open_workspace_db;
use crate::models::{
    ClientSettings, ClientSettingsPatch, ConnectionSettings, ConnectionSettingsPatch,
};

fn default_connection_settings() -> ConnectionSettings {
    ConnectionSettings {
        kind: "serial".to_string(),
        serial_port: None,
        serial_baud: Some(9600),
        serial_parity: Some("none".to_string()),
        serial_data_bits: Some(8),
        serial_stop_bits: Some(1),
        serial_flow_control: Some("none".to_string()),
        tcp_host: Some("127.0.0.1".to_string()),
        tcp_port: Some(502),
    }
}

fn default_client_settings() -> ClientSettings {
    ClientSettings {
        response_timeout_ms: Some(1000),
        connect_timeout_ms: Some(2000),
        retries: Some(1),
        retry_delay_ms: Some(200),
        logging_min_level: Some("info".to_string()),
        logs_pane_open: Some(false),
    }
}

#[tauri::command]
pub fn get_connection_settings(
    app: tauri::AppHandle,
    name: String,
) -> Result<ConnectionSettings, String> {
    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(
            "SELECT kind,
                    serial_port, serial_baud, serial_parity, serial_data_bits, serial_stop_bits, serial_flow_control,
                    tcp_host, tcp_port
             FROM settings_connection
             WHERE id = 1;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| format!("failed to run query: {e}"))?;

    if let Some(row) = rows
        .next()
        .map_err(|e| format!("failed to read row: {e}"))?
    {
        Ok(ConnectionSettings {
            kind: row
                .get::<_, String>(0)
                .unwrap_or_else(|_| "serial".to_string()),
            serial_port: row.get(1).ok(),
            serial_baud: row.get(2).ok(),
            serial_parity: row.get(3).ok(),
            serial_data_bits: row.get(4).ok(),
            serial_stop_bits: row.get(5).ok(),
            serial_flow_control: row.get(6).ok(),
            tcp_host: row.get(7).ok(),
            tcp_port: row.get(8).ok(),
        })
    } else {
        Ok(default_connection_settings())
    }
}

#[tauri::command]
pub fn set_connection_settings(
    app: tauri::AppHandle,
    name: String,
    settings: ConnectionSettingsPatch,
    now_iso: String,
) -> Result<(), String> {
    let existing = get_connection_settings(app.clone(), name.clone())?;
    let conn = open_workspace_db(&app, &name)?;
    let merged = ConnectionSettings {
        kind: settings.kind,
        serial_port: settings.serial_port.unwrap_or(existing.serial_port),
        serial_baud: settings.serial_baud.unwrap_or(existing.serial_baud),
        serial_parity: settings.serial_parity.unwrap_or(existing.serial_parity),
        serial_data_bits: settings
            .serial_data_bits
            .unwrap_or(existing.serial_data_bits),
        serial_stop_bits: settings
            .serial_stop_bits
            .unwrap_or(existing.serial_stop_bits),
        serial_flow_control: settings
            .serial_flow_control
            .unwrap_or(existing.serial_flow_control),
        tcp_host: settings.tcp_host.unwrap_or(existing.tcp_host),
        tcp_port: settings.tcp_port.unwrap_or(existing.tcp_port),
    };

    conn.execute(
        "INSERT INTO settings_connection (
            id, kind,
            serial_port, serial_baud, serial_parity, serial_data_bits, serial_stop_bits, serial_flow_control,
            tcp_host, tcp_port,
            updated_at
        ) VALUES (
            1, ?1,
            ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9,
            ?10
        )
        ON CONFLICT(id) DO UPDATE SET
            kind=excluded.kind,
            serial_port=excluded.serial_port,
            serial_baud=excluded.serial_baud,
            serial_parity=excluded.serial_parity,
            serial_data_bits=excluded.serial_data_bits,
            serial_stop_bits=excluded.serial_stop_bits,
            serial_flow_control=excluded.serial_flow_control,
            tcp_host=excluded.tcp_host,
            tcp_port=excluded.tcp_port,
            updated_at=excluded.updated_at;",
        (
            merged.kind,
            merged.serial_port,
            merged.serial_baud,
            merged.serial_parity,
            merged.serial_data_bits,
            merged.serial_stop_bits,
            merged.serial_flow_control,
            merged.tcp_host,
            merged.tcp_port,
            now_iso,
        ),
    )
    .map_err(|e| format!("failed to save connection settings: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{default_client_settings, default_connection_settings};

    #[test]
    fn builds_default_connection_settings() {
        let settings = default_connection_settings();
        assert_eq!(settings.kind, "serial");
        assert_eq!(settings.serial_baud, Some(9600));
        assert_eq!(settings.serial_parity.as_deref(), Some("none"));
        assert_eq!(settings.tcp_host.as_deref(), Some("127.0.0.1"));
        assert_eq!(settings.tcp_port, Some(502));
    }

    #[test]
    fn builds_default_client_settings() {
        let settings = default_client_settings();
        assert_eq!(settings.response_timeout_ms, Some(1000));
        assert_eq!(settings.connect_timeout_ms, Some(2000));
        assert_eq!(settings.retries, Some(1));
        assert_eq!(settings.retry_delay_ms, Some(200));
        assert_eq!(settings.logging_min_level.as_deref(), Some("info"));
        assert_eq!(settings.logs_pane_open, Some(false));
    }
}

#[tauri::command]
pub fn get_client_settings(app: tauri::AppHandle, name: String) -> Result<ClientSettings, String> {
    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(
            "SELECT response_timeout_ms, connect_timeout_ms, retries, retry_delay_ms,
                    logging_min_level, logs_pane_open
             FROM settings_client
             WHERE id = 1;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| format!("failed to run query: {e}"))?;

    if let Some(row) = rows
        .next()
        .map_err(|e| format!("failed to read row: {e}"))?
    {
        let logs_pane_open_raw: Option<i64> = row.get(5).ok();
        let logs_pane_open = logs_pane_open_raw.map(|v| v != 0);
        Ok(ClientSettings {
            response_timeout_ms: row.get(0).ok(),
            connect_timeout_ms: row.get(1).ok(),
            retries: row.get(2).ok(),
            retry_delay_ms: row.get(3).ok(),
            logging_min_level: row.get(4).ok(),
            logs_pane_open,
        })
    } else {
        Ok(default_client_settings())
    }
}

#[tauri::command]
pub fn set_client_settings(
    app: tauri::AppHandle,
    name: String,
    settings: ClientSettingsPatch,
    now_iso: String,
) -> Result<(), String> {
    let existing = get_client_settings(app.clone(), name.clone())?;
    let conn = open_workspace_db(&app, &name)?;
    let merged = ClientSettings {
        response_timeout_ms: settings
            .response_timeout_ms
            .unwrap_or(existing.response_timeout_ms),
        connect_timeout_ms: settings
            .connect_timeout_ms
            .unwrap_or(existing.connect_timeout_ms),
        retries: settings.retries.unwrap_or(existing.retries),
        retry_delay_ms: settings.retry_delay_ms.unwrap_or(existing.retry_delay_ms),
        logging_min_level: settings
            .logging_min_level
            .unwrap_or(existing.logging_min_level),
        logs_pane_open: settings
            .logs_pane_open
            .unwrap_or(existing.logs_pane_open),
    };

    conn.execute(
        "INSERT INTO settings_client (
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
        )
        ON CONFLICT(id) DO UPDATE SET
            response_timeout_ms=excluded.response_timeout_ms,
            connect_timeout_ms=excluded.connect_timeout_ms,
            retries=excluded.retries,
            retry_delay_ms=excluded.retry_delay_ms,
            logging_min_level=excluded.logging_min_level,
            logs_pane_open=excluded.logs_pane_open,
            updated_at=excluded.updated_at;",
        (
            merged.response_timeout_ms,
            merged.connect_timeout_ms,
            merged.retries,
            merged.retry_delay_ms,
            merged.logging_min_level,
            merged
                .logs_pane_open
                .map(|v| if v { 1_i64 } else { 0_i64 }),
            now_iso,
        ),
    )
    .map_err(|e| format!("failed to save settings: {e}"))?;

    Ok(())
}
