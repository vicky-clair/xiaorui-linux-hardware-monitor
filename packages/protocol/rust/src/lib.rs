use serde::{Deserialize, Deserializer, Serialize, de};
use std::collections::BTreeMap;
use std::fmt;

pub const PROTOCOL_NAME: &str = "lhm-ipc";
pub const SCHEMA_VERSION: &str = "1.0";
pub const IPC_MAX_FRAME_BYTES: usize = 1_048_576; // 1 MiB (ADR-0003)

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Supported,
    Unsupported,
    PermissionDenied,
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadingQuality {
    Valid,
    Stale,
    SensorFault,
    OutOfRange,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceStatus {
    Online,
    Standby,
    Offline,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Normal,
    Warning,
    Critical,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Unit {
    Celsius,
    Rpm,
    Volt,
    Watt,
    Ampere,
    Percent,
    Hertz,
    Byte,
    BytePerSecond,
    Second,
    Count,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceType {
    Cpu,
    Gpu,
    Motherboard,
    Memory,
    Storage,
    Fan,
    Psu,
    Network,
    System,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SensorType {
    Temperature,
    FanSpeed,
    Voltage,
    Power,
    Current,
    Utilization,
    Frequency,
    Memory,
    Throughput,
    ErrorCount,
    Duration,
    Other,
}

/// Decimal unsigned integer encoded as a JSON string to avoid IEEE-754 precision loss (> 2^53).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UintString(String);

impl UintString {
    pub fn new(value: impl Into<String>) -> Result<Self, ProtocolError> {
        let s = value.into();
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err(ProtocolError::InvalidUintString(s));
        }
        Ok(Self(s))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<u128> for UintString {
    fn from(value: u128) -> Self {
        Self(value.to_string())
    }
}

impl<'de> Deserialize<'de> for UintString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        UintString::new(s).map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    InvalidUintString(String),
    InvalidReadingInvariant(&'static str),
    InvalidProtocol(String),
    EmptyFrame,
    FrameTooLarge { size: usize, max: usize },
    InvalidUtf8,
    Json(String),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUintString(v) => write!(f, "invalid decimal uint string: {v}"),
            Self::InvalidReadingInvariant(msg) => write!(f, "invalid sensor reading: {msg}"),
            Self::InvalidProtocol(p) => write!(f, "unexpected ipc protocol: {p}"),
            Self::EmptyFrame => write!(f, "ipc frame must not be empty"),
            Self::FrameTooLarge { size, max } => {
                write!(f, "ipc frame size {size} exceeds maximum {max} bytes")
            }
            Self::InvalidUtf8 => write!(f, "ipc frame payload is not valid UTF-8"),
            Self::Json(msg) => write!(f, "json error: {msg}"),
        }
    }
}

impl std::error::Error for ProtocolError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Host {
    pub host_id: String,
    pub hostname: String,
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub architecture: String,
    pub agent_version: String,
    #[serde(default)]
    pub boot_time: Option<String>,
    #[serde(default)]
    pub uptime_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub stable: bool,
    #[serde(default)]
    pub pci_bus_id: Option<String>,
    #[serde(default)]
    pub pci_vendor_id: Option<String>,
    #[serde(default)]
    pub pci_device_id: Option<String>,
    #[serde(default)]
    pub wwn: Option<String>,
    #[serde(default)]
    pub serial: Option<String>,
    #[serde(default)]
    pub nvme_nguid: Option<String>,
    #[serde(default)]
    pub driver: Option<String>,
    #[serde(default)]
    pub raw_path: Option<String>,
    #[serde(default)]
    pub topology: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Device {
    pub device_id: String,
    pub host_id: String,
    pub device_type: DeviceType,
    pub vendor: String,
    pub model: String,
    pub name: String,
    pub identity: DeviceIdentity,
    pub capabilities: Vec<String>,
    pub device_status: DeviceStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sensor {
    pub sensor_id: String,
    pub device_id: String,
    pub sensor_type: SensorType,
    pub sensor_name: String,
    pub source: String,
    pub unit: Unit,
    pub capability_status: CapabilityStatus,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SensorReading {
    pub schema_version: String,
    pub host_id: String,
    pub device_id: String,
    pub sensor_id: String,
    pub metric: String,
    pub value: Option<f64>,
    pub unit: Unit,
    pub quality: ReadingQuality,
    pub source: String,
    pub collected_at: String,
}

#[derive(Deserialize)]
struct SensorReadingRaw {
    schema_version: String,
    host_id: String,
    device_id: String,
    sensor_id: String,
    metric: String,
    value: Option<f64>,
    unit: Unit,
    quality: ReadingQuality,
    source: String,
    collected_at: String,
}

impl SensorReading {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        match (self.quality, self.value) {
            (ReadingQuality::Valid, None) => Err(ProtocolError::InvalidReadingInvariant(
                "quality=valid requires a numeric value",
            )),
            (ReadingQuality::Missing, Some(_)) => Err(ProtocolError::InvalidReadingInvariant(
                "quality=missing requires value=null (never substitute 0)",
            )),
            _ => Ok(()),
        }
    }
}

impl<'de> Deserialize<'de> for SensorReading {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = SensorReadingRaw::deserialize(deserializer)?;
        let reading = Self {
            schema_version: raw.schema_version,
            host_id: raw.host_id,
            device_id: raw.device_id,
            sensor_id: raw.sensor_id,
            metric: raw.metric,
            value: raw.value,
            unit: raw.unit,
            quality: raw.quality,
            source: raw.source,
            collected_at: raw.collected_at,
        };
        reading.validate().map_err(de::Error::custom)?;
        Ok(reading)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollectorRunStatus {
    Running,
    Degraded,
    Stopped,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectorStatus {
    pub collector_name: String,
    pub host_id: String,
    pub status: CollectorRunStatus,
    pub capability_status: CapabilityStatus,
    pub interval_seconds: u64,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub last_success_at: Option<String>,
    pub consecutive_failures: u64,
    #[serde(default)]
    pub last_error_code: Option<String>,
    #[serde(default)]
    pub last_error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub diagnostic_id: String,
    pub host_id: String,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub collector_name: Option<String>,
    pub level: DiagnosticLevel,
    pub error_code: String,
    pub source: String,
    pub message: String,
    #[serde(default)]
    pub remediation: Option<String>,
    pub occurred_at: String,
    #[serde(default)]
    pub details: Option<BTreeMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartProtocolType {
    Ata,
    Nvme,
    Scsi,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SmartAttribute {
    pub id: u32,
    pub name: String,
    #[serde(default)]
    pub value: Option<i64>,
    #[serde(default)]
    pub worst: Option<i64>,
    #[serde(default)]
    pub threshold: Option<i64>,
    pub raw_value: UintString,
    #[serde(default)]
    pub raw_string: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmartReport {
    pub schema_version: String,
    pub host_id: String,
    pub device_id: String,
    pub device_path: String,
    pub protocol_type: SmartProtocolType,
    pub device_status: DeviceStatus,
    #[serde(default)]
    pub smart_passed: Option<bool>,
    #[serde(default)]
    pub temperature_celsius: Option<f64>,
    #[serde(default)]
    pub power_on_hours: Option<UintString>,
    #[serde(default)]
    pub power_cycles: Option<UintString>,
    #[serde(default)]
    pub data_units_read: Option<UintString>,
    #[serde(default)]
    pub data_units_written: Option<UintString>,
    #[serde(default)]
    pub percentage_used: Option<f64>,
    #[serde(default)]
    pub available_spare: Option<f64>,
    #[serde(default)]
    pub critical_warning: Option<u64>,
    #[serde(default)]
    pub firmware_version: Option<String>,
    #[serde(default)]
    pub serial_number: Option<String>,
    #[serde(default)]
    pub rotation_rate_rpm: Option<u64>,
    #[serde(default)]
    pub sata_link_speed: Option<String>,
    #[serde(default)]
    pub apm_level: Option<u64>,
    #[serde(default)]
    pub write_cache_enabled: Option<bool>,
    #[serde(default)]
    pub trim_supported: Option<bool>,
    #[serde(default)]
    pub self_test_passed: Option<bool>,
    #[serde(default)]
    pub self_test_last_status: Option<String>,
    #[serde(default)]
    pub self_test_last_hours: Option<UintString>,
    #[serde(default)]
    pub error_log_count: Option<u64>,
    #[serde(default)]
    pub media_errors: Option<UintString>,
    #[serde(default)]
    pub num_err_log_entries: Option<UintString>,
    #[serde(default)]
    pub unsafe_shutdowns: Option<UintString>,
    #[serde(default)]
    pub warning_temp_time_min: Option<u64>,
    #[serde(default)]
    pub critical_comp_time_min: Option<u64>,
    #[serde(default)]
    pub temperature_sensors_celsius: Option<Vec<f64>>,
    pub attributes: Vec<SmartAttribute>,
    pub collected_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IpcMessageType {
    Hello,
    HelloAck,
    Heartbeat,
    Ack,
    Inventory,
    SensorReadings,
    SmartReport,
    CollectorStatus,
    Diagnostic,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IpcMessage {
    pub protocol: String,
    pub schema_version: String,
    pub message_id: String,
    pub message_type: IpcMessageType,
    pub host_id: String,
    pub agent_instance_id: String,
    pub sequence: u64,
    pub sent_at: String,
    pub payload: serde_json::Value,
}

#[derive(Deserialize)]
struct IpcMessageRaw {
    protocol: String,
    schema_version: String,
    message_id: String,
    message_type: IpcMessageType,
    host_id: String,
    agent_instance_id: String,
    sequence: u64,
    sent_at: String,
    payload: serde_json::Value,
}

impl<'de> Deserialize<'de> for IpcMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = IpcMessageRaw::deserialize(deserializer)?;
        if raw.protocol != PROTOCOL_NAME {
            return Err(de::Error::custom(ProtocolError::InvalidProtocol(
                raw.protocol,
            )));
        }
        Ok(Self {
            protocol: raw.protocol,
            schema_version: raw.schema_version,
            message_id: raw.message_id,
            message_type: raw.message_type,
            host_id: raw.host_id,
            agent_instance_id: raw.agent_instance_id,
            sequence: raw.sequence,
            sent_at: raw.sent_at,
            payload: raw.payload,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleOperator {
    Gt,
    Gte,
    Lt,
    Lte,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThresholdSource {
    HardwareLimit,
    UserDeviceOverride,
    GenericDefault,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrendDirection {
    Rising,
    Stable,
    Falling,
    InsufficientData,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertStateName {
    Ok,
    Pending,
    Firing,
    Resolved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertTransitionKind {
    Noop,
    Trigger,
    Escalate,
    Resolve,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlertRuleSpec {
    pub rule_id: String,
    pub metric: String,
    pub device_type: DeviceType,
    #[serde(default)]
    pub device_id: Option<String>,
    pub operator: RuleOperator,
    pub threshold: f64,
    pub unit: Unit,
    pub duration_seconds: u64,
    pub severity: Severity,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HardwareLimit {
    pub device_id: String,
    pub metric: String,
    pub unit: Unit,
    #[serde(default)]
    pub max_value: Option<f64>,
    #[serde(default)]
    pub crit_value: Option<f64>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlertStateSnapshot {
    pub state_key: String,
    pub host_id: String,
    pub device_id: String,
    pub rule_id: String,
    pub state: AlertStateName,
    #[serde(default)]
    pub pending_since: Option<String>,
    #[serde(default)]
    pub firing_since: Option<String>,
    pub last_evaluated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzeDeviceRef {
    pub device_id: String,
    pub device_type: DeviceType,
    pub device_status: DeviceStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryPoint {
    pub device_id: String,
    pub sensor_id: String,
    pub metric: String,
    pub value: Option<f64>,
    pub quality: ReadingQuality,
    pub collected_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzeRequest {
    pub schema_version: String,
    pub host_id: String,
    pub evaluated_at: String,
    pub rule_version: String,
    pub devices: Vec<AnalyzeDeviceRef>,
    pub readings: Vec<SensorReading>,
    pub history_points: Vec<HistoryPoint>,
    pub rules: Vec<AlertRuleSpec>,
    pub hardware_limits: Vec<HardwareLimit>,
    pub prev_alert_states: Vec<AlertStateSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnomalyRecord {
    pub code: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CorrelationRecord {
    pub code: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoreFactorRecord {
    pub metric: String,
    pub delta: f64,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalysisResultRecord {
    pub host_id: String,
    pub device_id: String,
    pub severity: Severity,
    pub score: Option<f64>,
    pub engine_version: String,
    pub rule_version: String,
    pub threshold_source: ThresholdSource,
    pub trend: TrendDirection,
    pub anomalies: Vec<AnomalyRecord>,
    pub correlations: Vec<CorrelationRecord>,
    pub factors: Vec<ScoreFactorRecord>,
    pub analyzed_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlertTransitionRecord {
    pub state_key: String,
    pub host_id: String,
    pub device_id: String,
    pub rule_id: String,
    pub transition: AlertTransitionKind,
    pub severity: Severity,
    pub summary: String,
    pub metric: String,
    pub observed_value: Option<f64>,
    pub threshold: f64,
    pub threshold_source: ThresholdSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzeResponse {
    pub schema_version: String,
    pub engine_version: String,
    pub rule_version: String,
    pub analyzed_at: String,
    pub analysis_results: Vec<AnalysisResultRecord>,
    pub alert_transitions: Vec<AlertTransitionRecord>,
    pub next_alert_states: Vec<AlertStateSnapshot>,
}

/// Encodes a serializable message into a 4-byte big-endian length-prefixed UTF-8 JSON frame (ADR-0003).
pub fn encode_frame<T: Serialize>(value: &T) -> Result<Vec<u8>, ProtocolError> {
    let payload = serde_json::to_vec(value).map_err(|e| ProtocolError::Json(e.to_string()))?;
    if payload.is_empty() {
        return Err(ProtocolError::EmptyFrame);
    }
    if payload.len() > IPC_MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge {
            size: payload.len(),
            max: IPC_MAX_FRAME_BYTES,
        });
    }
    let len = payload.len() as u32;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&len.to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

/// Incremental decoder for 4-byte big-endian length-prefixed UTF-8 JSON frames.
#[derive(Debug, Default)]
pub struct FrameDecoder {
    buf: Vec<u8>,
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, ProtocolError> {
        self.buf.extend_from_slice(chunk);
        let mut frames = Vec::new();
        let mut offset = 0;

        while self.buf.len().saturating_sub(offset) >= 4 {
            let header: [u8; 4] = self.buf[offset..offset + 4]
                .try_into()
                .expect("slice length checked >= 4");
            let len = u32::from_be_bytes(header) as usize;

            if len == 0 {
                self.buf.clear();
                return Err(ProtocolError::EmptyFrame);
            }
            if len > IPC_MAX_FRAME_BYTES {
                self.buf.clear();
                return Err(ProtocolError::FrameTooLarge {
                    size: len,
                    max: IPC_MAX_FRAME_BYTES,
                });
            }
            if self.buf.len() - offset < 4 + len {
                break;
            }

            let text = match std::str::from_utf8(&self.buf[offset + 4..offset + 4 + len]) {
                Ok(s) => s.to_owned(),
                Err(_) => {
                    self.buf.clear();
                    return Err(ProtocolError::InvalidUtf8);
                }
            };
            frames.push(text);
            offset += 4 + len;
        }

        if offset > 0 {
            self.buf.drain(0..offset);
        }
        Ok(frames)
    }

    pub fn pending_bytes(&self) -> usize {
        self.buf.len()
    }
}
