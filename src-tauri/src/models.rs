use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSettings {
    pub kind: String,

    #[serde(default)]
    pub serial_port: Option<String>,
    #[serde(default)]
    pub serial_baud: Option<i64>,
    #[serde(default)]
    pub serial_parity: Option<String>,
    #[serde(default)]
    pub serial_data_bits: Option<i64>,
    #[serde(default)]
    pub serial_stop_bits: Option<i64>,
    #[serde(default)]
    pub serial_flow_control: Option<String>,

    #[serde(default)]
    pub tcp_host: Option<String>,
    #[serde(default)]
    pub tcp_port: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSettingsPatch {
    pub kind: String,

    #[serde(default)]
    pub serial_port: Option<Option<String>>,
    #[serde(default)]
    pub serial_baud: Option<Option<i64>>,
    #[serde(default)]
    pub serial_parity: Option<Option<String>>,
    #[serde(default)]
    pub serial_data_bits: Option<Option<i64>>,
    #[serde(default)]
    pub serial_stop_bits: Option<Option<i64>>,
    #[serde(default)]
    pub serial_flow_control: Option<Option<String>>,

    #[serde(default)]
    pub tcp_host: Option<Option<String>>,
    #[serde(default)]
    pub tcp_port: Option<Option<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSettings {
    #[serde(default)]
    pub response_timeout_ms: Option<i64>,
    #[serde(default)]
    pub connect_timeout_ms: Option<i64>,
    #[serde(default)]
    pub retries: Option<i64>,
    #[serde(default)]
    pub retry_delay_ms: Option<i64>,
    #[serde(default)]
    pub logging_min_level: Option<String>,
    #[serde(default)]
    pub logs_pane_open: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSettingsPatch {
    #[serde(default)]
    pub response_timeout_ms: Option<Option<i64>>,
    #[serde(default)]
    pub connect_timeout_ms: Option<Option<i64>>,
    #[serde(default)]
    pub retries: Option<Option<i64>>,
    #[serde(default)]
    pub retry_delay_ms: Option<Option<i64>>,
    #[serde(default)]
    pub logging_min_level: Option<Option<String>>,
    #[serde(default)]
    pub logs_pane_open: Option<Option<bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlaveItem {
    pub id: i64,
    pub name: String,
    pub unit_id: i64,
    #[serde(default)]
    pub poll_interval_ms: i64,
    #[serde(default)]
    pub connection_kind: String,
    #[serde(default)]
    pub address_offset: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlaveCreate {
    pub name: String,
    pub unit_id: i64,
    #[serde(default)]
    pub poll_interval_ms: Option<i64>,
    #[serde(default)]
    pub address_offset: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlavePatch {
    #[serde(default)]
    pub name: Option<Option<String>>,
    #[serde(default)]
    pub unit_id: Option<Option<i64>>,
    #[serde(default)]
    pub poll_interval_ms: Option<Option<i64>>,
    #[serde(default)]
    pub connection_kind: Option<Option<String>>,
    #[serde(default)]
    pub address_offset: Option<Option<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlaveRegisterRow {
    pub id: i64,
    pub slave_id: i64,
    pub function_code: i64,
    pub address: i64,
    pub alias: String,
    pub data_type: String,
    #[serde(default)]
    pub order: String,
    pub display_format: String,
    #[serde(default)]
    pub write_value: Option<i64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlaveRegisterRowUpsert {
    pub address: i64,
    #[serde(default)]
    pub alias: String,
    pub data_type: String,
    #[serde(default)]
    pub order: String,
    pub display_format: String,
    #[serde(default)]
    pub write_value: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_workspace_db_file")]
    pub db_file: String,
    pub created_at: String,
    pub updated_at: String,
}

pub(crate) fn default_workspace_db_file() -> String {
    "workspace.db".to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportValidation {
    pub workspace_name: String,
    pub conflict: bool,
}

pub struct ImportCache(pub Mutex<Option<Vec<u8>>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTile {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub config_json: String,
    #[serde(default)]
    pub polling_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTileLayout {
    pub tile_id: i64,
    pub breakpoint: String,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTileLayoutUpsert {
    pub breakpoint: String,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTileSignalLink {
    pub signal_id: String,
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTileCreate {
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub config_json: String,
    #[serde(default)]
    pub polling_enabled: bool,
    #[serde(default)]
    pub layouts: Vec<AnalyzerTileLayoutUpsert>,
    #[serde(default)]
    pub signal_links: Vec<AnalyzerTileSignalLink>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTileUpdate {
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub config_json: String,
    #[serde(default)]
    pub polling_enabled: bool,
    #[serde(default)]
    pub signal_links: Vec<AnalyzerTileSignalLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTileSignalInfo {
    pub tile_id: i64,
    pub signal_id: String,
    pub role: String,
    pub function_code: i64,
    pub address: i64,
    pub alias: String,
    pub data_type: String,
    pub order: String,
    pub display_format: String,
    pub decoder_json: String,
    pub last_value_json: Option<String>,
    pub last_updated_ts_ms: Option<i64>,
    pub state: String,
    pub error_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerSignal {
    pub id: String,
    pub slave_id: i64,
    pub connection_kind: String,
    pub function_kind: String,
    pub register_row_id: i64,
    pub address: i64,
    pub decoder_json: String,
    #[serde(default)]
    pub last_value_json: Option<String>,
    #[serde(default)]
    pub last_updated_ts_ms: Option<i64>,
    pub state: String,
    #[serde(default)]
    pub error_json: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerSignalUpsert {
    pub id: String,
    pub slave_id: i64,
    pub function_kind: String,
    pub register_row_id: i64,
    #[serde(default)]
    pub decoder_json: String,
}
