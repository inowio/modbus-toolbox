use std::borrow::Cow;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{timeout, Duration};
use tokio_modbus::client;
use tokio_modbus::prelude::*;
use tokio_serial::{DataBits, FlowControl, Parity, SerialPortBuilderExt, StopBits};

use serde::Serialize;
use serde_json::json;

use crate::db::open_workspace_db;
use crate::logs::log_workspace_event;
use crate::models::ConnectionSettings;
use crate::traffic::{log_traffic_event, TrafficLogInput};
use crate::settings::{get_client_settings, get_connection_settings};
use crate::workspace::validate_workspace_name;

#[derive(Default)]
pub struct ModbusState {
    pub(crate) tcp_sessions: Mutex<HashMap<String, Arc<AsyncMutex<client::Context>>>>,
    pub(crate) rtu_sessions: Mutex<HashMap<String, Arc<AsyncMutex<client::Context>>>>,
}

#[derive(Debug, Serialize)]
pub struct DeviceIdItem {
    pub id: u8,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct DiagnosticsEchoResult {
    pub data: u16,
}

fn clamp_timeout_ms(v: Option<i64>, default_ms: i64) -> u64 {
    let ms = v.unwrap_or(default_ms);
    let ms = if ms <= 0 { default_ms } else { ms };
    ms as u64
}

/// Encode a sequence of coil/discrete values (bools) into packed-byte hex and size in bytes.
fn encode_bools_to_hex(values: &[bool]) -> (Option<String>, Option<i64>) {
    if values.is_empty() {
        return (None, None);
    }

    let byte_count = (values.len() + 7) / 8;
    let mut bytes = vec![0u8; byte_count];

    for (i, bit) in values.iter().enumerate() {
        if *bit {
            let byte_index = i / 8;
            let bit_index = i % 8;
            bytes[byte_index] |= 1 << bit_index;
        }
    }

    let hex = bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ");

    (Some(hex), Some(byte_count as i64))
}

fn drop_tcp_session(state: &tauri::State<'_, ModbusState>, workspace: &str) -> Result<(), String> {
    let mut guard = state
        .tcp_sessions
        .lock()
        .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
    guard.remove(workspace);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ConnectionSettings;
    use tokio_serial::{DataBits, FlowControl, Parity, StopBits};

    fn tcp_settings(port: Option<i64>) -> ConnectionSettings {
        ConnectionSettings {
            kind: "tcp".to_string(),
            serial_port: None,
            serial_baud: None,
            serial_parity: None,
            serial_data_bits: None,
            serial_stop_bits: None,
            serial_flow_control: None,
            tcp_host: Some("127.0.0.1".to_string()),
            tcp_port: port,
        }
    }

    #[test]
    fn clamps_timeout_values() {
        assert_eq!(clamp_timeout_ms(None, 2000), 2000);
        assert_eq!(clamp_timeout_ms(Some(-5), 2000), 2000);
        assert_eq!(clamp_timeout_ms(Some(1500), 2000), 1500);
    }

    #[test]
    fn encodes_bool_values_to_hex() {
        let empty = encode_bools_to_hex(&[]);
        assert_eq!(empty, (None, None));

        let (hex, size) = encode_bools_to_hex(&[true, false, true, false, true, false, true, false, true]);
        assert_eq!(hex.as_deref(), Some("55 01"));
        assert_eq!(size, Some(2));
    }

    #[test]
    fn parses_serial_settings() {
        assert!(matches!(parse_serial_parity(None), Ok(Parity::None)));
        assert!(matches!(parse_serial_parity(Some("odd".to_string())), Ok(Parity::Odd)));
        assert!(parse_serial_parity(Some("bad".to_string())).is_err());

        assert!(matches!(parse_serial_data_bits(None), Ok(DataBits::Eight)));
        assert!(matches!(parse_serial_data_bits(Some(7)), Ok(DataBits::Seven)));
        assert!(parse_serial_data_bits(Some(9)).is_err());

        assert!(matches!(parse_serial_stop_bits(None), Ok(StopBits::One)));
        assert!(matches!(parse_serial_stop_bits(Some(2)), Ok(StopBits::Two)));
        assert!(parse_serial_stop_bits(Some(3)).is_err());

        assert!(matches!(parse_serial_flow_control(None), Ok(FlowControl::None)));
        assert!(matches!(parse_serial_flow_control(Some("rtscts".to_string())), Ok(FlowControl::Hardware)));
        assert!(parse_serial_flow_control(Some("bad".to_string())).is_err());
    }

    #[test]
    fn validates_unit_ids() {
        assert!(normalize_unit_id(0).is_ok());
        assert!(normalize_unit_id(255).is_ok());
        assert!(normalize_unit_id(-1).is_err());
        assert!(normalize_unit_id(256).is_err());
    }

    #[test]
    fn computes_effective_address() {
        assert_eq!(compute_effective_address(0, 1, 0).unwrap(), (0, 1));
        assert!(compute_effective_address(-1, 1, 0).is_err());
        assert!(compute_effective_address(1, 0, 0).is_err());
        assert!(compute_effective_address(1, 1, -5).is_err());
        assert!(compute_effective_address(65535, 2, 0).is_err());
    }

    #[test]
    fn builds_tcp_socket_address() {
        let addr = workspace_tcp_addr(&tcp_settings(Some(502))).unwrap();
        assert_eq!(addr.to_string(), "127.0.0.1:502");
        assert!(workspace_tcp_addr(&tcp_settings(Some(70000))).is_err());
    }
}

fn lookup_slave_id_and_address_offset(
    app: &tauri::AppHandle,
    workspace: &str,
    unit_id: i64,
    connection_kind: &str,
) -> (Option<i64>, i64) {
    let conn = match open_workspace_db(app, workspace) {
        Ok(c) => c,
        Err(_) => return (None, 0),
    };

    let res: rusqlite::Result<(i64, i64)> = conn.query_row(
        "SELECT id, address_offset FROM slaves WHERE unit_id = ?1 AND connection_kind = ?2;",
        (unit_id, connection_kind),
        |row| Ok((row.get(0)?, row.get(1)?)),
    );

    match res {
        Ok((id, offset)) => (Some(id), offset),
        Err(_) => (None, 0),
    }
}

#[tauri::command]
pub async fn test_connection(
    app: tauri::AppHandle,
    _state: tauri::State<'_, ModbusState>,
    name: String,
    settings: ConnectionSettings,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;

    match settings.kind.as_str() {
        "tcp" => {
            // Use provided TCP settings to attempt a one-shot connection without
            // touching the shared tcp_sessions map.
            let socket_addr = workspace_tcp_addr(&settings)?;
            let slave = Slave(normalize_unit_id(1)?);

            let master_settings = get_client_settings(app.clone(), ws.to_string())?;
            let connect_timeout_ms = clamp_timeout_ms(master_settings.connect_timeout_ms, 2000);

            let _ctx = timeout(
                Duration::from_millis(connect_timeout_ms),
                client::tcp::connect_slave(socket_addr, slave),
            )
            .await
            .map_err(|_| format!("modbus connect timed out after {connect_timeout_ms} ms"))?
            .map_err(|e| format!("failed to connect modbus tcp: {e}"))?;

            Ok(())
        }
        "serial" => {
            // Use provided serial settings to attempt a one-shot RTU connection
            // without touching the shared rtu_sessions map.
            let port = settings
                .serial_port
                .clone()
                .ok_or_else(|| "serial port not set".to_string())?;
            let baud = settings.serial_baud.unwrap_or(9600);
            if baud <= 0 {
                return Err("serial baud must be > 0".to_string());
            }

            let parity = parse_serial_parity(settings.serial_parity.clone())?;
            let data_bits = parse_serial_data_bits(settings.serial_data_bits)?;
            let stop_bits = parse_serial_stop_bits(settings.serial_stop_bits)?;
            let flow_control = parse_serial_flow_control(settings.serial_flow_control.clone())?;

            let builder = tokio_serial::new(port, baud as u32)
                .parity(parity)
                .data_bits(data_bits)
                .stop_bits(stop_bits)
                .flow_control(flow_control);

            let serial = builder
                .open_native_async()
                .map_err(|e| format!("failed to open serial port: {e}"))?;

            let _ctx = client::rtu::attach_slave(serial, Slave(normalize_unit_id(1)?));

            Ok(())
        }
        other => Err(format!("Unsupported connection kind: {other}")),
    }
}

fn drop_rtu_session(state: &tauri::State<'_, ModbusState>, workspace: &str) -> Result<(), String> {
    let mut guard = state
        .rtu_sessions
        .lock()
        .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
    guard.remove(workspace);
    Ok(())
}

fn parse_serial_parity(s: Option<String>) -> Result<Parity, String> {
    let v = s.unwrap_or_else(|| "none".to_string()).to_lowercase();
    match v.as_str() {
        "none" => Ok(Parity::None),
        "even" => Ok(Parity::Even),
        "odd" => Ok(Parity::Odd),
        _ => Err("unsupported serial parity (expected none/even/odd)".to_string()),
    }
}

fn parse_serial_data_bits(v: Option<i64>) -> Result<DataBits, String> {
    match v.unwrap_or(8) {
        5 => Ok(DataBits::Five),
        6 => Ok(DataBits::Six),
        7 => Ok(DataBits::Seven),
        8 => Ok(DataBits::Eight),
        _ => Err("unsupported serial data bits (expected 5/6/7/8)".to_string()),
    }
}

fn parse_serial_stop_bits(v: Option<i64>) -> Result<StopBits, String> {
    match v.unwrap_or(1) {
        1 => Ok(StopBits::One),
        2 => Ok(StopBits::Two),
        _ => Err("unsupported serial stop bits (expected 1/2)".to_string()),
    }
}

fn parse_serial_flow_control(s: Option<String>) -> Result<FlowControl, String> {
    let v = s.unwrap_or_else(|| "none".to_string()).to_lowercase();
    match v.as_str() {
        "none" => Ok(FlowControl::None),
        "hardware" | "rtscts" => Ok(FlowControl::Hardware),
        "software" | "xonxoff" => Ok(FlowControl::Software),
        _ => Err("unsupported serial flow control (expected none/hardware/software)".to_string()),
    }
}

fn normalize_unit_id(unit_id: i64) -> Result<u8, String> {
    if !(0..=255).contains(&unit_id) {
        return Err("unitId must be in range 0..255".to_string());
    }
    Ok(unit_id as u8)
}

fn compute_effective_address(
    start_address: i64,
    quantity: i64,
    address_offset: i64,
) -> Result<(u16, u16), String> {
    if start_address < 0 {
        return Err("start address cannot be negative".to_string());
    }
    if quantity <= 0 {
        return Err("quantity must be > 0".to_string());
    }

    let effective = start_address
        .checked_add(address_offset)
        .ok_or_else(|| "address calculation overflow".to_string())?;
    if effective < 0 {
        return Err(format!(
            "address underflow after applying base-address offset (address={start_address}, offset={address_offset})"
        ));
    }

    let eff_u16: u16 = u16::try_from(effective)
        .map_err(|_| "effective start address must be in range 0..65535".to_string())?;
    let qty_u16: u16 =
        u16::try_from(quantity).map_err(|_| "quantity must be in range 1..65535".to_string())?;

    let end_exclusive = (eff_u16 as u32) + (qty_u16 as u32);
    if end_exclusive > 65536 {
        return Err("address range exceeds 0..65535".to_string());
    }

    Ok((eff_u16, qty_u16))
}

fn workspace_tcp_addr(settings: &ConnectionSettings) -> Result<SocketAddr, String> {
    let host = settings
        .tcp_host
        .clone()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let port = settings.tcp_port.unwrap_or(502);
    if !(0..=65535).contains(&port) {
        return Err("TCP port must be in range 0..65535".to_string());
    }
    let socket = format!("{}:{}", host.trim(), port);
    socket
        .parse::<SocketAddr>()
        .map_err(|e| format!("invalid TCP host/port: {e}"))
}

async fn ensure_tcp_session(
    state: &tauri::State<'_, ModbusState>,
    app: &tauri::AppHandle,
    workspace: &str,
    unit_id: i64,
) -> Result<(), String> {
    {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        if guard.contains_key(workspace) {
            return Ok(());
        }
    }

    let conn_settings = get_connection_settings(app.clone(), workspace.to_string())?;

    // Note: we no longer enforce conn_settings.kind == "tcp" here.
    // settings_connection.kind is treated as a UI preference; slaves can choose
    // their own connectionKind independently.
    let socket_addr = workspace_tcp_addr(&conn_settings)?;
    let slave = Slave(normalize_unit_id(unit_id)?);

    let master_settings = get_client_settings(app.clone(), workspace.to_string())?;
    let connect_timeout_ms = clamp_timeout_ms(master_settings.connect_timeout_ms, 2000);
    let ctx = timeout(
        Duration::from_millis(connect_timeout_ms),
        client::tcp::connect_slave(socket_addr, slave),
    )
    .await
    .map_err(|_| format!("modbus connect timed out after {connect_timeout_ms} ms"))?
    .map_err(|e| format!("failed to connect modbus tcp: {e}"))?;

    let mut guard = state
        .tcp_sessions
        .lock()
        .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
    guard
        .entry(workspace.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(ctx)));
    Ok(())
}

async fn probe_rtu_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    workspace: &str,
    unit_id: i64,
) -> Result<(), String> {
    let master = get_client_settings(app.clone(), workspace.to_string())?;
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(workspace)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));

    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_holding_registers(0, 1),
    )
    .await
    .map_err(|_| format!("modbus request timed out after {timeout_ms} ms"))?
    .map_err(|e| format!("modbus probe failed: {e}"))?;

    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("modbus probe exception: {e}")),
    }
}

async fn ensure_rtu_session(
    state: &tauri::State<'_, ModbusState>,
    app: &tauri::AppHandle,
    workspace: &str,
    unit_id: i64,
) -> Result<(), String> {
    {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        if guard.contains_key(workspace) {
            return Ok(());
        }
    }

    let conn_settings = get_connection_settings(app.clone(), workspace.to_string())?;

    // Note: we no longer enforce conn_settings.kind == "serial" here.
    // settings_connection.kind is treated as a UI preference; slaves can choose
    // their own connectionKind independently.
    let port = conn_settings
        .serial_port
        .clone()
        .ok_or_else(|| "serial port not set".to_string())?;
    let baud = conn_settings.serial_baud.unwrap_or(9600);
    if baud <= 0 {
        return Err("serial baud must be > 0".to_string());
    }

    let parity = parse_serial_parity(conn_settings.serial_parity.clone())?;
    let data_bits = parse_serial_data_bits(conn_settings.serial_data_bits)?;
    let stop_bits = parse_serial_stop_bits(conn_settings.serial_stop_bits)?;
    let flow_control = parse_serial_flow_control(conn_settings.serial_flow_control.clone())?;

    let builder = tokio_serial::new(port, baud as u32)
        .parity(parity)
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .flow_control(flow_control);

    let serial = builder
        .open_native_async()
        .map_err(|e| format!("failed to open serial port: {e}"))?;

    let ctx = client::rtu::attach_slave(serial, Slave(normalize_unit_id(unit_id)?));

    let mut guard = state
        .rtu_sessions
        .lock()
        .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
    guard
        .entry(workspace.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(ctx)));
    Ok(())
}

#[tauri::command]
pub async fn modbus_tcp_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await
}

#[tauri::command]
pub async fn modbus_tcp_disconnect(
    state: tauri::State<'_, ModbusState>,
    name: String,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    let ctx = {
        let mut guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard.remove(&ws)
    };

    if let Some(ctx) = ctx {
        let mut ctx = ctx.lock().await;
        ctx.disconnect()
            .await
            .map_err(|e| format!("failed to disconnect modbus tcp: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn modbus_tcp_read_holding_registers(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<Vec<u16>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, qty) = match compute_effective_address(start_address, quantity, address_offset) {
        Ok(v) => v,
        Err(e) => {
            log_workspace_event(
                &app,
                &ws,
                "error",
                "modbus/tcp/readHoldingRegisters",
                "TCP read holding registers failed",
                Some(
                    json!({
                        "direction": "request",
                        "protocol": "tcp",
                        "function": "readHoldingRegisters",
                        "unitId": unit_id,
                        "workspace": ws,
                        "startAddress": start_address,
                        "quantity": quantity,
                        "addressOffset": address_offset,
                        "error": e,
                    })
                    .to_string(),
                ),
            );

            let _ = log_traffic_event(
                &app,
                &ws,
                TrafficLogInput {
                    function_kind: "read".to_string(),
                    packet_type: "request".to_string(),
                    proto: "tcp".to_string(),
                    dest_addr: Some(format!("unit:{}", unit_id)),
                    slave_id: slave_db_id,
                    unit_id: Some(unit_id),
                    function_code: Some(3),
                    address: Some(start_address),
                    quantity: Some(quantity),
                    duration_ms: None,
                    ok: false,
                    error: Some("invalid address range (base-address offset)".to_string()),
                    checksum: None,
                    data_hex: None,
                    data_size: None,
                    decoded_data: Some(format!("error={}", e)),
                },
            );

            return Err(e);
        }
    };

    // Traffic: request packet
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "request".to_string(),
            proto: "tcp".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(3),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: None,
        },
    );

    log_workspace_event(
        &app,
        &ws,
        "debug",
        "modbus/tcp/readHoldingRegisters",
        "TCP read holding registers",
        Some(
            json!({
                "direction": "request",
                "protocol": "tcp",
                "function": "readHoldingRegisters",
                "unitId": unit_id,
                "workspace": ws,
                "startAddress": start_address,
                "quantity": quantity,
                "addressOffset": address_offset,
                "effectiveStart": start,
                "effectiveQuantity": qty,
            })
            .to_string(),
        ),
    );

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_holding_registers(start, qty),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus read holding registers failed: {e}")
    })?;
    let out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    // Build simple hex/decoded representations of the holding register values.
    let data_hex = if !out.is_empty() {
        Some(
            out
                .iter()
                .map(|v| format!("{v:04X}"))
                .collect::<Vec<_>>()
                .join(" "),
        )
    } else {
        None
    };
    let data_size = Some((out.len() as i64) * 2); // 2 bytes per register
    let decoded_data = Some(format!("values={:?}", out));

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "response".to_string(),
            proto: "tcp".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(3),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data,
        },
    );

    log_workspace_event(
        &app,
        &ws,
        "debug",
        "modbus/tcp/readHoldingRegisters",
        "TCP read holding registers completed",
        Some(
            json!({
                "direction": "response",
                "protocol": "tcp",
                "function": "readHoldingRegisters",
                "unitId": unit_id,
                "workspace": ws,
                "startAddress": start_address,
                "quantity": quantity,
                "addressOffset": address_offset,
                "effectiveStart": start,
                "effectiveQuantity": qty,
                "valueCount": out.len(),
            })
            .to_string(),
        ),
    );

    Ok(out)
}

#[tauri::command]
pub async fn modbus_tcp_read_input_registers(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<Vec<u16>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, qty) = match compute_effective_address(start_address, quantity, address_offset) {
        Ok(v) => v,
        Err(e) => {
            log_workspace_event(
                &app,
                &ws,
                "error",
                "modbus/tcp/readInputRegisters",
                "TCP read input registers failed",
                Some(
                    json!({
                        "direction": "request",
                        "protocol": "tcp",
                        "function": "readInputRegisters",
                        "unitId": unit_id,
                        "workspace": ws,
                        "startAddress": start_address,
                        "quantity": quantity,
                        "addressOffset": address_offset,
                        "error": e,
                    })
                    .to_string(),
                ),
            );

            let _ = log_traffic_event(
                &app,
                &ws,
                TrafficLogInput {
                    function_kind: "read".to_string(),
                    packet_type: "request".to_string(),
                    proto: "tcp".to_string(),
                    dest_addr: Some(format!("unit:{}", unit_id)),
                    slave_id: slave_db_id,
                    unit_id: Some(unit_id),
                    function_code: Some(4),
                    address: Some(start_address),
                    quantity: Some(quantity),
                    duration_ms: None,
                    ok: false,
                    error: Some("invalid address range (base-address offset)".to_string()),
                    checksum: None,
                    data_hex: None,
                    data_size: None,
                    decoded_data: Some(format!("error={}", e)),
                },
            );

            return Err(e);
        }
    };

    // Traffic: request packet
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "request".to_string(),
            proto: "tcp".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(4),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: None,
        },
    );

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_input_registers(start, qty),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus read input registers failed: {e}")
    })?;
    let out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    // Build hex/decoded representations of the input register values.
    let data_hex = if !out.is_empty() {
        Some(
            out.iter()
                .map(|v| format!("{v:04X}"))
                .collect::<Vec<_>>()
                .join(" "),
        )
    } else {
        None
    };
    let data_size = Some((out.len() as i64) * 2); // 2 bytes per register
    let decoded_data = Some(format!("values={:?}", out));

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "response".to_string(),
            proto: "tcp".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(4),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data,
        },
    );

    log_workspace_event(
        &app,
        &ws,
        "debug",
        "modbus/tcp/readInputRegisters",
        "TCP read input registers completed",
        Some(
            json!({
                "direction": "response",
                "protocol": "tcp",
                "function": "readInputRegisters",
                "unitId": unit_id,
                "workspace": ws,
                "startAddress": start_address,
                "quantity": quantity,
                "addressOffset": address_offset,
                "effectiveStart": start,
                "effectiveQuantity": qty,
                "valueCount": out.len(),
            })
            .to_string(),
        ),
    );

    Ok(out)
}

#[tauri::command]
pub async fn modbus_rtu_read_coils(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<Vec<bool>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, qty) = compute_effective_address(start_address, quantity, address_offset)?;

    // Traffic: request packet
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "request".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(1),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: None,
        },
    );

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(Duration::from_millis(timeout_ms), ctx.read_coils(start, qty))
        .await
        .map_err(|_| {
            drop_rtu_session(&state, &ws).ok();
            format!("modbus request timed out after {timeout_ms} ms")
        })?
        .map_err(|e| {
            drop_rtu_session(&state, &ws).ok();
            format!("modbus read coils failed: {e}")
        })?;
    let out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    let (data_hex, data_size) = encode_bools_to_hex(&out);
    let decoded_data = Some(format!("values={:?}", out));

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "response".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(1),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data,
        },
    );

    Ok(out)
}

#[tauri::command]
pub async fn modbus_rtu_read_discrete_inputs(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<Vec<bool>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, qty) = compute_effective_address(start_address, quantity, address_offset)?;

    // Traffic: request packet
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "request".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(2),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: None,
        },
    );

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_discrete_inputs(start, qty),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus read discrete inputs failed: {e}")
    })?;
    let out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    let (data_hex, data_size) = encode_bools_to_hex(&out);
    let decoded_data = Some(format!("values={:?}", out));

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "response".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(2),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data,
        },
    );

    Ok(out)
}

#[tauri::command]
pub async fn modbus_tcp_read_coils(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<Vec<bool>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, qty) = compute_effective_address(start_address, quantity, address_offset)?;

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(Duration::from_millis(timeout_ms), ctx.read_coils(start, qty))
        .await
        .map_err(|_| {
            drop_tcp_session(&state, &ws).ok();
            format!("modbus request timed out after {timeout_ms} ms")
        })?
        .map_err(|e| {
            drop_tcp_session(&state, &ws).ok();
            format!("modbus read coils failed: {e}")
        })?;
    let out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    let (data_hex, data_size) = encode_bools_to_hex(&out);
    let decoded_data = Some(format!("values={:?}", out));

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "response".to_string(),
            proto: "tcp".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(1),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data,
        },
    );

    Ok(out)
}

#[tauri::command]
pub async fn modbus_tcp_read_discrete_inputs(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<Vec<bool>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, qty) = compute_effective_address(start_address, quantity, address_offset)?;

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_discrete_inputs(start, qty),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus read discrete inputs failed: {e}")
    })?;
    let out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    let (data_hex, data_size) = encode_bools_to_hex(&out);
    let decoded_data = Some(format!("values={:?}", out));

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "response".to_string(),
            proto: "tcp".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(2),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data,
        },
    );

    Ok(out)
}

#[tauri::command]
pub async fn modbus_tcp_write_single_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    address: i64,
    value: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (addr, _) = match compute_effective_address(address, 1, address_offset) {
        Ok(v) => v,
        Err(e) => {
            log_workspace_event(
                &app,
                &ws,
                "error",
                "modbus/tcp/writeSingleRegister",
                "TCP write single register failed",
                Some(
                    json!({
                        "direction": "request",
                        "protocol": "tcp",
                        "function": "writeSingleRegister",
                        "unitId": unit_id,
                        "workspace": ws,
                        "address": address,
                        "value": value,
                        "addressOffset": address_offset,
                        "error": e,
                    })
                    .to_string(),
                ),
            );

            let _ = log_traffic_event(
                &app,
                &ws,
                TrafficLogInput {
                    function_kind: "write".to_string(),
                    packet_type: "request".to_string(),
                    proto: "tcp".to_string(),
                    dest_addr: Some(format!("unit:{}", unit_id)),
                    slave_id: slave_db_id,
                    unit_id: Some(unit_id),
                    function_code: Some(6),
                    address: Some(address),
                    quantity: Some(1),
                    duration_ms: None,
                    ok: false,
                    error: Some("invalid address (base-address offset)".to_string()),
                    checksum: None,
                    data_hex: None,
                    data_size: None,
                    decoded_data: Some(format!("value={} error={}", value, e)),
                },
            );

            return Err(e);
        }
    };

    let v_u16: u16 =
        u16::try_from(value).map_err(|_| "register value must be in range 0..65535".to_string())?;

    // Traffic: request packet
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "write".to_string(),
            packet_type: "request".to_string(),
            proto: "tcp".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(6),
            address: Some(addr as i64),
            quantity: Some(1),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex: Some(format!("{v_u16:04X}")),
            data_size: Some(2),
            decoded_data: Some(format!("value={}", v_u16)),
        },
    );

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.write_single_register(addr, v_u16),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus write single register failed: {e}"))?;
    let _out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    // Traffic: response packet (on success)
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "write".to_string(),
            packet_type: "response".to_string(),
            proto: "tcp".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(6),
            address: Some(addr as i64),
            quantity: Some(1),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex: Some(format!("{v_u16:04X}")),
            data_size: Some(2),
            decoded_data: Some(format!("value={}", v_u16)),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn modbus_tcp_read_device_identification(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
) -> Result<Vec<DeviceIdItem>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));

    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_device_identification(ReadCode::Basic, 0),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus read device identification failed: {e}"))?;

    match res {
        Ok(resp) => {
            let items = resp
                .device_id_objects
                .into_iter()
                .map(|obj| DeviceIdItem {
                    id: obj.id,
                    value: obj.value_as_str().unwrap_or("").to_string(),
                })
                .collect();
            Ok(items)
        }
        Err(e) => Err(format!("modbus exception: {e}")),
    }
}

#[tauri::command]
pub async fn modbus_rtu_read_device_identification(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
) -> Result<Vec<DeviceIdItem>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));

    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_device_identification(ReadCode::Basic, 0),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus read device identification failed: {e}"))?;

    match res {
        Ok(resp) => {
            let items = resp
                .device_id_objects
                .into_iter()
                .map(|obj| DeviceIdItem {
                    id: obj.id,
                    value: obj.value_as_str().unwrap_or("").to_string(),
                })
                .collect();
            Ok(items)
        }
        Err(e) => Err(format!("modbus exception: {e}")),
    }
}

#[tauri::command]
pub async fn modbus_tcp_diagnostics_echo(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    data: i64,
) -> Result<DiagnosticsEchoResult, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);

    let echo_data: u16 = u16::try_from(data).map_err(|_| "echo data must be in range 0..65535".to_string())?;

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));

    let bytes: [u8; 4] = [0x00, 0x00, (echo_data >> 8) as u8, (echo_data & 0xFF) as u8];

    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.call(Request::Custom(0x08, Cow::Borrowed(&bytes))),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus diagnostics failed: {e}"))?;

    match res {
        Ok(Response::Custom(_func, payload)) => {
            if payload.len() < 4 {
                return Err("diagnostics echo response too short".to_string());
            }
            let hi = payload[2] as u16;
            let lo = payload[3] as u16;
            Ok(DiagnosticsEchoResult { data: (hi << 8) | lo })
        }
        Ok(other) => Err(format!("unexpected diagnostics response: {:?}", other)),
        Err(e) => Err(format!("modbus exception: {e}")),
    }
}

#[tauri::command]
pub async fn modbus_rtu_diagnostics_echo(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    data: i64,
) -> Result<DiagnosticsEchoResult, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);

    let echo_data: u16 = u16::try_from(data).map_err(|_| "echo data must be in range 0..65535".to_string())?;

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));

    let bytes: [u8; 4] = [0x00, 0x00, (echo_data >> 8) as u8, (echo_data & 0xFF) as u8];

    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.call(Request::Custom(0x08, Cow::Borrowed(&bytes))),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus diagnostics failed: {e}"))?;

    match res {
        Ok(Response::Custom(_func, payload)) => {
            if payload.len() < 4 {
                return Err("diagnostics echo response too short".to_string());
            }
            let hi = payload[2] as u16;
            let lo = payload[3] as u16;
            Ok(DiagnosticsEchoResult { data: (hi << 8) | lo })
        }
        Ok(other) => Err(format!("unexpected diagnostics response: {:?}", other)),
        Err(e) => Err(format!("modbus exception: {e}")),
    }
}

#[tauri::command]
pub async fn modbus_tcp_mask_write_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    address: i64,
    and_mask: i64,
    or_mask: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (addr, _) = compute_effective_address(address, 1, address_offset)?;

    let and_u16: u16 = u16::try_from(and_mask)
        .map_err(|_| "AND mask must be in range 0..65535".to_string())?;
    let or_u16: u16 = u16::try_from(or_mask)
        .map_err(|_| "OR mask must be in range 0..65535".to_string())?;

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.masked_write_register(addr, and_u16, or_u16),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus mask write register failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_mask_write_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    address: i64,
    and_mask: i64,
    or_mask: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (addr, _) = compute_effective_address(address, 1, address_offset)?;

    let and_u16: u16 = u16::try_from(and_mask)
        .map_err(|_| "AND mask must be in range 0..65535".to_string())?;
    let or_u16: u16 = u16::try_from(or_mask)
        .map_err(|_| "OR mask must be in range 0..65535".to_string())?;

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.masked_write_register(addr, and_u16, or_u16),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus mask write register failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_write_single_coil(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    address: i64,
    value: bool,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (addr, _) = compute_effective_address(address, 1, address_offset)?;

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.write_single_coil(addr, value),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus write single coil failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "write".to_string(),
            packet_type: "response".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: None,
            unit_id: Some(unit_id),
            function_code: Some(5),
            address: Some(addr as i64),
            quantity: Some(1),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: Some("ok".to_string()),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_write_multiple_coils(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    values: Vec<bool>,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;
    if values.is_empty() {
        return Err("values must be non-empty".to_string());
    }

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, _qty) = compute_effective_address(
        start_address,
        values.len() as i64,
        address_offset,
    )?;

    let (data_hex, data_size) = encode_bools_to_hex(&values);
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "write".to_string(),
            packet_type: "request".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: None,
            unit_id: Some(unit_id),
            function_code: Some(15),
            address: Some(start as i64),
            quantity: Some(values.len() as i64),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data: Some(format!("values={:?}", values)),
        },
    );

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.write_multiple_coils(start, &values),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus write multiple coils failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "write".to_string(),
            packet_type: "response".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: None,
            unit_id: Some(unit_id),
            function_code: Some(15),
            address: Some(start as i64),
            quantity: Some(values.len() as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: Some("ok".to_string()),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_write_multiple_registers(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    values: Vec<i64>,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;
    if values.is_empty() {
        return Err("values must be non-empty".to_string());
    }

    let mut vals: Vec<u16> = Vec::with_capacity(values.len());
    for v in values {
        vals.push(
            u16::try_from(v)
                .map_err(|_| "register value must be in range 0..65535".to_string())?,
        );
    }

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, _qty) = compute_effective_address(
        start_address,
        i64::try_from(vals.len()).unwrap_or(0),
        address_offset,
    )?;

    let data_hex = if !vals.is_empty() {
        Some(
            vals.iter()
                .map(|v| format!("{v:04X}"))
                .collect::<Vec<_>>()
                .join(" "),
        )
    } else {
        None
    };
    let data_size = Some((vals.len() as i64) * 2);
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "write".to_string(),
            packet_type: "request".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: None,
            unit_id: Some(unit_id),
            function_code: Some(16),
            address: Some(start as i64),
            quantity: Some(vals.len() as i64),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data: Some(format!("values={:?}", vals)),
        },
    );

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.write_multiple_registers(start, &vals),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus write multiple registers failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "write".to_string(),
            packet_type: "response".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: None,
            unit_id: Some(unit_id),
            function_code: Some(16),
            address: Some(start as i64),
            quantity: Some(vals.len() as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: Some("ok".to_string()),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn modbus_tcp_write_single_coil(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    address: i64,
    value: bool,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (addr, _) = compute_effective_address(address, 1, address_offset)?;

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.write_single_coil(addr, value),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus write single coil failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn modbus_tcp_write_multiple_coils(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    values: Vec<bool>,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;
    if values.is_empty() {
        return Err("values must be non-empty".to_string());
    }

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, _qty) = compute_effective_address(
        start_address,
        i64::try_from(values.len()).unwrap_or(0),
        address_offset,
    )?;

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.write_multiple_coils(start, &values),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus write multiple coils failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn modbus_tcp_write_multiple_registers(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    values: Vec<i64>,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_tcp_session(&state, &app, &ws, unit_id).await?;
    if values.is_empty() {
        return Err("values must be non-empty".to_string());
    }

    let mut vals: Vec<u16> = Vec::with_capacity(values.len());
    for v in values {
        vals.push(
            u16::try_from(v)
                .map_err(|_| "register value must be in range 0..65535".to_string())?,
        );
    }

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "tcp");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, _qty) = compute_effective_address(
        start_address,
        i64::try_from(vals.len()).unwrap_or(0),
        address_offset,
    )?;

    let ctx = {
        let guard = state
            .tcp_sessions
            .lock()
            .map_err(|_| "modbus tcp session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus tcp session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.write_multiple_registers(start, &vals),
    )
    .await
    .map_err(|_| {
        drop_tcp_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus write multiple registers failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;
    if let Err(e) = probe_rtu_session(app.clone(), state.clone(), &ws, unit_id).await {
        drop_rtu_session(&state, &ws).ok();
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_disconnect(
    state: tauri::State<'_, ModbusState>,
    name: String,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    let _ctx = {
        let mut guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard.remove(&ws)
    };
    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_read_input_registers(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<Vec<u16>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, qty) = match compute_effective_address(start_address, quantity, address_offset) {
        Ok(v) => v,
        Err(e) => {
            let _ = log_traffic_event(
                &app,
                &ws,
                TrafficLogInput {
                    function_kind: "read".to_string(),
                    packet_type: "request".to_string(),
                    proto: "rtu".to_string(),
                    dest_addr: Some(format!("unit:{}", unit_id)),
                    slave_id: slave_db_id,
                    unit_id: Some(unit_id),
                    function_code: Some(4),
                    address: Some(start_address),
                    quantity: Some(quantity),
                    duration_ms: None,
                    ok: false,
                    error: Some("invalid address range (base-address offset)".to_string()),
                    checksum: None,
                    data_hex: None,
                    data_size: None,
                    decoded_data: Some(format!("error={}", e)),
                },
            );

            return Err(e);
        }
    };

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "request".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(4),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: None,
        },
    );

    log_workspace_event(
        &app,
        &ws,
        "debug",
        "modbus/rtu/readInputRegisters",
        "RTU read input registers",
        Some(
            json!({
                "direction": "request",
                "protocol": "rtu",
                "function": "readInputRegisters",
                "unitId": unit_id,
                "workspace": ws,
                "startAddress": start_address,
                "quantity": quantity,
                "addressOffset": address_offset,
                "effectiveStart": start,
                "effectiveQuantity": qty,
            })
            .to_string(),
        ),
    );

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_input_registers(start, qty),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus read input registers failed: {e}")
    })?;
    let out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    let data_hex = if !out.is_empty() {
        Some(
            out.iter()
                .map(|v| format!("{v:04X}"))
                .collect::<Vec<_>>()
                .join(" "),
        )
    } else {
        None
    };
    let data_size = Some((out.len() as i64) * 2);
    let decoded_data = Some(format!("values={:?}", out));

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "response".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(4),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data,
        },
    );

    log_workspace_event(
        &app,
        &ws,
        "debug",
        "modbus/rtu/readInputRegisters",
        "RTU read input registers completed",
        Some(
            json!({
                "direction": "response",
                "protocol": "rtu",
                "function": "readInputRegisters",
                "unitId": unit_id,
                "workspace": ws,
                "startAddress": start_address,
                "quantity": quantity,
                "addressOffset": address_offset,
                "effectiveStart": start,
                "effectiveQuantity": qty,
                "valueCount": out.len(),
            })
            .to_string(),
        ),
    );

    Ok(out)
}

#[tauri::command]
pub async fn modbus_rtu_read_holding_registers(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<Vec<u16>, String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (start, qty) = compute_effective_address(start_address, quantity, address_offset)?;

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "request".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(3),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: None,
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: None,
        },
    );

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.read_holding_registers(start, qty),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus read holding registers failed: {e}")
    })?;
    let out = res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;

    // Build hex/decoded representations of the holding register values.
    let data_hex = if !out.is_empty() {
        Some(
            out
                .iter()
                .map(|v| format!("{v:04X}"))
                .collect::<Vec<_>>()
                .join(" "),
        )
    } else {
        None
    };
    let data_size = Some((out.len() as i64) * 2); // 2 bytes per register
    let decoded_data = Some(format!("values={:?}", out));

    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "read".to_string(),
            packet_type: "response".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: slave_db_id,
            unit_id: Some(unit_id),
            function_code: Some(3),
            address: Some(start as i64),
            quantity: Some(qty as i64),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex,
            data_size,
            decoded_data,
        },
    );

    log_workspace_event(
        &app,
        &ws,
        "debug",
        "modbus/rtu/readHoldingRegisters",
        "RTU read holding registers completed",
        Some(
            json!({
                "direction": "response",
                "protocol": "rtu",
                "function": "readHoldingRegisters",
                "unitId": unit_id,
                "workspace": ws,
                "startAddress": start_address,
                "quantity": quantity,
                "addressOffset": address_offset,
                "effectiveStart": start,
                "effectiveQuantity": qty,
                "valueCount": out.len(),
            })
            .to_string(),
        ),
    );

    Ok(out)
}

#[tauri::command]
pub async fn modbus_rtu_write_single_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, ModbusState>,
    name: String,
    unit_id: i64,
    address: i64,
    value: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    ensure_rtu_session(&state, &app, &ws, unit_id).await?;

    let master = get_client_settings(app.clone(), ws.to_string())?;
    let (_slave_db_id, address_offset) = lookup_slave_id_and_address_offset(&app, &ws, unit_id, "serial");
    let timeout_ms = clamp_timeout_ms(master.response_timeout_ms, 1000);
    let (addr, _) = compute_effective_address(address, 1, address_offset)?;

    let v_u16: u16 =
        u16::try_from(value).map_err(|_| "register value must be in range 0..65535".to_string())?;

    let ctx = {
        let guard = state
            .rtu_sessions
            .lock()
            .map_err(|_| "modbus rtu session lock poisoned".to_string())?;
        guard
            .get(&ws)
            .cloned()
            .ok_or_else(|| "modbus rtu session not connected".to_string())?
    };

    let mut ctx = ctx.lock().await;
    ctx.set_slave(Slave(normalize_unit_id(unit_id)?));
    let started_at = Instant::now();
    let res = timeout(
        Duration::from_millis(timeout_ms),
        ctx.write_single_register(addr, v_u16),
    )
    .await
    .map_err(|_| {
        drop_rtu_session(&state, &ws).ok();
        format!("modbus request timed out after {timeout_ms} ms")
    })?
    .map_err(|e| format!("modbus write single register failed: {e}"))?;
    res.map_err(|e| format!("modbus exception: {e}"))?;

    let duration_ms = started_at.elapsed().as_millis().min(i64::MAX as u128) as i64;
    let _ = log_traffic_event(
        &app,
        &ws,
        TrafficLogInput {
            function_kind: "write".to_string(),
            packet_type: "response".to_string(),
            proto: "rtu".to_string(),
            dest_addr: Some(format!("unit:{}", unit_id)),
            slave_id: None,
            unit_id: Some(unit_id),
            function_code: Some(6),
            address: Some(addr as i64),
            quantity: Some(1),
            duration_ms: Some(duration_ms),
            ok: true,
            error: None,
            checksum: None,
            data_hex: None,
            data_size: None,
            decoded_data: Some("ok".to_string()),
        },
    );

    Ok(())
}
