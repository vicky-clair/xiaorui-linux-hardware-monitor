import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const hosts = sqliteTable("hosts", {
  hostId: text("host_id").primaryKey(),
  hostname: text("hostname").notNull(),
  osName: text("os_name").notNull(),
  osVersion: text("os_version").notNull(),
  kernelVersion: text("kernel_version").notNull(),
  architecture: text("architecture").notNull(),
  agentVersion: text("agent_version").notNull(),
  bootTime: text("boot_time"),
  uptimeSeconds: integer("uptime_seconds"),
  lastSeenAt: text("last_seen_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const devices = sqliteTable(
  "devices",
  {
    deviceId: text("device_id").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.hostId, { onDelete: "cascade" }),
    deviceType: text("device_type").notNull(),
    vendor: text("vendor").notNull(),
    model: text("model").notNull(),
    name: text("name").notNull(),
    capabilitiesJson: text("capabilities_json").notNull(),
    deviceStatus: text("device_status").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [index("idx_devices_host").on(t.hostId)],
);

export const deviceIdentities = sqliteTable("device_identities", {
  deviceId: text("device_id")
    .primaryKey()
    .references(() => devices.deviceId, { onDelete: "cascade" }),
  stable: integer("stable").notNull(),
  pciBusId: text("pci_bus_id"),
  pciVendorId: text("pci_vendor_id"),
  pciDeviceId: text("pci_device_id"),
  wwn: text("wwn"),
  serial: text("serial"),
  nvmeNguid: text("nvme_nguid"),
  driver: text("driver"),
  rawPath: text("raw_path"),
  topology: text("topology"),
  updatedAt: text("updated_at").notNull(),
});

export const sensors = sqliteTable(
  "sensors",
  {
    sensorId: text("sensor_id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.deviceId, { onDelete: "cascade" }),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.hostId, { onDelete: "cascade" }),
    sensorType: text("sensor_type").notNull(),
    sensorName: text("sensor_name").notNull(),
    source: text("source").notNull(),
    unit: text("unit").notNull(),
    capabilityStatus: text("capability_status").notNull(),
    enabled: integer("enabled").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_sensors_device").on(t.deviceId)],
);

export const sensorReadings = sqliteTable(
  "sensor_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostId: text("host_id").notNull(),
    deviceId: text("device_id").notNull(),
    sensorId: text("sensor_id")
      .notNull()
      .references(() => sensors.sensorId, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    value: real("value"),
    unit: text("unit").notNull(),
    quality: text("quality").notNull(),
    source: text("source").notNull(),
    collectedAt: text("collected_at").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (t) => [
    index("idx_sensor_readings_sensor_time").on(t.sensorId, t.collectedAt),
    index("idx_sensor_readings_collected_at").on(t.collectedAt),
  ],
);

export const sensorReadings1m = sqliteTable(
  "sensor_readings_1m",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sensorId: text("sensor_id")
      .notNull()
      .references(() => sensors.sensorId, { onDelete: "cascade" }),
    bucketStart: text("bucket_start").notNull(),
    minValue: real("min_value"),
    maxValue: real("max_value"),
    avgValue: real("avg_value"),
    sampleCount: integer("sample_count").notNull(),
    validCount: integer("valid_count").notNull(),
  },
  (t) => [
    uniqueIndex("uq_sensor_readings_1m_sensor_bucket").on(
      t.sensorId,
      t.bucketStart,
    ),
  ],
);

export const sensorReadings1h = sqliteTable(
  "sensor_readings_1h",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sensorId: text("sensor_id")
      .notNull()
      .references(() => sensors.sensorId, { onDelete: "cascade" }),
    bucketStart: text("bucket_start").notNull(),
    minValue: real("min_value"),
    maxValue: real("max_value"),
    avgValue: real("avg_value"),
    sampleCount: integer("sample_count").notNull(),
    validCount: integer("valid_count").notNull(),
  },
  (t) => [
    uniqueIndex("uq_sensor_readings_1h_sensor_bucket").on(
      t.sensorId,
      t.bucketStart,
    ),
  ],
);

export const smartDevices = sqliteTable(
  "smart_devices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostId: text("host_id").notNull(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.deviceId, { onDelete: "cascade" }),
    devicePath: text("device_path").notNull(),
    protocolType: text("protocol_type").notNull(),
    deviceStatus: text("device_status").notNull(),
    smartPassed: integer("smart_passed"),
    temperatureCelsius: real("temperature_celsius"),
    powerOnHours: text("power_on_hours"),
    powerCycles: text("power_cycles"),
    dataUnitsRead: text("data_units_read"),
    dataUnitsWritten: text("data_units_written"),
    percentageUsed: real("percentage_used"),
    availableSpare: real("available_spare"),
    criticalWarning: integer("critical_warning"),
    firmwareVersion: text("firmware_version"),
    serialNumber: text("serial_number"),
    rotationRateRpm: integer("rotation_rate_rpm"),
    sataLinkSpeed: text("sata_link_speed"),
    apmLevel: integer("apm_level"),
    writeCacheEnabled: integer("write_cache_enabled"),
    trimSupported: integer("trim_supported"),
    selfTestPassed: integer("self_test_passed"),
    selfTestLastStatus: text("self_test_last_status"),
    selfTestLastHours: text("self_test_last_hours"),
    errorLogCount: integer("error_log_count"),
    mediaErrors: text("media_errors"),
    numErrLogEntries: text("num_err_log_entries"),
    unsafeShutdowns: text("unsafe_shutdowns"),
    warningTempTimeMin: integer("warning_temp_time_min"),
    criticalCompTimeMin: integer("critical_comp_time_min"),
    temperatureSensorsJson: text("temperature_sensors_json"),
    collectedAt: text("collected_at").notNull(),
  },
  (t) => [index("idx_smart_devices_device_time").on(t.deviceId, t.collectedAt)],
);

export const smartAttributes = sqliteTable(
  "smart_attributes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    smartDeviceRowId: integer("smart_device_row_id")
      .notNull()
      .references(() => smartDevices.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    attrId: integer("attr_id").notNull(),
    name: text("name").notNull(),
    value: integer("value"),
    worst: integer("worst"),
    threshold: integer("threshold"),
    rawValue: text("raw_value").notNull(),
    rawString: text("raw_string"),
    collectedAt: text("collected_at").notNull(),
  },
  (t) => [index("idx_smart_attrs_row").on(t.smartDeviceRowId)],
);

export const collectorStatus = sqliteTable(
  "collector_status",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.hostId, { onDelete: "cascade" }),
    collectorName: text("collector_name").notNull(),
    status: text("status").notNull(),
    capabilityStatus: text("capability_status").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    lastRunAt: text("last_run_at"),
    lastSuccessAt: text("last_success_at"),
    consecutiveFailures: integer("consecutive_failures").notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_collector_status_host_name").on(t.hostId, t.collectorName),
  ],
);

export const ipcCursors = sqliteTable("ipc_cursors", {
  agentInstanceId: text("agent_instance_id").primaryKey(),
  hostId: text("host_id").notNull(),
  lastSequence: integer("last_sequence").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const healthEvents = sqliteTable(
  "health_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    diagnosticId: text("diagnostic_id").notNull(),
    hostId: text("host_id").notNull(),
    deviceId: text("device_id"),
    collectorName: text("collector_name"),
    level: text("level").notNull(),
    errorCode: text("error_code").notNull(),
    source: text("source").notNull(),
    message: text("message").notNull(),
    remediation: text("remediation"),
    detailsJson: text("details_json"),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [index("idx_health_events_time").on(t.occurredAt)],
);

export const analysisResults = sqliteTable(
  "analysis_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostId: text("host_id").notNull(),
    deviceId: text("device_id").notNull(),
    severity: text("severity").notNull(),
    score: real("score"),
    engineVersion: text("engine_version").notNull(),
    ruleVersion: text("rule_version").notNull(),
    thresholdSource: text("threshold_source").notNull(),
    factorsJson: text("factors_json").notNull(),
    analyzedAt: text("analyzed_at").notNull(),
  },
  (t) => [index("idx_analysis_device_time").on(t.deviceId, t.analyzedAt)],
);

export const alertRules = sqliteTable("alert_rules", {
  ruleId: text("rule_id").primaryKey(),
  metric: text("metric").notNull(),
  deviceType: text("device_type").notNull(),
  deviceId: text("device_id"),
  operator: text("operator").notNull(),
  threshold: real("threshold").notNull(),
  unit: text("unit").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  severity: text("severity").notNull(),
  enabled: integer("enabled").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const alertStates = sqliteTable("alert_states", {
  stateKey: text("state_key").primaryKey(),
  hostId: text("host_id").notNull(),
  deviceId: text("device_id").notNull(),
  ruleId: text("rule_id").notNull(),
  state: text("state").notNull(),
  pendingSince: text("pending_since"),
  firingSince: text("firing_since"),
  lastEvaluatedAt: text("last_evaluated_at").notNull(),
  payloadJson: text("payload_json"),
});

export const alertHistory = sqliteTable(
  "alert_history",
  {
    alertId: text("alert_id").primaryKey(),
    hostId: text("host_id").notNull(),
    deviceId: text("device_id").notNull(),
    ruleId: text("rule_id").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull(),
    summary: text("summary").notNull(),
    detailsJson: text("details_json"),
    triggeredAt: text("triggered_at").notNull(),
    acknowledgedAt: text("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),
    resolvedAt: text("resolved_at"),
  },
  (t) => [index("idx_alert_history_status").on(t.status, t.triggeredAt)],
);

export const appUsers = sqliteTable("app_users", {
  userId: text("user_id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  disabled: integer("disabled").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const appSessions = sqliteTable(
  "app_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => appUsers.userId, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [index("idx_sessions_expires").on(t.expiresAt)],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    ipAddress: text("ip_address").notNull(),
    succeeded: integer("succeeded").notNull(),
    attemptedAt: text("attempted_at").notNull(),
  },
  (t) => [index("idx_login_attempts_user_time").on(t.username, t.attemptedAt)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  isSensitive: integer("is_sensitive").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorUserId: text("actor_user_id"),
    actorUsername: text("actor_username").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    detailsJson: text("details_json"),
    ipAddress: text("ip_address"),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [index("idx_audit_logs_time").on(t.occurredAt)],
);
