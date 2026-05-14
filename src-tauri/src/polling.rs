use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{sleep, Duration};

use crate::logs::log_workspace_event;
use crate::modbus::{
    modbus_rtu_read_holding_registers, modbus_rtu_read_input_registers, modbus_tcp_read_holding_registers,
    modbus_tcp_read_input_registers, ModbusState,
};
use crate::settings::get_connection_settings;

#[derive(Default)]
pub struct PollingState {
    polls: Mutex<HashMap<String, PollHandle>>,
}

struct PollHandle {
    workspace: String,
    handle: JoinHandle<()>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusPollResult {
    pub poll_id: String,
    pub name: String,
    pub unit_id: i64,
    pub register_kind: String,
    pub start_address: i64,
    pub quantity: i64,
    pub values: Vec<Option<u16>>,
    pub error: Option<String>,
    pub ts_ms: i64,
}

fn is_illegal_data_address_error(msg: &str) -> bool {
    msg.to_lowercase().contains("illegal data address")
}

async fn poll_read_range(
    app: tauri::AppHandle,
    modbus_state: tauri::State<'_, ModbusState>,
    workspace: String,
    unit_id: i64,
    is_serial: bool,
    is_input: bool,
    addr: i64,
    qty: i64,
) -> Result<Vec<u16>, String> {
    if is_input {
        if is_serial {
            modbus_rtu_read_input_registers(app, modbus_state, workspace, unit_id, addr, qty).await
        } else {
            modbus_tcp_read_input_registers(app, modbus_state, workspace, unit_id, addr, qty).await
        }
    } else if is_serial {
        modbus_rtu_read_holding_registers(app, modbus_state, workspace, unit_id, addr, qty).await
    } else {
        modbus_tcp_read_holding_registers(app, modbus_state, workspace, unit_id, addr, qty).await
    }
}

fn now_ms() -> i64 {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    dur.as_millis().min(i64::MAX as u128) as i64
}

#[tauri::command]
pub async fn start_modbus_poll(
    app: tauri::AppHandle,
    polling: tauri::State<'_, PollingState>,
    name: String,
    unit_id: i64,
    register_kind: String,
    start_address: i64,
    quantity: i64,
    interval_ms: i64,
) -> Result<String, String> {
    let name_trimmed = name.trim().to_string();
    if name_trimmed.is_empty() {
        return Err("workspace name is required".to_string());
    }
    if interval_ms <= 0 {
        return Err("interval_ms must be > 0".to_string());
    }

    let kind = register_kind.trim().to_lowercase();
    if kind != "input" && kind != "holding" {
        return Err("register_kind must be 'input' or 'holding'".to_string());
    }

    let poll_id = format!("{}:{}:{}", name_trimmed, unit_id, now_ms());

    {
        let guard = polling
            .polls
            .lock()
            .map_err(|_| "polling state lock poisoned".to_string())?;
        if guard.contains_key(&poll_id) {
            return Err("poll already exists".to_string());
        }
    }

    let app2 = app.clone();
    let name2 = name_trimmed.clone();
    let poll_id2 = poll_id.clone();

    let handle = tauri::async_runtime::spawn(async move {
        loop {
            let ts = now_ms();
            let mut values: Vec<Option<u16>> = Vec::new();
            let mut err: Option<String> = None;

            let conn_settings = match get_connection_settings(app2.clone(), name2.clone()) {
                Ok(s) => s,
                Err(e) => {
                    err = Some(e);
                    let _ = app2.emit(
                        "modbus_poll_result",
                        ModbusPollResult {
                            poll_id: poll_id2.clone(),
                            name: name2.clone(),
                            unit_id,
                            register_kind: kind.clone(),
                            start_address,
                            quantity,
                            values,
                            error: err,
                            ts_ms: ts,
                        },
                    );
                    sleep(Duration::from_millis(interval_ms as u64)).await;
                    continue;
                }
            };

            let modbus_state = app2.state::<ModbusState>();

            let is_input = kind == "input";
            let is_serial = conn_settings.kind == "serial";
            let res: Result<Vec<u16>, String> = poll_read_range(
                app2.clone(),
                modbus_state.clone(),
                name2.clone(),
                unit_id,
                is_serial,
                is_input,
                start_address,
                quantity,
            )
            .await;
            match res {
                Ok(v) => values = v.into_iter().map(Some).collect(),
                Err(e) => {
                    if is_illegal_data_address_error(&e) && (1..=64).contains(&quantity) {
                        let mut per: Vec<Option<u16>> = Vec::with_capacity(quantity as usize);
                        for i in 0..quantity {
                            let addr = start_address + i;
                            match poll_read_range(
                                app2.clone(),
                                modbus_state.clone(),
                                name2.clone(),
                                unit_id,
                                is_serial,
                                is_input,
                                addr,
                                1,
                            )
                            .await
                            {
                                Ok(v1) => per.push(v1.first().copied()),
                                Err(e2) => {
                                    if is_illegal_data_address_error(&e2) {
                                        per.push(None);
                                    } else {
                                        err = Some(e2);
                                        per.clear();
                                        break;
                                    }
                                }
                            }
                        }
                        if err.is_none() {
                            values = per;
                        }
                    } else {
                        err = Some(e);
                    }
                }
            }

            let details = json!({
                "pollId": poll_id2,
                "unitId": unit_id,
                "registerKind": kind,
                "startAddress": start_address,
                "quantity": quantity,
                "valuesCount": values.len(),
                "hasError": err.is_some(),
                "error": err,
            })
            .to_string();

            log_workspace_event(
                &app2,
                &name2,
                if err.is_some() { "warn" } else { "debug" },
                "modbus/poll",
                "Modbus poll cycle completed",
                Some(details),
            );

            let _ = app2.emit(
                "modbus_poll_result",
                ModbusPollResult {
                    poll_id: poll_id2.clone(),
                    name: name2.clone(),
                    unit_id,
                    register_kind: kind.clone(),
                    start_address,
                    quantity,
                    values,
                    error: err,
                    ts_ms: ts,
                },
            );

            sleep(Duration::from_millis(interval_ms as u64)).await;
        }
    });

    let mut guard = polling
        .polls
        .lock()
        .map_err(|_| "polling state lock poisoned".to_string())?;
    guard.insert(
        poll_id.clone(),
        PollHandle {
            workspace: name_trimmed,
            handle,
        },
    );

    Ok(poll_id)
}

#[tauri::command]
pub fn stop_modbus_poll(
    polling: tauri::State<'_, PollingState>,
    poll_id: String,
) -> Result<(), String> {
    let handle = {
        let mut guard = polling
            .polls
            .lock()
            .map_err(|_| "polling state lock poisoned".to_string())?;
        guard.remove(&poll_id)
    };

    if let Some(h) = handle {
        h.handle.abort();
    }

    Ok(())
}

#[tauri::command]
pub fn stop_workspace_polls(
    polling: tauri::State<'_, PollingState>,
    name: String,
) -> Result<(), String> {
    let workspace = name.trim().to_string();
    if workspace.is_empty() {
        return Ok(());
    }

    let handles: Vec<PollHandle> = {
        let mut guard = polling
            .polls
            .lock()
            .map_err(|_| "polling state lock poisoned".to_string())?;

        let ids: Vec<String> = guard
            .iter()
            .filter(|(_, v)| v.workspace == workspace)
            .map(|(k, _)| k.clone())
            .collect();

        ids.into_iter().filter_map(|id| guard.remove(&id)).collect()
    };

    for h in handles {
        h.handle.abort();
    }

    Ok(())
}
