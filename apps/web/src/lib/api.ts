import type {
  CapabilityStatus,
  DeviceStatus,
  DeviceType,
  ReadingQuality,
  SensorType,
  Unit,
} from "@lhm/protocol/types";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  request_id: string;
  timestamp: string;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface UserInfo {
  user_id: string;
  username: string;
  role: "admin" | "viewer";
}

export interface HostRow {
  hostId: string;
  hostname: string;
  osName: string;
  osVersion: string;
  kernelVersion: string;
  architecture: string;
  agentVersion: string;
  bootTime: string | null;
  uptimeSeconds: number | null;
  lastSeenAt: string;
}

export interface DeviceRow {
  deviceId: string;
  hostId: string;
  deviceType: DeviceType;
  vendor: string;
  model: string;
  name: string;
  capabilities: string[];
  deviceStatus: DeviceStatus;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DeviceDetail extends DeviceRow {
  identity: {
    stable: boolean;
    pciBusId: string | null;
    pciVendorId: string | null;
    pciDeviceId: string | null;
    wwn: string | null;
    serial: string | null;
    nvmeNguid: string | null;
    driver: string | null;
    rawPath: string | null;
    topology: string | null;
  } | null;
  sensors: SensorRow[];
}

export interface SensorRow {
  sensorId: string;
  deviceId: string;
  hostId: string;
  sensorType: SensorType;
  sensorName: string;
  source: string;
  unit: Unit;
  capabilityStatus: CapabilityStatus;
  enabled: boolean;
  updatedAt: string;
}

export interface RawReadingRow {
  id: number;
  sensorId: string;
  deviceId: string;
  metric: string;
  value: number | null;
  unit: Unit;
  quality: ReadingQuality;
  source: string;
  collectedAt: string;
}

export interface AggReadingRow {
  id: number;
  sensorId: string;
  bucketStart: string;
  minValue: number | null;
  maxValue: number | null;
  avgValue: number | null;
  sampleCount: number;
  validCount: number;
}

export interface CoverageDevice {
  device_id: string;
  device_name: string;
  device_status: DeviceStatus;
  discovered: boolean;
  has_temperature_capability: boolean;
  temperature_read_ok: boolean;
  supported_metrics: string[];
  unsupported_metrics: string[];
  permission_denied_metrics: string[];
  unavailable_metrics: string[];
  stale_metrics: string[];
  last_success_at: string | null;
}

export interface CoverageResponse {
  total_devices: number;
  total_sensors: number;
  stale_after_seconds: number;
  devices: CoverageDevice[];
}

export interface CollectorRow {
  hostId: string;
  collectorName: string;
  status: string;
  capabilityStatus: CapabilityStatus;
  intervalSeconds: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export interface DiagnosticRow {
  id: number;
  diagnosticId: string;
  hostId: string;
  deviceId: string | null;
  collectorName: string | null;
  level: "info" | "warn" | "error";
  errorCode: string;
  source: string;
  message: string;
  remediation: string | null;
  occurredAt: string;
}

export interface SmartSummary {
  id: number;
  deviceId: string;
  devicePath: string;
  protocolType: string;
  deviceStatus: DeviceStatus;
  smartPassed: boolean | null;
  temperatureCelsius: number | null;
  powerOnHours: string | null;
  powerCycles: string | null;
  dataUnitsRead: string | null;
  dataUnitsWritten: string | null;
  percentageUsed: number | null;
  availableSpare: number | null;
  criticalWarning: number | null;
  firmwareVersion?: string | null;
  serialNumber?: string | null;
  rotationRateRpm?: number | null;
  sataLinkSpeed?: string | null;
  apmLevel?: number | null;
  writeCacheEnabled?: boolean | null;
  trimSupported?: boolean | null;
  selfTestPassed?: boolean | null;
  selfTestLastStatus?: string | null;
  selfTestLastHours?: string | null;
  errorLogCount?: number | null;
  mediaErrors?: string | null;
  numErrLogEntries?: string | null;
  unsafeShutdowns?: string | null;
  warningTempTimeMin?: number | null;
  criticalCompTimeMin?: number | null;
  temperatureSensorsCelsius?: number[] | null;
  collectedAt: string;
}

export interface MountUsageRow {
  mountpoint: string;
  fstype: string | null;
  usagePercent: number | null;
  usedBytes: number | null;
  availBytes: number | null;
  totalBytes: number | null;
  collectedAt: string | null;
}

export interface SmartAttributeRow {
  attrId: number;
  name: string;
  value: number | null;
  worst: number | null;
  threshold: number | null;
  rawValue: string;
  rawString: string | null;
}

export interface StorageItem {
  device: DeviceRow;
  latest_smart: SmartSummary | null;
  mounts?: MountUsageRow[];
}

export interface StorageSmartDetail {
  device: DeviceRow;
  latest: (SmartSummary & { attributes: SmartAttributeRow[] }) | null;
  history: SmartSummary[];
}

export interface OverviewResponse {
  hosts: HostRow[];
  device_count: number;
  sensor_count: number;
  collectors: CollectorRow[];
  recent_diagnostics: DiagnosticRow[];
  coverage_summary: {
    devices_with_stale: number;
    devices_with_permission_denied: number;
  };
}

export interface AnalysisRow {
  id: number;
  host_id: string;
  device_id: string;
  severity: "normal" | "warning" | "critical" | "unknown";
  score: number | null;
  engine_version: string;
  rule_version: string;
  threshold_source: string;
  trend: string;
  anomalies: Array<{ code: string; reason: string }>;
  correlations: Array<{ code: string; summary: string }>;
  factors: Array<{ metric: string; delta: number; reason: string }>;
  analyzed_at: string;
}

export interface AlertRow {
  alert_id: string;
  host_id: string;
  device_id: string;
  rule_id: string;
  severity: "normal" | "warning" | "critical" | "unknown";
  status: string;
  summary: string;
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
}

export interface AlertRuleRow {
  rule_id: string;
  metric: string;
  device_type: DeviceType;
  device_id: string | null;
  operator: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  unit: Unit;
  duration_seconds: number;
  severity: "normal" | "warning" | "critical" | "unknown";
  enabled: boolean;
}

export interface GlobalCheckResult {
  agent_collected: boolean;
  agent_note: string | null;
  analysis_ok: boolean;
  degraded: boolean;
  analyzed_devices: number;
  transitions_count: number;
  severity_counts: {
    normal: number;
    warning: number;
    critical: number;
    unknown: number;
  };
  checked_at: string;
}

export interface ConfigResponse {
  settings: Record<string, unknown>;
  defaults: {
    stale_after_seconds: number;
    retention_raw_days: number;
    retention_1m_days: number;
    retention_1h_days: number;
    retention_smart_days: number;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body?.success) {
    throw new ApiClientError(
      res.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? `Request failed with status ${res.status}`,
    );
  }
  return body.data as T;
}

export const api = {
  me: () => request<{ user: UserInfo }>("/api/v1/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: UserInfo }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  bootstrap: (bootstrap_token: string, username: string, password: string) =>
    request<{ user: UserInfo }>("/api/v1/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({ bootstrap_token, username, password }),
    }),
  logout: () =>
    request<{ logged_out: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  overview: () => request<OverviewResponse>("/api/v1/system/overview"),
  runGlobalCheck: () =>
    request<GlobalCheckResult>("/api/v1/system/check", { method: "POST" }),
  hosts: () => request<{ hosts: HostRow[] }>("/api/v1/hosts"),
  devices: (deviceType?: string) =>
    request<{ devices: DeviceRow[] }>(
      deviceType
        ? `/api/v1/devices?device_type=${encodeURIComponent(deviceType)}`
        : "/api/v1/devices",
    ),
  deviceDetail: (id: string) =>
    request<DeviceDetail>(`/api/v1/devices/${encodeURIComponent(id)}`),
  sensors: (params?: { deviceId?: string; sensorType?: string }) => {
    const qs = new URLSearchParams();
    if (params?.deviceId) qs.set("device_id", params.deviceId);
    if (params?.sensorType) qs.set("sensor_type", params.sensorType);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ sensors: SensorRow[] }>(`/api/v1/sensors${suffix}`);
  },
  sensorReadings: (
    sensorId: string,
    params: { from?: string; to?: string; granularity?: "raw" | "1m" | "1h"; limit?: number },
  ) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.granularity) qs.set("granularity", params.granularity);
    if (params.limit) qs.set("limit", String(params.limit));
    return request<{
      granularity: "raw" | "1m" | "1h";
      items: Array<RawReadingRow | AggReadingRow>;
      next_cursor: number | null;
    }>(`/api/v1/sensors/${encodeURIComponent(sensorId)}/readings?${qs.toString()}`);
  },
  coverage: () => request<CoverageResponse>("/api/v1/coverage"),
  storage: () => request<{ storage: StorageItem[] }>("/api/v1/storage"),
  storageSmart: (deviceId: string) =>
    request<StorageSmartDetail>(
      `/api/v1/storage/${encodeURIComponent(deviceId)}/smart`,
    ),
  collectors: () => request<{ collectors: CollectorRow[] }>("/api/v1/collectors"),
  diagnostics: (limit = 100) =>
    request<{ diagnostics: DiagnosticRow[] }>(
      `/api/v1/diagnostics?limit=${limit}`,
    ),
  config: () => request<ConfigResponse>("/api/v1/config"),
  updateConfig: (settings: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown> }>("/api/v1/config", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  analysis: () => request<{ results: AnalysisRow[] }>("/api/v1/analysis"),
  runAnalysis: () =>
    request<{ ok: boolean; degraded: boolean; analyzed_devices: number }>(
      "/api/v1/analysis/run",
      { method: "POST" },
    ),
  alerts: () => request<{ alerts: AlertRow[] }>("/api/v1/alerts"),
  ackAlert: (alertId: string) =>
    request<{ alert_id: string; acknowledged_at: string; acknowledged_by: string }>(
      `/api/v1/alerts/${encodeURIComponent(alertId)}/ack`,
      { method: "POST" },
    ),
  alertRules: () => request<{ rules: AlertRuleRow[] }>("/api/v1/alert-rules"),
  createAlertRule: (rule: Omit<AlertRuleRow, "enabled"> & { enabled?: boolean }) =>
    request<{ rule: AlertRuleRow; warning: string | null }>("/api/v1/alert-rules", {
      method: "POST",
      body: JSON.stringify(rule),
    }),
  deleteAlertRule: (ruleId: string) =>
    request<{ deleted: boolean }>(
      `/api/v1/alert-rules/${encodeURIComponent(ruleId)}`,
      { method: "DELETE" },
    ),
  notifications: () =>
    request<{ webhook_enabled: boolean; webhook_url: string; has_secret: boolean }>(
      "/api/v1/notifications",
    ),
  updateNotifications: (patch: {
    webhook_enabled?: boolean;
    webhook_url?: string;
    webhook_secret?: string;
  }) =>
    request<{ webhook_enabled: boolean; webhook_url: string; has_secret: boolean }>(
      "/api/v1/notifications",
      {
        method: "PUT",
        body: JSON.stringify(patch),
      },
    ),
  testNotification: () =>
    request<{ delivered: boolean; status: number | null; error: string | null }>(
      "/api/v1/notifications/test",
      { method: "POST" },
    ),
  exportReadingsUrl: (params: {
    sensorId: string;
    from?: string;
    to?: string;
    granularity: "raw" | "1m" | "1h";
    format: "csv" | "json";
  }) => {
    const qs = new URLSearchParams({
      sensor_id: params.sensorId,
      granularity: params.granularity,
      format: params.format,
    });
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    return `/api/v1/export/readings?${qs.toString()}`;
  },
  exportReportUrl: () => "/api/v1/export/report",
};
