export const PROTOCOL_NAME = "lhm-ipc" as const;
export const SCHEMA_VERSION = "1.0" as const;
export const IPC_MAX_FRAME_BYTES = 1_048_576; // 1 MiB (ADR-0003)

export type CapabilityStatus =
  | "supported"
  | "unsupported"
  | "permission_denied"
  | "unavailable"
  | "unknown";

export type ReadingQuality =
  | "valid"
  | "stale"
  | "sensor_fault"
  | "out_of_range"
  | "missing";

export type DeviceStatus = "online" | "standby" | "offline" | "unknown";

export type Severity = "normal" | "warning" | "critical" | "unknown";

export type Unit =
  | "celsius"
  | "rpm"
  | "volt"
  | "watt"
  | "ampere"
  | "percent"
  | "hertz"
  | "byte"
  | "byte_per_second"
  | "second"
  | "count";

export type DeviceType =
  | "cpu"
  | "gpu"
  | "motherboard"
  | "memory"
  | "storage"
  | "fan"
  | "psu"
  | "network"
  | "system"
  | "other";

export type SensorType =
  | "temperature"
  | "fan_speed"
  | "voltage"
  | "power"
  | "current"
  | "utilization"
  | "frequency"
  | "memory"
  | "throughput"
  | "error_count"
  | "duration"
  | "other";

/** Decimal string representing an unsigned integer (used for > 2^53 counters). */
export type UintString = string;

/** UTC RFC 3339 timestamp string. */
export type UtcTimestamp = string;

export interface Host {
  host_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  kernel_version: string;
  architecture: string;
  agent_version: string;
  boot_time?: UtcTimestamp | null;
  uptime_seconds?: number | null;
}

export interface DeviceIdentity {
  stable: boolean;
  pci_bus_id?: string | null;
  pci_vendor_id?: string | null;
  pci_device_id?: string | null;
  wwn?: string | null;
  serial?: string | null;
  nvme_nguid?: string | null;
  driver?: string | null;
  raw_path?: string | null;
  topology?: string | null;
}

export interface Device {
  device_id: string;
  host_id: string;
  device_type: DeviceType;
  vendor: string;
  model: string;
  name: string;
  identity: DeviceIdentity;
  capabilities: string[];
  device_status: DeviceStatus;
}

export interface Sensor {
  sensor_id: string;
  device_id: string;
  sensor_type: SensorType;
  sensor_name: string;
  source: string;
  unit: Unit;
  capability_status: CapabilityStatus;
  enabled: boolean;
}

export interface SensorReading {
  schema_version: string;
  host_id: string;
  device_id: string;
  sensor_id: string;
  metric: string;
  value: number | null;
  unit: Unit;
  quality: ReadingQuality;
  source: string;
  collected_at: UtcTimestamp;
}

export interface CollectorStatus {
  collector_name: string;
  host_id: string;
  status: "running" | "degraded" | "stopped" | "error";
  capability_status: CapabilityStatus;
  interval_seconds: number;
  last_run_at?: UtcTimestamp | null;
  last_success_at?: UtcTimestamp | null;
  consecutive_failures: number;
  last_error_code?: string | null;
  last_error_message?: string | null;
}

export interface Diagnostic {
  diagnostic_id: string;
  host_id: string;
  device_id?: string | null;
  collector_name?: string | null;
  level: "info" | "warn" | "error";
  error_code: string;
  source: string;
  message: string;
  remediation?: string | null;
  occurred_at: UtcTimestamp;
  details?: Record<string, unknown> | null;
}

export interface SmartAttribute {
  id: number;
  name: string;
  value?: number | null;
  worst?: number | null;
  threshold?: number | null;
  raw_value: UintString;
  raw_string?: string | null;
}

export interface SmartReport {
  schema_version: string;
  host_id: string;
  device_id: string;
  device_path: string;
  protocol_type: "ata" | "nvme" | "scsi" | "unknown";
  device_status: DeviceStatus;
  smart_passed?: boolean | null;
  temperature_celsius?: number | null;
  power_on_hours?: UintString | null;
  power_cycles?: UintString | null;
  data_units_read?: UintString | null;
  data_units_written?: UintString | null;
  percentage_used?: number | null;
  available_spare?: number | null;
  critical_warning?: number | null;
  attributes: SmartAttribute[];
  collected_at: UtcTimestamp;
}

export type IpcMessageType =
  | "hello"
  | "hello_ack"
  | "heartbeat"
  | "ack"
  | "inventory"
  | "sensor_readings"
  | "smart_report"
  | "collector_status"
  | "diagnostic"
  | "error";

export interface IpcEnvelope<TType extends IpcMessageType, TPayload> {
  protocol: typeof PROTOCOL_NAME;
  schema_version: string;
  message_id: string;
  message_type: TType;
  host_id: string;
  agent_instance_id: string;
  sequence: number;
  sent_at: UtcTimestamp;
  payload: TPayload;
}

export type IpcMessage =
  | IpcEnvelope<"hello", { host: Host }>
  | IpcEnvelope<
      "hello_ack",
      { accepted: boolean; server_schema_version: string; reason?: string | null }
    >
  | IpcEnvelope<"heartbeat", { uptime_seconds: number }>
  | IpcEnvelope<"ack", { acked_sequence: number }>
  | IpcEnvelope<"inventory", { devices: Device[]; sensors: Sensor[] }>
  | IpcEnvelope<"sensor_readings", { readings: SensorReading[] }>
  | IpcEnvelope<"smart_report", { report: SmartReport }>
  | IpcEnvelope<"collector_status", { collectors: CollectorStatus[] }>
  | IpcEnvelope<"diagnostic", { diagnostic: Diagnostic }>
  | IpcEnvelope<"error", { error_code: string; message: string }>;

export type RuleOperator = "gt" | "gte" | "lt" | "lte";
export type ThresholdSource =
  | "hardware_limit"
  | "user_device_override"
  | "generic_default"
  | "unavailable";
export type TrendDirection = "rising" | "stable" | "falling" | "insufficient_data";
export type AlertStateName = "ok" | "pending" | "firing" | "resolved";
export type AlertTransitionKind = "noop" | "trigger" | "escalate" | "resolve";

export interface AlertRuleSpec {
  rule_id: string;
  metric: string;
  device_type: DeviceType;
  device_id?: string | null;
  operator: RuleOperator;
  threshold: number;
  unit: Unit;
  duration_seconds: number;
  severity: Severity;
  enabled: boolean;
}

export interface HardwareLimit {
  device_id: string;
  metric: string;
  unit: Unit;
  max_value?: number | null;
  crit_value?: number | null;
  source: string;
}

export interface AlertStateSnapshot {
  state_key: string;
  host_id: string;
  device_id: string;
  rule_id: string;
  state: AlertStateName;
  pending_since?: UtcTimestamp | null;
  firing_since?: UtcTimestamp | null;
  last_evaluated_at: UtcTimestamp;
}

export interface HistoryPoint {
  device_id: string;
  sensor_id: string;
  metric: string;
  value: number | null;
  quality: ReadingQuality;
  collected_at: UtcTimestamp;
}

export interface AnalyzeRequest {
  schema_version: string;
  host_id: string;
  evaluated_at: UtcTimestamp;
  rule_version: string;
  devices: Array<{
    device_id: string;
    device_type: DeviceType;
    device_status: DeviceStatus;
  }>;
  readings: SensorReading[];
  history_points: HistoryPoint[];
  rules: AlertRuleSpec[];
  hardware_limits: HardwareLimit[];
  prev_alert_states: AlertStateSnapshot[];
}

export interface AnalysisResultRecord {
  host_id: string;
  device_id: string;
  severity: Severity;
  score: number | null;
  engine_version: string;
  rule_version: string;
  threshold_source: ThresholdSource;
  trend: TrendDirection;
  anomalies: Array<{ code: string; reason: string }>;
  correlations: Array<{ code: string; summary: string }>;
  factors: Array<{ metric: string; delta: number; reason: string }>;
  analyzed_at: UtcTimestamp;
}

export interface AlertTransitionRecord {
  state_key: string;
  host_id: string;
  device_id: string;
  rule_id: string;
  transition: AlertTransitionKind;
  severity: Severity;
  summary: string;
  metric: string;
  observed_value: number | null;
  threshold: number;
  threshold_source: ThresholdSource;
}

export interface AnalyzeResponse {
  schema_version: string;
  engine_version: string;
  rule_version: string;
  analyzed_at: UtcTimestamp;
  analysis_results: AnalysisResultRecord[];
  alert_transitions: AlertTransitionRecord[];
  next_alert_states: AlertStateSnapshot[];
}
