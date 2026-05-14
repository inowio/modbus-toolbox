use crate::db::open_workspace_db;
use crate::models::{
    SlaveCreate, SlaveItem, SlavePatch, SlaveRegisterRow, SlaveRegisterRowUpsert,
};

fn is_foreign_key_constraint_error(msg: &str) -> bool {
    msg.to_lowercase().contains("foreign key constraint failed")
}

#[tauri::command]
pub fn list_slaves(app: tauri::AppHandle, name: String) -> Result<Vec<SlaveItem>, String> {
    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at
             FROM slaves
             ORDER BY unit_id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SlaveItem {
                id: row.get(0)?,
                name: row.get(1)?,
                unit_id: row.get(2)?,
                poll_interval_ms: row.get(3)?,
                connection_kind: row.get(4)?,
                address_offset: row.get(5).unwrap_or(0),
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("failed to query slaves: {e}"))?;

    let mut out: Vec<SlaveItem> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read slave row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn create_slave(
    app: tauri::AppHandle,
    name: String,
    slave: SlaveCreate,
    now_iso: String,
) -> Result<SlaveItem, String> {
    let conn = open_workspace_db(&app, &name)?;

    let poll_interval_ms = slave.poll_interval_ms.unwrap_or(1000);
    let address_offset = slave.address_offset.unwrap_or(0);

    conn.execute(
        "INSERT INTO slaves (name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        (
            slave.name,
            slave.unit_id,
            poll_interval_ms,
            "serial".to_string(),
            address_offset,
            now_iso.clone(),
            now_iso,
        ),
    )
    .map_err(|e| format!("failed to create slave: {e}"))?;

    let id = conn.last_insert_rowid();

    conn.query_row(
        "SELECT id, name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at FROM slaves WHERE id = ?1;",
        (id,),
        |row| {
            Ok(SlaveItem {
                id: row.get(0)?,
                name: row.get(1)?,
                unit_id: row.get(2)?,
                poll_interval_ms: row.get(3)?,
                connection_kind: row.get(4)?,
                address_offset: row.get(5).unwrap_or(0),
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(|e| format!("failed to read created slave: {e}"))
}

#[tauri::command]
pub fn update_slave(
    app: tauri::AppHandle,
    name: String,
    id: i64,
    patch: SlavePatch,
    now_iso: String,
) -> Result<SlaveItem, String> {
    let conn = open_workspace_db(&app, &name)?;

    let existing: SlaveItem = conn
        .query_row(
            "SELECT id, name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at FROM slaves WHERE id = ?1;",
            (id,),
            |row| {
                Ok(SlaveItem {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    unit_id: row.get(2)?,
                    poll_interval_ms: row.get(3)?,
                    connection_kind: row.get(4)?,
                    address_offset: row.get(5).unwrap_or(0),
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .map_err(|e| format!("slave not found: {e}"))?;

    let merged_name = patch.name.unwrap_or(Some(existing.name));
    let merged_unit_id = patch.unit_id.unwrap_or(Some(existing.unit_id));
    let merged_poll_interval_ms = patch
        .poll_interval_ms
        .unwrap_or(Some(existing.poll_interval_ms));
    let merged_connection_kind = patch
        .connection_kind
        .unwrap_or(Some(existing.connection_kind));
    let merged_address_offset = patch
        .address_offset
        .unwrap_or(Some(existing.address_offset));

    let merged_name = merged_name.ok_or_else(|| "slave name cannot be null".to_string())?;
    let merged_unit_id = merged_unit_id.ok_or_else(|| "slave unitId cannot be null".to_string())?;
    let merged_poll_interval_ms =
        merged_poll_interval_ms.ok_or_else(|| "slave pollIntervalMs cannot be null".to_string())?;
    let merged_connection_kind = merged_connection_kind
        .ok_or_else(|| "slave connectionKind cannot be null".to_string())?;
    let merged_address_offset = merged_address_offset
        .ok_or_else(|| "slave addressOffset cannot be null".to_string())?;

    conn.execute(
        "UPDATE slaves
         SET name = ?1, unit_id = ?2, poll_interval_ms = ?3, connection_kind = ?4, address_offset = ?5, updated_at = ?6
         WHERE id = ?7;",
        (
            merged_name,
            merged_unit_id,
            merged_poll_interval_ms,
            merged_connection_kind,
            merged_address_offset,
            now_iso,
            id,
        ),
    )
    .map_err(|e| format!("failed to update slave: {e}"))?;

    conn.query_row(
        "SELECT id, name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at FROM slaves WHERE id = ?1;",
        (id,),
        |row| {
            Ok(SlaveItem {
                id: row.get(0)?,
                name: row.get(1)?,
                unit_id: row.get(2)?,
                poll_interval_ms: row.get(3)?,
                connection_kind: row.get(4)?,
                address_offset: row.get(5).unwrap_or(0),
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(|e| format!("failed to read updated slave: {e}"))
}

#[tauri::command]
pub fn delete_slave(app: tauri::AppHandle, name: String, id: i64) -> Result<(), String> {
    let conn = open_workspace_db(&app, &name)?;
    conn.execute("DELETE FROM slaves WHERE id = ?1;", (id,))
        .map_err(|e| {
            let msg = format!("{e}");
            if is_foreign_key_constraint_error(&msg) {
                "cannot delete slave because it is used by the Analyzer dashboard (remove dependent tiles/signals first)".to_string()
            } else {
                format!("failed to delete slave: {e}")
            }
        })?;
    Ok(())
}

#[tauri::command]
pub fn list_slave_register_rows(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
    function_code: i64,
) -> Result<Vec<SlaveRegisterRow>, String> {
    let conn = open_workspace_db(&app, &name)?;
    if slave_id <= 0 {
        return Err("slave_id must be > 0".to_string());
    }
    if !matches!(function_code, 1 | 2 | 3 | 4 | 5 | 6 | 15 | 16) {
        return Err("function_code must be one of 1,2,3,4,5,6,15,16".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, slave_id, function_code, address, alias, data_type, \"order\", display_format, write_value, updated_at
             FROM slave_register_rows
             WHERE slave_id = ?1 AND function_code = ?2
             ORDER BY address ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map((slave_id, function_code), |row| {
            Ok(SlaveRegisterRow {
                id: row.get(0)?,
                slave_id: row.get(1)?,
                function_code: row.get(2)?,
                address: row.get(3)?,
                alias: row.get(4)?,
                data_type: row.get(5)?,
                order: row.get(6)?,
                display_format: row.get(7)?,
                write_value: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("failed to query register rows: {e}"))?;

    let mut out: Vec<SlaveRegisterRow> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read register row: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn save_slave_register_rows(
    app: tauri::AppHandle,
    name: String,
    slave_id: i64,
    function_code: i64,
    rows: Vec<SlaveRegisterRowUpsert>,
    now_iso: String,
) -> Result<(), String> {
    let mut conn = open_workspace_db(&app, &name)?;
    if slave_id <= 0 {
        return Err("slave_id must be > 0".to_string());
    }
    if !matches!(function_code, 1 | 2 | 3 | 4 | 5 | 6 | 15 | 16) {
        return Err("function_code must be one of 1,2,3,4,5,6,15,16".to_string());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    let mut addresses: Vec<i64> = Vec::with_capacity(rows.len());
    {
        let mut upsert = tx
            .prepare(
                "INSERT INTO slave_register_rows (
                    slave_id, function_code, address,
                    alias, data_type, \"order\", display_format,
                    write_value,
                    updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ON CONFLICT(slave_id, function_code, address) DO UPDATE SET
                    alias=excluded.alias,
                    data_type=excluded.data_type,
                    \"order\"=excluded.\"order\",
                    display_format=excluded.display_format,
                    write_value=excluded.write_value,
                    updated_at=excluded.updated_at;",
            )
            .map_err(|e| format!("failed to prepare upsert: {e}"))?;

        for r in &rows {
            if r.address < 0 {
                return Err("address must be >= 0".to_string());
            }
            let dt = r.data_type.trim();
            if dt.is_empty() {
                return Err("data_type is required".to_string());
            }
            let order = r.order.trim();
            let order_value = if order.is_empty() { "ABCD" } else { order };
            let fmt = r.display_format.trim();
            if fmt.is_empty() {
                return Err("display_format is required".to_string());
            }

            upsert
                .execute((
                    slave_id,
                    function_code,
                    r.address,
                    r.alias.trim(),
                    dt,
                    order_value,
                    fmt,
                    r.write_value,
                    now_iso.as_str(),
                ))
                .map_err(|e| format!("failed to upsert register row: {e}"))?;
            addresses.push(r.address);
        }
    }

    addresses.sort_unstable();
    addresses.dedup();

    // Delete rows that were removed by the user (this is the only part that can be blocked
    // by analyzer foreign key constraints).
    if addresses.is_empty() {
        tx.execute(
            "DELETE FROM slave_register_rows WHERE slave_id = ?1 AND function_code = ?2;",
            (slave_id, function_code),
        )
        .map_err(|e| {
            let msg = format!("{e}");
            if is_foreign_key_constraint_error(&msg) {
                "cannot delete register rows because some are used by the Analyzer dashboard (remove dependent tiles/signals first)".to_string()
            } else {
                format!("failed to delete removed register rows: {e}")
            }
        })?;
    } else {
        let mut sql =
            "DELETE FROM slave_register_rows WHERE slave_id = ?1 AND function_code = ?2 AND address NOT IN ("
                .to_string();
        for i in 0..addresses.len() {
            if i > 0 {
                sql.push(',');
            }
            sql.push_str(&format!("?{}", i + 3));
        }
        sql.push_str(");");

        let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(2 + addresses.len());
        params.push(rusqlite::types::Value::Integer(slave_id));
        params.push(rusqlite::types::Value::Integer(function_code));
        for a in addresses {
            params.push(rusqlite::types::Value::Integer(a));
        }

        tx.execute(&sql, rusqlite::params_from_iter(params))
            .map_err(|e| {
                let msg = format!("{e}");
                if is_foreign_key_constraint_error(&msg) {
                    "cannot delete register rows because some are used by the Analyzer dashboard (remove dependent tiles/signals first)".to_string()
                } else {
                    format!("failed to delete removed register rows: {e}")
                }
            })?;
    }

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    Ok(())
}


