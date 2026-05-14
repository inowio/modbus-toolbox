// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;
use serde_json::json;
use serialport::SerialPortType;
use tauri::Manager;

mod db;
mod models;
mod settings;
mod slaves;
mod workspace;
mod attachments;
mod logs;
mod traffic;

mod analyzer;

mod analyzer_polling;

mod modbus;
use modbus::{
    modbus_rtu_connect, modbus_rtu_diagnostics_echo, modbus_rtu_disconnect,
    modbus_rtu_mask_write_register, modbus_rtu_read_device_identification,
    modbus_rtu_read_holding_registers, modbus_rtu_read_input_registers, modbus_rtu_read_coils,
    modbus_rtu_read_discrete_inputs, modbus_rtu_write_multiple_coils, modbus_rtu_write_multiple_registers,
    modbus_rtu_write_single_coil, modbus_rtu_write_single_register, modbus_tcp_connect,
    modbus_tcp_diagnostics_echo, modbus_tcp_disconnect, modbus_tcp_mask_write_register,
    modbus_tcp_read_coils, modbus_tcp_read_device_identification, modbus_tcp_read_discrete_inputs,
    modbus_tcp_read_holding_registers, modbus_tcp_read_input_registers, modbus_tcp_write_multiple_coils,
    modbus_tcp_write_multiple_registers, modbus_tcp_write_single_coil, modbus_tcp_write_single_register,
    test_connection, ModbusState,
};

use settings::{
    get_client_settings, get_connection_settings, set_client_settings, set_connection_settings,
};

use slaves::{
    create_slave, delete_slave, list_slave_register_rows, list_slaves,
    save_slave_register_rows, update_slave,
};

use workspace::{
    create_workspace, delete_workspace, get_workspace, list_workspaces, touch_workspace,
    update_workspace_description, rename_workspace, export_workspace_package,
    validate_import_workspace, execute_workspace_import, clear_import_cache,
};

use models::ImportCache;
use std::sync::Mutex;

use attachments::{
    add_slave_attachment, delete_slave_attachment, export_slave_attachment, list_slave_attachments,
    read_slave_attachment,
};

use logs::{
    count_workspace_logs_to_delete,
    delete_workspace_logs,
    list_app_logs,
    list_workspace_logs,
    log_app_event,
    log_event,
    prune_app_logs,
};

use traffic::{clear_traffic_events, list_traffic_events, set_traffic_capture_enabled, TrafficCaptureState};

use analyzer::{
    can_delete_slave_register_row, create_analyzer_tile, delete_analyzer_signal, delete_analyzer_tile,
    list_analyzer_signals, list_analyzer_tiles, list_analyzer_tile_layouts, list_analyzer_tile_signals,
    save_analyzer_tile_layouts, set_analyzer_tile_polling_enabled, update_analyzer_tile, upsert_analyzer_signal,
};

use analyzer_polling::{start_analyzer_polling, stop_analyzer_polling, AnalyzerPollingState};

#[derive(Debug, Serialize)]
struct PortItem {
    port: String,
    label: String,
}

#[tauri::command]
fn list_serial_ports() -> Vec<PortItem> {
    match serialport::available_ports() {
        Ok(ports) => ports
            .into_iter()
            .map(|p| {
                let mut label = p.port_name.clone();
                match p.port_type {
                    SerialPortType::UsbPort(info) => {
                        let desc = info.product.as_deref().unwrap_or("");
                        let mfr = info.manufacturer.as_deref().unwrap_or("");
                        let sn = info.serial_number.as_deref().unwrap_or("");
                        label = format!(
                            "{}{}{}{}{}{}{}{}",
                            p.port_name,
                            if !mfr.is_empty() { " - " } else { "" },
                            mfr,
                            if !desc.is_empty() { " " } else { "" },
                            desc,
                            if !sn.is_empty() { " (" } else { "" },
                            if !sn.is_empty() { sn } else { "" },
                            if !sn.is_empty() { ")" } else { "" }
                        );
                    }
                    SerialPortType::BluetoothPort => {}
                    SerialPortType::PciPort => {}
                    SerialPortType::Unknown => {}
                }
                PortItem {
                    port: p.port_name,
                    label,
                }
            })
            .collect(),
        Err(_) => vec![],
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ModbusState::default())
        .manage(TrafficCaptureState::default())
        .manage(AnalyzerPollingState::default())
        .manage(ImportCache(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let version = app.package_info().version.to_string();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!("Inowio - Modbus Toolbox v{}", version));
            }

            let handle = app.handle();
            let details = json!({ "version": version }).to_string();
            log_app_event(
                &handle,
                "info",
                "app/startup",
                "App started",
                Some(details),
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            list_workspaces,
            get_workspace,
            create_workspace,
            touch_workspace,
            update_workspace_description,
            log_event,
            list_app_logs,
            list_workspace_logs,
            prune_app_logs,
            count_workspace_logs_to_delete,
            delete_workspace_logs,
            list_traffic_events,
            clear_traffic_events,
            set_traffic_capture_enabled,
            list_analyzer_tiles,
            create_analyzer_tile,
            update_analyzer_tile,
            delete_analyzer_tile,
            delete_analyzer_signal,
            set_analyzer_tile_polling_enabled,
            list_analyzer_tile_layouts,
            save_analyzer_tile_layouts,
            list_analyzer_tile_signals,
            list_analyzer_signals,
            upsert_analyzer_signal,
            can_delete_slave_register_row,
            start_analyzer_polling,
            stop_analyzer_polling,
            get_connection_settings,
            set_connection_settings,
            get_client_settings,
            set_client_settings,
            list_slaves,
            create_slave,
            update_slave,
            delete_slave,
            list_slave_register_rows,
            save_slave_register_rows,
            list_slave_attachments,
            add_slave_attachment,
            delete_slave_attachment,
            read_slave_attachment,
            export_slave_attachment,
            test_connection,
            modbus_tcp_connect,
            modbus_tcp_disconnect,
            modbus_tcp_read_coils,
            modbus_tcp_read_discrete_inputs,
            modbus_tcp_read_holding_registers,
            modbus_tcp_read_input_registers,
            modbus_tcp_read_device_identification,
            modbus_tcp_diagnostics_echo,
            modbus_tcp_mask_write_register,
            modbus_tcp_write_single_register,
            modbus_tcp_write_single_coil,
            modbus_tcp_write_multiple_coils,
            modbus_tcp_write_multiple_registers,
            modbus_rtu_connect,
            modbus_rtu_disconnect,
            modbus_rtu_read_coils,
            modbus_rtu_read_discrete_inputs,
            modbus_rtu_read_input_registers,
            modbus_rtu_read_holding_registers,
            modbus_rtu_read_device_identification,
            modbus_rtu_diagnostics_echo,
            modbus_rtu_mask_write_register,
            modbus_rtu_write_single_register,
            modbus_rtu_write_single_coil,
            modbus_rtu_write_multiple_coils,
            modbus_rtu_write_multiple_registers,
            delete_workspace,
            rename_workspace,
            export_workspace_package,
            validate_import_workspace,
            execute_workspace_import,
            clear_import_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
