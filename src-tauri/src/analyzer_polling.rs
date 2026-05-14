use serde::Serialize;
use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;
use tokio::time::{sleep, timeout, Duration, Instant};
use tokio::sync::mpsc;

use rusqlite::params;

use tauri::async_runtime::JoinHandle;

use crate::db::open_workspace_db;
use crate::modbus::{
    modbus_rtu_read_coils, modbus_rtu_read_discrete_inputs, modbus_rtu_read_holding_registers,
    modbus_rtu_read_input_registers, modbus_tcp_read_coils, modbus_tcp_read_discrete_inputs,
    modbus_tcp_read_holding_registers, modbus_tcp_read_input_registers, ModbusState,
};

#[derive(Default)]
pub struct AnalyzerPollingState {
    workers: Mutex<HashMap<String, JoinHandle<()>>>,
}

#[derive(Debug, Clone)]
struct SignalPollSpec {
    signal_id: String,
    unit_id: i64,
    connection_kind: String,
    function_kind: String,
    start_address: i64,
    quantity: i64,
    interval_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BatchItem {
    signal_id: String,
    offset: i64,
    quantity: i64,
}

#[derive(Debug, Clone)]
struct BatchSpec {
    unit_id: i64,
    connection_kind: String,
    function_kind: String,
    start_address: i64,
    quantity: i64,
    items: Vec<BatchItem>,
}

#[derive(Debug, Clone)]
struct DbUpdate {
    signal_id: String,
    ts_ms: i64,
    state: String,
    last_value_json: Option<String>,
    error_json: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerSignalUpdate {
    pub workspace: String,
    pub signal_id: String,
    pub ts_ms: i64,
    pub state: String,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_words: Option<Vec<u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_bools: Option<Vec<bool>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerPollingStoppedEvent {
    pub workspace: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerPollingBackoffEvent {
    pub workspace: String,
    pub reason: String,
    pub retry_in_ms: i64,
    pub attempt: u32,
}

fn now_ms() -> i64 {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    dur.as_millis().min(i64::MAX as u128) as i64
}

fn memory_hash<T: Hash>(value: &T) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn deterministic_jitter_ms(seed: u64, max_ms: i64) -> i64 {
    if max_ms <= 0 {
        return 0;
    }
    (seed % (max_ms as u64)) as i64
}

fn is_disconnected_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("not connected")
        || m.contains("failed to connect")
        || m.contains("connection reset")
        || m.contains("connection aborted")
        || m.contains("was aborted")
        || m.contains("forcibly closed")
        || m.contains("existing connection was forcibly closed")
        || m.contains("broken pipe")
        || m.contains("connection refused")
        || m.contains("transport endpoint is not connected")
        || m.contains("os error 10053")
        || m.contains("os error 10054")
}

fn max_qty_for_function(function_kind: &str) -> i64 {
    match function_kind {
        "holding" | "input" => 125,
        "coils" | "discrete" => 2000,
        _ => 125,
    }
}

fn quantity_for_data_type(data_type: &str) -> i64 {
    match data_type.trim().to_lowercase().as_str() {
        "u32" | "i32" | "f32" => 2,
        "u64" | "i64" | "f64" => 4,
        _ => 1,
    }
}

fn build_batches(specs: &[SignalPollSpec]) -> Vec<BatchSpec> {
    let mut grouped: HashMap<(i64, String, String), Vec<SignalPollSpec>> = HashMap::new();
    for s in specs {
        let key = (s.unit_id, s.connection_kind.clone(), s.function_kind.clone());
        grouped.entry(key).or_default().push(s.clone());
    }

    let mut out: Vec<BatchSpec> = Vec::new();

    for ((unit_id, connection_kind, function_kind), mut items) in grouped {
        items.sort_by_key(|s| s.start_address);
        let max_qty = max_qty_for_function(&function_kind);

        let mut current: Option<BatchSpec> = None;
        for s in items {
            let start = s.start_address;
            let end_excl = start + s.quantity;

            match current.as_mut() {
                None => {
                    current = Some(BatchSpec {
                        unit_id,
                        connection_kind: connection_kind.clone(),
                        function_kind: function_kind.clone(),
                        start_address: start,
                        quantity: s.quantity,
                        items: vec![BatchItem {
                            signal_id: s.signal_id,
                            offset: 0,
                            quantity: s.quantity,
                        }],
                    });
                }
                Some(b) => {
                    let batch_start = b.start_address;
                    let batch_end_excl = b.start_address + b.quantity;

                    let can_merge = start <= batch_end_excl
                        && (end_excl - batch_start) <= max_qty;

                    if !can_merge {
                        out.push(b.clone());
                        *b = BatchSpec {
                            unit_id,
                            connection_kind: connection_kind.clone(),
                            function_kind: function_kind.clone(),
                            start_address: start,
                            quantity: s.quantity,
                            items: vec![BatchItem {
                                signal_id: s.signal_id,
                                offset: 0,
                                quantity: s.quantity,
                            }],
                        };
                        continue;
                    }

                    let new_end_excl = batch_end_excl.max(end_excl);
                    b.quantity = new_end_excl - batch_start;
                    b.items.push(BatchItem {
                        signal_id: s.signal_id,
                        offset: start - batch_start,
                        quantity: s.quantity,
                    });
                }
            }
        }

        if let Some(b) = current {
            out.push(b);
        }
    }

    out
}

fn load_effective_signal_specs(app: &tauri::AppHandle, workspace: &str) -> Result<Vec<SignalPollSpec>, String> {
    let conn = open_workspace_db(app, workspace)?;

    let mut stmt = conn
        .prepare(
            "SELECT
                s.id,
                sl.unit_id,
                sl.connection_kind,
                s.function_kind,
                rr.address AS start_address,
                rr.data_type,
                COALESCE(NULLIF(sl.poll_interval_ms, 0), 1000) AS interval_ms
             FROM analyzer_signals s
             JOIN slaves sl ON sl.id = s.slave_id
             JOIN slave_register_rows rr ON rr.id = s.register_row_id
             JOIN (
               SELECT DISTINCT ats.signal_id AS signal_id
               FROM analyzer_tile_signals ats
               JOIN analyzer_tiles t ON t.id = ats.tile_id
               WHERE t.polling_enabled = 1
             ) x ON x.signal_id = s.id
             WHERE rr.address >= 0;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let signal_id: String = row.get(0)?;
            let unit_id: i64 = row.get(1)?;
            let connection_kind: String = row.get(2)?;
            let function_kind: String = row.get(3)?;
            let start_address: i64 = row.get(4)?;
            let data_type: String = row.get(5)?;
            let interval_ms: i64 = row.get(6)?;

            let qty = quantity_for_data_type(&data_type);

            Ok(SignalPollSpec {
                signal_id,
                unit_id,
                connection_kind,
                function_kind,
                start_address,
                quantity: qty,
                interval_ms: if interval_ms > 0 { interval_ms } else { 1000 },
            })
        })
        .map_err(|e| format!("failed to query analyzer signal specs: {e}"))?;

    let mut out: Vec<SignalPollSpec> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer signal spec row: {e}"))?);
    }

    Ok(out)
}

async fn read_registers(
    app: tauri::AppHandle,
    modbus: tauri::State<'_, ModbusState>,
    workspace: &str,
    connection_kind: &str,
    function_kind: &str,
    unit_id: i64,
    start_address: i64,
    quantity: i64,
) -> Result<(Option<Vec<u16>>, Option<Vec<bool>>), String> {
    match (connection_kind, function_kind) {
        ("tcp", "holding") => Ok((
            Some(
                modbus_tcp_read_holding_registers(
                    app,
                    modbus,
                    workspace.to_string(),
                    unit_id,
                    start_address,
                    quantity,
                )
                .await?,
            ),
            None,
        )),
        ("tcp", "input") => Ok((
            Some(
                modbus_tcp_read_input_registers(
                    app,
                    modbus,
                    workspace.to_string(),
                    unit_id,
                    start_address,
                    quantity,
                )
                .await?,
            ),
            None,
        )),
        ("tcp", "coils") => Ok((
            None,
            Some(
                modbus_tcp_read_coils(
                    app,
                    modbus,
                    workspace.to_string(),
                    unit_id,
                    start_address,
                    quantity,
                )
                .await?,
            ),
        )),
        ("tcp", "discrete") => Ok((
            None,
            Some(
                modbus_tcp_read_discrete_inputs(
                    app,
                    modbus,
                    workspace.to_string(),
                    unit_id,
                    start_address,
                    quantity,
                )
                .await?,
            ),
        )),
        ("serial", "holding") => Ok((
            Some(
                modbus_rtu_read_holding_registers(
                    app,
                    modbus,
                    workspace.to_string(),
                    unit_id,
                    start_address,
                    quantity,
                )
                .await?,
            ),
            None,
        )),
        ("serial", "input") => Ok((
            Some(
                modbus_rtu_read_input_registers(
                    app,
                    modbus,
                    workspace.to_string(),
                    unit_id,
                    start_address,
                    quantity,
                )
                .await?,
            ),
            None,
        )),
        ("serial", "coils") => Ok((
            None,
            Some(
                modbus_rtu_read_coils(
                    app,
                    modbus,
                    workspace.to_string(),
                    unit_id,
                    start_address,
                    quantity,
                )
                .await?,
            ),
        )),
        ("serial", "discrete") => Ok((
            None,
            Some(
                modbus_rtu_read_discrete_inputs(
                    app,
                    modbus,
                    workspace.to_string(),
                    unit_id,
                    start_address,
                    quantity,
                )
                .await?,
            ),
        )),
        _ => Err("unsupported connection/function kind".to_string()),
    }
}

async fn worker_loop(app: tauri::AppHandle, workspace: String) {
    let mut schedule: HashMap<String, (Instant, i64)> = HashMap::new();

    let mut cached_specs: Vec<SignalPollSpec> = Vec::new();
    let mut next_reload = Instant::now();

    let mut consecutive_disconnects: u32 = 0;
    let mut disconnected_until: Option<Instant> = None;

    let mut last_written: HashMap<String, (String, u64, i64)> = HashMap::new();

    let (db_tx, mut db_rx) = mpsc::unbounded_channel::<DbUpdate>();
    let app_for_db = app.clone();
    let ws_for_db = workspace.clone();
    let db_writer_handle = tauri::async_runtime::spawn(async move {
        let mut pending: HashMap<String, DbUpdate> = HashMap::new();
        let mut next_flush = Instant::now() + Duration::from_millis(250);

        loop {
            match timeout(Duration::from_millis(25), db_rx.recv()).await {
                Ok(Some(u)) => {
                    pending.insert(u.signal_id.clone(), u);
                }
                Ok(None) => {
                    // Sender dropped => flush any remaining updates once and exit.
                    break;
                }
                Err(_) => {
                    // timeout => periodic wake
                }
            }

            if pending.is_empty() {
                continue;
            }
            if Instant::now() < next_flush {
                continue;
            }
            next_flush = Instant::now() + Duration::from_millis(250);

            let batch: Vec<DbUpdate> = pending.drain().map(|(_, v)| v).collect();
            let app2 = app_for_db.clone();
            let ws2 = ws_for_db.clone();

            // Run SQLite work on blocking pool.
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let mut conn = match open_workspace_db(&app2, &ws2) {
                    Ok(c) => c,
                    Err(_) => return,
                };
                let tx = match conn.transaction() {
                    Ok(t) => t,
                    Err(_) => return,
                };

                for u in batch {
                    if u.state == "OK" {
                        let Some(last_value_json) = u.last_value_json else {
                            continue;
                        };
                        let _ = tx.execute(
                            "UPDATE analyzer_signals\n                             SET last_value_json=?1, last_updated_ts_ms=?2, state=?3, error_json=NULL\n                             WHERE id=?4;",
                            params![last_value_json, u.ts_ms, "OK", u.signal_id],
                        );
                    } else {
                        let err_json = u.error_json.unwrap_or_else(|| "{}".to_string());
                        let _ = tx.execute(
                            "UPDATE analyzer_signals\n                             SET last_value_json=NULL, last_updated_ts_ms=?1, state=?2, error_json=?3\n                             WHERE id=?4;",
                            params![u.ts_ms, u.state, err_json, u.signal_id],
                        );
                    }
                }

                let _ = tx.commit();
            })
            .await;
        }

        // Final flush after channel closes
        if !pending.is_empty() {
            let batch: Vec<DbUpdate> = pending.drain().map(|(_, v)| v).collect();
            let app2 = app_for_db.clone();
            let ws2 = ws_for_db.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let mut conn = match open_workspace_db(&app2, &ws2) {
                    Ok(c) => c,
                    Err(_) => return,
                };
                let tx = match conn.transaction() {
                    Ok(t) => t,
                    Err(_) => return,
                };
                for u in batch {
                    if u.state == "OK" {
                        let Some(last_value_json) = u.last_value_json else {
                            continue;
                        };
                        let _ = tx.execute(
                            "UPDATE analyzer_signals\n                             SET last_value_json=?1, last_updated_ts_ms=?2, state=?3, error_json=NULL\n                             WHERE id=?4;",
                            params![last_value_json, u.ts_ms, "OK", u.signal_id],
                        );
                    } else {
                        let err_json = u.error_json.unwrap_or_else(|| "{}".to_string());
                        let _ = tx.execute(
                            "UPDATE analyzer_signals\n                             SET last_value_json=NULL, last_updated_ts_ms=?1, state=?2, error_json=?3\n                             WHERE id=?4;",
                            params![u.ts_ms, u.state, err_json, u.signal_id],
                        );
                    }
                }
                let _ = tx.commit();
            }).await;
        }
    });

    loop {
        let now = Instant::now();

        if let Some(until) = disconnected_until {
            if now < until {
                sleep(until - now).await;
                continue;
            }
        }

        if now >= next_reload {
            cached_specs = load_effective_signal_specs(&app, &workspace).unwrap_or_default();
            next_reload = now + Duration::from_millis(1000);

            let mut seen: HashMap<String, i64> = HashMap::new();
            for s in &cached_specs {
                seen.insert(s.signal_id.clone(), s.interval_ms);

                schedule
                    .entry(s.signal_id.clone())
                    .and_modify(|(_, interval)| {
                        *interval = s.interval_ms;
                    })
                    .or_insert_with(|| {
                        let base = memory_hash(&s.signal_id);
                        let max_jitter = (s.interval_ms / 10).max(10);
                        let jitter_ms = deterministic_jitter_ms(base, max_jitter);
                        (
                            Instant::now() + Duration::from_millis(jitter_ms.max(0) as u64),
                            s.interval_ms,
                        )
                    });
            }

            schedule.retain(|id, _| seen.contains_key(id));
            last_written.retain(|id, _| seen.contains_key(id));
        }

        let mut due_specs: Vec<SignalPollSpec> = Vec::new();
        if !schedule.is_empty() && !cached_specs.is_empty() {
            for s in &cached_specs {
                if let Some((next_due, interval)) = schedule.get_mut(&s.signal_id) {
                    if now >= *next_due {
                        due_specs.push(s.clone());
                        let interval_ms = (*interval).max(1);
                        let behind = now.duration_since(*next_due);
                        let missed = (behind.as_millis() as i64 / interval_ms) + 1;
                        *next_due = *next_due + Duration::from_millis((missed * interval_ms) as u64);
                    }
                }
            }
        }

        if due_specs.is_empty() {
            let mut next_wakeup = next_reload;
            for (due, _) in schedule.values() {
                if *due < next_wakeup {
                    next_wakeup = *due;
                }
            }

            let sleep_for = if next_wakeup > now {
                let d = next_wakeup - now;
                d.min(Duration::from_millis(1000)).max(Duration::from_millis(25))
            } else {
                Duration::from_millis(25)
            };

            sleep(sleep_for).await;
            continue;
        }

        let batches = build_batches(&due_specs);
        let modbus_state = app.state::<ModbusState>();

        'batches: for b in batches {
            let res = read_registers(
                app.clone(),
                modbus_state.clone(),
                &workspace,
                &b.connection_kind,
                &b.function_kind,
                b.unit_id,
                b.start_address,
                b.quantity,
            )
            .await;

            let ts = now_ms();

            match res {
                Ok((words_opt, bools_opt)) => {
                    consecutive_disconnects = 0;
                    disconnected_until = None;

                    let min_write_interval_ms = 250;
                    let mut any_write = false;
                    let mut pending_updates: Vec<(String, Option<Vec<u16>>, Option<Vec<bool>>, Option<(String, u64)>)> =
                        Vec::new();

                    for it in b.items {
                        let signal_id = it.signal_id;

                        if let Some(words) = &words_opt {
                            let off = it.offset.max(0) as usize;
                            let qty = it.quantity.max(0) as usize;
                            let slice = words
                                .get(off..off.saturating_add(qty))
                                .unwrap_or(&[])
                                .to_vec();

                            let value_hash = memory_hash(&("OK", "words", &slice));
                            let should_write = match last_written.get(&signal_id) {
                                Some((prev_state, prev_hash, prev_ts)) => {
                                    prev_state != "OK"
                                        || *prev_hash != value_hash
                                        || (ts - *prev_ts) >= min_write_interval_ms
                                }
                                None => true,
                            };

                            let db_write = if should_write {
                                any_write = true;
                                let last_value_json = serde_json::to_string(&json!({ "rawWords": slice }))
                                    .unwrap_or("{}".to_string());
                                Some((last_value_json, value_hash))
                            } else {
                                None
                            };

                            pending_updates.push((signal_id, Some(slice), None, db_write));
                        } else if let Some(bools) = &bools_opt {
                            let off = it.offset.max(0) as usize;
                            let qty = it.quantity.max(0) as usize;
                            let slice = bools
                                .get(off..off.saturating_add(qty))
                                .unwrap_or(&[])
                                .to_vec();

                            let value_hash = memory_hash(&("OK", "bools", &slice));
                            let should_write = match last_written.get(&signal_id) {
                                Some((prev_state, prev_hash, prev_ts)) => {
                                    prev_state != "OK"
                                        || *prev_hash != value_hash
                                        || (ts - *prev_ts) >= min_write_interval_ms
                                }
                                None => true,
                            };

                            let db_write = if should_write {
                                any_write = true;
                                let last_value_json = serde_json::to_string(&json!({ "rawBools": slice }))
                                    .unwrap_or("{}".to_string());
                                Some((last_value_json, value_hash))
                            } else {
                                None
                            };

                            pending_updates.push((signal_id, None, Some(slice), db_write));
                        }
                    }

                    if any_write {
                        for (signal_id, _, _, db_write) in &pending_updates {
                            let Some((last_value_json, value_hash)) = db_write else {
                                continue;
                            };

                            let _ = db_tx.send(DbUpdate {
                                signal_id: signal_id.clone(),
                                ts_ms: ts,
                                state: "OK".to_string(),
                                last_value_json: Some(last_value_json.clone()),
                                error_json: None,
                            });

                            last_written.insert(signal_id.clone(), ("OK".to_string(), *value_hash, ts));
                        }
                    }

                    for (signal_id, raw_words, raw_bools, _) in pending_updates {
                        let _ = app.emit(
                            "analyzer_signal_update",
                            AnalyzerSignalUpdate {
                                workspace: workspace.clone(),
                                signal_id,
                                ts_ms: ts,
                                state: "OK".to_string(),
                                error: None,
                                raw_words,
                                raw_bools,
                            },
                        );
                    }
                }
                Err(e) => {
                    let state = if is_disconnected_error(&e) {
                        "DISCONNECTED"
                    } else {
                        "ERROR"
                    };

                    if state == "DISCONNECTED" {
                        consecutive_disconnects = consecutive_disconnects.saturating_add(1);
                        let capped = consecutive_disconnects.min(6);
                        let base_backoff_ms = 500i64.saturating_mul(1i64 << (capped.saturating_sub(1) as i64));
                        let backoff_ms = base_backoff_ms.clamp(500, 30_000);
                        let jitter_ms = deterministic_jitter_ms(memory_hash(&workspace), 350);
                        let sleep_ms = backoff_ms.saturating_add(jitter_ms);

                        let _ = app.emit(
                            "analyzer_polling_backoff",
                            AnalyzerPollingBackoffEvent {
                                workspace: workspace.clone(),
                                reason: e.clone(),
                                retry_in_ms: sleep_ms,
                                attempt: consecutive_disconnects,
                            },
                        );

                        disconnected_until = Some(now + Duration::from_millis(sleep_ms.max(0) as u64));
                    }

                    let err_message = e.clone();
                    for it in &b.items {
                        let err_hash = memory_hash(&(state, &err_message));
                        let min_write_interval_ms = 250;
                        let should_write = match last_written.get(&it.signal_id) {
                            Some((prev_state, prev_hash, prev_ts)) => {
                                prev_state != state || *prev_hash != err_hash || (ts - *prev_ts) >= min_write_interval_ms
                            }
                            None => true,
                        };

                        if !should_write {
                            continue;
                        }

                        let err_json = serde_json::to_string(&json!({ "message": err_message }))
                            .unwrap_or("{}".to_string());
                        let _ = db_tx.send(DbUpdate {
                            signal_id: it.signal_id.clone(),
                            ts_ms: ts,
                            state: state.to_string(),
                            last_value_json: None,
                            error_json: Some(err_json),
                        });
                        last_written.insert(it.signal_id.clone(), (state.to_string(), err_hash, ts));
                    }

                    for it in b.items {
                        let _ = app.emit(
                            "analyzer_signal_update",
                            AnalyzerSignalUpdate {
                                workspace: workspace.clone(),
                                signal_id: it.signal_id,
                                ts_ms: ts,
                                state: state.to_string(),
                                error: Some(e.clone()),
                                raw_words: None,
                                raw_bools: None,
                            },
                        );
                    }

                    if state == "DISCONNECTED" && consecutive_disconnects >= 8 {
                        drop(db_tx);
                        let _ = db_writer_handle.await;
                        let _ = app.emit(
                            "analyzer_polling_stopped",
                            AnalyzerPollingStoppedEvent {
                                workspace: workspace.clone(),
                                reason: e.clone(),
                            },
                        );
                        return;
                    }

                    if state == "DISCONNECTED" {
                        break 'batches;
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn start_analyzer_polling(
    app: tauri::AppHandle,
    state: tauri::State<'_, AnalyzerPollingState>,
    name: String,
) -> Result<(), String> {
    let workspace = name.trim().to_string();
    if workspace.is_empty() {
        return Err("workspace name is required".to_string());
    }

    {
        let existing = {
            let mut guard = state
                .workers
                .lock()
                .map_err(|_| "analyzer polling state lock poisoned".to_string())?;
            guard.remove(&workspace)
        };

        if let Some(handle) = existing {
            handle.abort();
        }
    }

    let app2 = app.clone();
    let ws2 = workspace.clone();

    let handle = tauri::async_runtime::spawn(async move {
        worker_loop(app2, ws2).await;
    });

    let mut guard = state
        .workers
        .lock()
        .map_err(|_| "analyzer polling state lock poisoned".to_string())?;
    guard.insert(workspace, handle);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_batches, deterministic_jitter_ms, is_disconnected_error, max_qty_for_function,
        quantity_for_data_type, BatchItem, SignalPollSpec,
    };

    #[test]
    fn resolves_max_quantity_by_function() {
        assert_eq!(max_qty_for_function("holding"), 125);
        assert_eq!(max_qty_for_function("coils"), 2000);
        assert_eq!(max_qty_for_function("unknown"), 125);
    }

    #[test]
    fn resolves_quantity_by_data_type() {
        assert_eq!(quantity_for_data_type("u16"), 1);
        assert_eq!(quantity_for_data_type("u32"), 2);
        assert_eq!(quantity_for_data_type("f64"), 4);
        assert_eq!(quantity_for_data_type("unknown"), 1);
    }

    #[test]
    fn computes_deterministic_jitter() {
        assert_eq!(deterministic_jitter_ms(5, 10), 5);
        assert_eq!(deterministic_jitter_ms(15, 10), 5);
        assert_eq!(deterministic_jitter_ms(5, 0), 0);
    }

    #[test]
    fn detects_disconnected_errors() {
        assert!(is_disconnected_error("failed to connect"));
        assert!(is_disconnected_error("OS error 10054"));
        assert!(!is_disconnected_error("some other error"));
    }

    #[test]
    fn builds_batches_for_contiguous_ranges() {
        let specs = vec![
            SignalPollSpec {
                signal_id: "a".to_string(),
                unit_id: 1,
                connection_kind: "tcp".to_string(),
                function_kind: "holding".to_string(),
                start_address: 0,
                quantity: 1,
                interval_ms: 1000,
            },
            SignalPollSpec {
                signal_id: "b".to_string(),
                unit_id: 1,
                connection_kind: "tcp".to_string(),
                function_kind: "holding".to_string(),
                start_address: 1,
                quantity: 1,
                interval_ms: 1000,
            },
            SignalPollSpec {
                signal_id: "c".to_string(),
                unit_id: 1,
                connection_kind: "tcp".to_string(),
                function_kind: "holding".to_string(),
                start_address: 200,
                quantity: 1,
                interval_ms: 1000,
            },
        ];

        let batches = build_batches(&specs);
        assert_eq!(batches.len(), 2);

        let merged = batches.iter().find(|b| b.start_address == 0).expect("merged batch");
        assert_eq!(
            merged.items,
            vec![
                BatchItem {
                    signal_id: "a".to_string(),
                    offset: 0,
                    quantity: 1,
                },
                BatchItem {
                    signal_id: "b".to_string(),
                    offset: 1,
                    quantity: 1,
                },
            ]
        );
    }
}

#[tauri::command]
pub fn stop_analyzer_polling(
    state: tauri::State<'_, AnalyzerPollingState>,
    name: String,
) -> Result<(), String> {
    let workspace = name.trim().to_string();
    if workspace.is_empty() {
        return Ok(());
    }

    let handle = {
        let mut guard = state
            .workers
            .lock()
            .map_err(|_| "analyzer polling state lock poisoned".to_string())?;
        guard.remove(&workspace)
    };

    if let Some(h) = handle {
        h.abort();
    }

    Ok(())
}
