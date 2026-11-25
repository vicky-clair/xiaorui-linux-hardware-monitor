// 硬件遥测核心仓储：负责 IPC 幂等去重游标、主机/设备/传感器入库、SMART 扩展字段与分区容量读取、覆盖率与时序查询。
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type {
  CollectorStatus,
  Device,
  Diagnostic,
  Host,
  Sensor,
  SensorReading,
  SmartReport,
} from "@lhm/protocol";
import type { DatabaseHandle } from "./db.ts";
import {
  collectorStatus,
  deviceIdentities,
  devices,
  healthEvents,
  hosts,
  ipcCursors,
  sensorReadings,
  sensorReadings1h,
  sensorReadings1m,
  sensors,
  smartAttributes,
  smartDevices,
} from "./schema.ts";

export interface ReadingQueryParams {
  sensorId: string;
  from?: string;
  to?: string;
  granularity?: "raw" | "1m" | "1h";
  limit?: number;
  cursor?: number;
}

export class TelemetryRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  /**
   * Checks `(agent_instance_id, sequence)` idempotency cursor (ADR-0003).
   * Returns `true` if the sequence is new and should be processed, `false` if duplicate.
   */
  isDuplicateSequence(agentInstanceId: string, sequence: number): boolean {
    const row = this.db
      .select({ lastSequence: ipcCursors.lastSequence })
      .from(ipcCursors)
      .where(eq(ipcCursors.agentInstanceId, agentInstanceId))
      .get();
    return row !== undefined && sequence <= row.lastSequence;
  }

  advanceCursor(agentInstanceId: string, hostId: string, sequence: number): void {
    const now = new Date().toISOString();
    this.db
      .insert(ipcCursors)
      .values({
        agentInstanceId,
        hostId,
        lastSequence: sequence,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: ipcCursors.agentInstanceId,
        set: {
          hostId,
          lastSequence: sql`CASE WHEN excluded.last_sequence > ${ipcCursors.lastSequence} THEN excluded.last_sequence ELSE ${ipcCursors.lastSequence} END`,
          updatedAt: now,
        },
      })
      .run();
  }

  upsertHost(host: Host): void {
    const now = new Date().toISOString();
    this.db
      .insert(hosts)
      .values({
        hostId: host.host_id,
        hostname: host.hostname,
        osName: host.os_name,
        osVersion: host.os_version,
        kernelVersion: host.kernel_version,
        architecture: host.architecture,
        agentVersion: host.agent_version,
        bootTime: host.boot_time ?? null,
        uptimeSeconds: host.uptime_seconds ?? null,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: hosts.hostId,
        set: {
          hostname: host.hostname,
          osName: host.os_name,
          osVersion: host.os_version,
          kernelVersion: host.kernel_version,
          architecture: host.architecture,
          agentVersion: host.agent_version,
          bootTime: host.boot_time ?? null,
          uptimeSeconds: host.uptime_seconds ?? null,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .run();
  }

  /** 原子事务记录 Agent 心跳并推进去重游标，防止异常中断导致 lastSeenAt 与游标分裂（M-4 修复） */
  recordHeartbeat(
    hostId: string,
    uptimeSeconds?: number,
    cursor?: { agentInstanceId: string; sequence: number },
  ): void {
    const tx = this.handle.sqlite.transaction(() => {
      this.touchHostHeartbeat(hostId, uptimeSeconds);
      if (cursor) {
        this.advanceCursor(cursor.agentInstanceId, hostId, cursor.sequence);
      }
    });
    tx();
  }

  /**
   * 检测长时间未上报心跳的主机并将其在线设备降级为 offline（M-3 修复，兼容 12 小时超低功耗模式）。
   * 仅降级 device_status = 'online' 的设备，绝不改动 'standby' 待机硬盘；
   * 仅在发生状态跃迁时写入一条去重的 AGENT_HEARTBEAT_TIMEOUT 诊断事件。
   */
  detectStaleHostsAndMarkOffline(
    staleAfterSeconds: number,
    nowMs: number = Date.now(),
  ): Array<{ hostId: string; deviceIds: string[] }> {
    const cutoffIso = new Date(nowMs - staleAfterSeconds * 1000).toISOString();
    const nowIso = new Date(nowMs).toISOString();
    const staleHosts = this.db
      .select({ hostId: hosts.hostId, hostname: hosts.hostname, lastSeenAt: hosts.lastSeenAt })
      .from(hosts)
      .where(lte(hosts.lastSeenAt, cutoffIso))
      .all();

    if (staleHosts.length === 0) return [];

    const transitioned: Array<{ hostId: string; deviceIds: string[] }> = [];
    const tx = this.handle.sqlite.transaction(() => {
      for (const h of staleHosts) {
        const onlineDevs = this.db
          .select({ deviceId: devices.deviceId })
          .from(devices)
          .where(and(eq(devices.hostId, h.hostId), eq(devices.deviceStatus, "online")))
          .all();
        if (onlineDevs.length === 0) continue;

        this.db
          .update(devices)
          .set({ deviceStatus: "offline" })
          .where(and(eq(devices.hostId, h.hostId), eq(devices.deviceStatus, "online")))
          .run();

        this.db
          .insert(healthEvents)
          .values({
            diagnosticId: `diag-hb-timeout-${crypto.randomUUID().slice(0, 8)}`,
            hostId: h.hostId,
            deviceId: null,
            collectorName: "ipc",
            level: "warn",
            errorCode: "AGENT_HEARTBEAT_TIMEOUT",
            source: "api-heartbeat-monitor",
            message: `Agent on host '${h.hostname}' has not reported since ${h.lastSeenAt} (threshold ${staleAfterSeconds}s); marked ${onlineDevs.length} online device(s) offline`,
            remediation:
              "Check lhm-agent.service status and /run/linux-hardware-monitor/ipc.sock connectivity",
            detailsJson: JSON.stringify({
              last_seen_at: h.lastSeenAt,
              stale_after_seconds: staleAfterSeconds,
              affected_devices: onlineDevs.length,
            }),
            occurredAt: nowIso,
          })
          .run();

        transitioned.push({
          hostId: h.hostId,
          deviceIds: onlineDevs.map((d) => d.deviceId),
        });
      }
    });
    tx();
    return transitioned;
  }

  touchHostHeartbeat(hostId: string, uptimeSeconds?: number): void {
    const now = new Date().toISOString();
    this.db
      .update(hosts)
      .set({
        lastSeenAt: now,
        updatedAt: now,
        ...(uptimeSeconds !== undefined ? { uptimeSeconds } : {}),
      })
      .where(eq(hosts.hostId, hostId))
      .run();
  }

  upsertInventory(
    hostId: string,
    devList: Device[],
    senList: Sensor[],
    cursor?: { agentInstanceId: string; sequence: number },
  ): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      // Ensure host row exists even if inventory arrives before/independently in tests
      this.ensureHostPlaceholder(hostId, now);

      for (const d of devList) {
        this.db
          .insert(devices)
          .values({
            deviceId: d.device_id,
            hostId: d.host_id,
            deviceType: d.device_type,
            vendor: d.vendor,
            model: d.model,
            name: d.name,
            capabilitiesJson: JSON.stringify(d.capabilities),
            deviceStatus: d.device_status,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .onConflictDoUpdate({
            target: devices.deviceId,
            set: {
              deviceType: d.device_type,
              vendor: d.vendor,
              model: d.model,
              name: d.name,
              capabilitiesJson: JSON.stringify(d.capabilities),
              deviceStatus: d.device_status,
              lastSeenAt: now,
            },
          })
          .run();

        this.db
          .insert(deviceIdentities)
          .values({
            deviceId: d.device_id,
            stable: d.identity.stable ? 1 : 0,
            pciBusId: d.identity.pci_bus_id ?? null,
            pciVendorId: d.identity.pci_vendor_id ?? null,
            pciDeviceId: d.identity.pci_device_id ?? null,
            wwn: d.identity.wwn ?? null,
            serial: d.identity.serial ?? null,
            nvmeNguid: d.identity.nvme_nguid ?? null,
            driver: d.identity.driver ?? null,
            rawPath: d.identity.raw_path ?? null,
            topology: d.identity.topology ?? null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: deviceIdentities.deviceId,
            set: {
              stable: d.identity.stable ? 1 : 0,
              pciBusId: d.identity.pci_bus_id ?? null,
              pciVendorId: d.identity.pci_vendor_id ?? null,
              pciDeviceId: d.identity.pci_device_id ?? null,
              wwn: d.identity.wwn ?? null,
              serial: d.identity.serial ?? null,
              nvmeNguid: d.identity.nvme_nguid ?? null,
              driver: d.identity.driver ?? null,
              rawPath: d.identity.raw_path ?? null,
              topology: d.identity.topology ?? null,
              updatedAt: now,
            },
          })
          .run();
      }

      for (const s of senList) {
        this.db
          .insert(sensors)
          .values({
            sensorId: s.sensor_id,
            deviceId: s.device_id,
            hostId,
            sensorType: s.sensor_type,
            sensorName: s.sensor_name,
            source: s.source,
            unit: s.unit,
            capabilityStatus: s.capability_status,
            enabled: s.enabled ? 1 : 0,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: sensors.sensorId,
            set: {
              sensorType: s.sensor_type,
              sensorName: s.sensor_name,
              source: s.source,
              unit: s.unit,
              capabilityStatus: s.capability_status,
              enabled: s.enabled ? 1 : 0,
              updatedAt: now,
            },
          })
          .run();
      }

      if (cursor) {
        this.advanceCursor(cursor.agentInstanceId, hostId, cursor.sequence);
      }
    });
    tx();
  }

  insertReadingsBatch(
    hostId: string,
    readings: SensorReading[],
    cursor?: { agentInstanceId: string; sequence: number },
  ): number {
    if (readings.length === 0) {
      if (cursor) {
        this.advanceCursor(cursor.agentInstanceId, hostId, cursor.sequence);
      }
      return 0;
    }
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      this.ensureHostPlaceholder(hostId, now);
      let inserted = 0;
      for (const r of readings) {
        // Ensure referenced device/sensor exist so FK constraints remain valid even on partial streams
        const sensorRow = this.db
          .select({ id: sensors.sensorId })
          .from(sensors)
          .where(eq(sensors.sensorId, r.sensor_id))
          .get();
        if (!sensorRow) {
          this.ensureDeviceAndSensorPlaceholder(r, now);
        }
        this.db
          .insert(sensorReadings)
          .values({
            hostId: r.host_id,
            deviceId: r.device_id,
            sensorId: r.sensor_id,
            metric: r.metric,
            value: r.value,
            unit: r.unit,
            quality: r.quality,
            source: r.source,
            collectedAt: r.collected_at,
            receivedAt: now,
          })
          .run();
        inserted += 1;
      }
      if (cursor) {
        this.advanceCursor(cursor.agentInstanceId, hostId, cursor.sequence);
      }
      return inserted;
    });
    return tx();
  }

  insertSmartReport(
    report: SmartReport,
    cursor?: { agentInstanceId: string; sequence: number },
  ): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      this.ensureHostPlaceholder(report.host_id, now);
      const dev = this.db
        .select({ id: devices.deviceId })
        .from(devices)
        .where(eq(devices.deviceId, report.device_id))
        .get();
      if (!dev) {
        this.db
          .insert(devices)
          .values({
            deviceId: report.device_id,
            hostId: report.host_id,
            deviceType: "storage",
            vendor: "unknown",
            model: report.device_path,
            name: report.device_path,
            capabilitiesJson: JSON.stringify(["smart"]),
            deviceStatus: report.device_status,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .run();
      } else {
        this.db
          .update(devices)
          .set({ deviceStatus: report.device_status, lastSeenAt: now })
          .where(eq(devices.deviceId, report.device_id))
          .run();
      }

      const inserted = this.db
        .insert(smartDevices)
        .values({
          hostId: report.host_id,
          deviceId: report.device_id,
          devicePath: report.device_path,
          protocolType: report.protocol_type,
          deviceStatus: report.device_status,
          smartPassed:
            report.smart_passed === null || report.smart_passed === undefined
              ? null
              : report.smart_passed
                ? 1
                : 0,
          temperatureCelsius: report.temperature_celsius ?? null,
          powerOnHours: report.power_on_hours ?? null,
          powerCycles: report.power_cycles ?? null,
          dataUnitsRead: report.data_units_read ?? null,
          dataUnitsWritten: report.data_units_written ?? null,
          percentageUsed: report.percentage_used ?? null,
          availableSpare: report.available_spare ?? null,
          criticalWarning: report.critical_warning ?? null,
          firmwareVersion: report.firmware_version ?? null,
          serialNumber: report.serial_number ?? null,
          rotationRateRpm: report.rotation_rate_rpm ?? null,
          sataLinkSpeed: report.sata_link_speed ?? null,
          apmLevel: report.apm_level ?? null,
          writeCacheEnabled:
            report.write_cache_enabled === null || report.write_cache_enabled === undefined
              ? null
              : report.write_cache_enabled
                ? 1
                : 0,
          trimSupported:
            report.trim_supported === null || report.trim_supported === undefined
              ? null
              : report.trim_supported
                ? 1
                : 0,
          selfTestPassed:
            report.self_test_passed === null || report.self_test_passed === undefined
              ? null
              : report.self_test_passed
                ? 1
                : 0,
          selfTestLastStatus: report.self_test_last_status ?? null,
          selfTestLastHours: report.self_test_last_hours ?? null,
          errorLogCount: report.error_log_count ?? null,
          mediaErrors: report.media_errors ?? null,
          numErrLogEntries: report.num_err_log_entries ?? null,
          unsafeShutdowns: report.unsafe_shutdowns ?? null,
          warningTempTimeMin: report.warning_temp_time_min ?? null,
          criticalCompTimeMin: report.critical_comp_time_min ?? null,
          temperatureSensorsJson:
            report.temperature_sensors_celsius && report.temperature_sensors_celsius.length > 0
              ? JSON.stringify(report.temperature_sensors_celsius)
              : null,
          collectedAt: report.collected_at,
        })
        .returning({ id: smartDevices.id })
        .get();

      for (const attr of report.attributes) {
        this.db
          .insert(smartAttributes)
          .values({
            smartDeviceRowId: inserted.id,
            deviceId: report.device_id,
            attrId: attr.id,
            name: attr.name,
            value: attr.value ?? null,
            worst: attr.worst ?? null,
            threshold: attr.threshold ?? null,
            rawValue: attr.raw_value,
            rawString: attr.raw_string ?? null,
            collectedAt: report.collected_at,
          })
          .run();
      }

      if (cursor) {
        this.advanceCursor(
          cursor.agentInstanceId,
          report.host_id,
          cursor.sequence,
        );
      }
    });
    tx();
  }

  upsertCollectorStatuses(
    hostId: string,
    list: CollectorStatus[],
    cursor?: { agentInstanceId: string; sequence: number },
  ): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      this.ensureHostPlaceholder(hostId, now);
      for (const c of list) {
        this.db
          .insert(collectorStatus)
          .values({
            hostId: c.host_id,
            collectorName: c.collector_name,
            status: c.status,
            capabilityStatus: c.capability_status,
            intervalSeconds: c.interval_seconds,
            lastRunAt: c.last_run_at ?? null,
            lastSuccessAt: c.last_success_at ?? null,
            consecutiveFailures: c.consecutive_failures,
            lastErrorCode: c.last_error_code ?? null,
            lastErrorMessage: c.last_error_message ?? null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [collectorStatus.hostId, collectorStatus.collectorName],
            set: {
              status: c.status,
              capabilityStatus: c.capability_status,
              intervalSeconds: c.interval_seconds,
              lastRunAt: c.last_run_at ?? null,
              lastSuccessAt: c.last_success_at ?? null,
              consecutiveFailures: c.consecutive_failures,
              lastErrorCode: c.last_error_code ?? null,
              lastErrorMessage: c.last_error_message ?? null,
              updatedAt: now,
            },
          })
          .run();
      }
      if (cursor) {
        this.advanceCursor(cursor.agentInstanceId, hostId, cursor.sequence);
      }
    });
    tx();
  }

  insertDiagnostic(
    diag: Diagnostic,
    cursor?: { agentInstanceId: string; sequence: number },
  ): void {
    const tx = this.handle.sqlite.transaction(() => {
      this.db
        .insert(healthEvents)
        .values({
          diagnosticId: diag.diagnostic_id,
          hostId: diag.host_id,
          deviceId: diag.device_id ?? null,
          collectorName: diag.collector_name ?? null,
          level: diag.level,
          errorCode: diag.error_code,
          source: diag.source,
          message: diag.message,
          remediation: diag.remediation ?? null,
          detailsJson: diag.details ? JSON.stringify(diag.details) : null,
          occurredAt: diag.occurred_at,
        })
        .run();
      if (cursor) {
        this.advanceCursor(
          cursor.agentInstanceId,
          diag.host_id,
          cursor.sequence,
        );
      }
    });
    tx();
  }

  private ensureHostPlaceholder(hostId: string, now: string): void {
    this.db
      .insert(hosts)
      .values({
        hostId,
        hostname: hostId,
        osName: "Linux",
        osVersion: "unknown",
        kernelVersion: "unknown",
        architecture: "unknown",
        agentVersion: "unknown",
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  private ensureDeviceAndSensorPlaceholder(r: SensorReading, now: string): void {
    this.db
      .insert(devices)
      .values({
        deviceId: r.device_id,
        hostId: r.host_id,
        deviceType: "other",
        vendor: "unknown",
        model: "unknown",
        name: r.device_id,
        capabilitiesJson: "[]",
        deviceStatus: "online",
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoNothing()
      .run();

    this.db
      .insert(sensors)
      .values({
        sensorId: r.sensor_id,
        deviceId: r.device_id,
        hostId: r.host_id,
        sensorType: "other",
        sensorName: r.metric,
        source: r.source,
        unit: r.unit,
        capabilityStatus: "supported",
        enabled: 1,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  // ---- Read queries ----

  listHosts() {
    return this.db.select().from(hosts).all();
  }

  listDevices(filters?: { hostId?: string; deviceType?: string; limit?: number }) {
    const conds = [];
    if (filters?.hostId) conds.push(eq(devices.hostId, filters.hostId));
    if (filters?.deviceType) conds.push(eq(devices.deviceType, filters.deviceType));
    const q = this.db
      .select()
      .from(devices)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .limit(Math.min(filters?.limit ?? 200, 500));
    return q.all().map((d) => ({
      ...d,
      capabilities: JSON.parse(d.capabilitiesJson) as string[],
    }));
  }

  getDeviceDetail(deviceId: string) {
    const dev = this.db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, deviceId))
      .get();
    if (!dev) return null;
    const identity = this.db
      .select()
      .from(deviceIdentities)
      .where(eq(deviceIdentities.deviceId, deviceId))
      .get();
    const devSensors = this.db
      .select()
      .from(sensors)
      .where(eq(sensors.deviceId, deviceId))
      .all();
    return {
      ...dev,
      capabilities: JSON.parse(dev.capabilitiesJson) as string[],
      identity: identity ? { ...identity, stable: identity.stable === 1 } : null,
      sensors: devSensors.map((s) => ({ ...s, enabled: s.enabled === 1 })),
    };
  }

  listSensors(filters?: { deviceId?: string; sensorType?: string; limit?: number }) {
    const conds = [];
    if (filters?.deviceId) conds.push(eq(sensors.deviceId, filters.deviceId));
    if (filters?.sensorType) conds.push(eq(sensors.sensorType, filters.sensorType));
    return this.db
      .select()
      .from(sensors)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .limit(Math.min(filters?.limit ?? 500, 1000))
      .all()
      .map((s) => ({ ...s, enabled: s.enabled === 1 }));
  }

  getSensor(sensorId: string) {
    return this.db
      .select()
      .from(sensors)
      .where(eq(sensors.sensorId, sensorId))
      .get();
  }

  querySensorReadings(params: ReadingQueryParams) {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 2000);
    const granularity = params.granularity ?? "raw";

    if (granularity === "1m" || granularity === "1h") {
      const table = granularity === "1m" ? sensorReadings1m : sensorReadings1h;
      const conds = [eq(table.sensorId, params.sensorId)];
      if (params.from) conds.push(gte(table.bucketStart, params.from));
      if (params.to) conds.push(lte(table.bucketStart, params.to));
      const items = this.db
        .select()
        .from(table)
        .where(and(...conds))
        .orderBy(desc(table.bucketStart))
        .limit(limit)
        .all();
      return { granularity, items, next_cursor: null };
    }

    const conds = [eq(sensorReadings.sensorId, params.sensorId)];
    if (params.from) conds.push(gte(sensorReadings.collectedAt, params.from));
    if (params.to) conds.push(lte(sensorReadings.collectedAt, params.to));
    if (params.cursor !== undefined) {
      conds.push(lte(sensorReadings.id, params.cursor));
    }

    const rows = this.db
      .select()
      .from(sensorReadings)
      .where(and(...conds))
      .orderBy(desc(sensorReadings.collectedAt), desc(sensorReadings.id))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (rows[limit]?.id ?? null) : null;
    return { granularity: "raw", items, next_cursor: nextCursor };
  }

  /**
   * Computes sensor coverage and marks readings older than `staleAfterSeconds` as `stale`
   * (docs/protocol/data-model.md §2: `stale` is determined by Bun, never self-reported by Agent).
   */
  getCoverage(staleAfterSeconds: number, nowMs: number = Date.now()) {
    const allDevices = this.db.select().from(devices).all();
    const allSensors = this.db.select().from(sensors).all();
    const latestStmt = this.handle.sqlite.query(`
      SELECT sr.sensor_id, sr.value, sr.quality, sr.collected_at
      FROM sensor_readings sr
      INNER JOIN (
        SELECT sensor_id, MAX(id) AS max_id
        FROM sensor_readings
        GROUP BY sensor_id
      ) latest ON sr.id = latest.max_id
    `);
    const latestRows = latestStmt.all() as Array<{
      sensor_id: string;
      value: number | null;
      quality: string;
      collected_at: string;
    }>;
    const latestMap = new Map(latestRows.map((r) => [r.sensor_id, r]));

    const devicesCoverage = allDevices.map((dev) => {
      const devSensors = allSensors.filter((s) => s.deviceId === dev.deviceId);
      const supported: string[] = [];
      const unsupported: string[] = [];
      const permissionDenied: string[] = [];
      const unavailable: string[] = [];
      const stale: string[] = [];
      let hasTempCap = false;
      let tempReadOk = false;
      let lastSuccessAt: string | null = null;

      for (const s of devSensors) {
        if (s.sensorType === "temperature" && s.capabilityStatus === "supported") {
          hasTempCap = true;
        }
        switch (s.capabilityStatus) {
          case "supported":
            supported.push(s.sensorName);
            break;
          case "unsupported":
            unsupported.push(s.sensorName);
            break;
          case "permission_denied":
            permissionDenied.push(s.sensorName);
            break;
          default:
            unavailable.push(s.sensorName);
            break;
        }
        const latest = latestMap.get(s.sensorId);
        if (latest) {
          const ageSec = (nowMs - Date.parse(latest.collected_at)) / 1000;
          const effectiveQuality =
            latest.quality === "valid" && ageSec > staleAfterSeconds
              ? "stale"
              : latest.quality;
          if (effectiveQuality === "stale") {
            stale.push(s.sensorName);
          } else if (effectiveQuality === "valid") {
            if (s.sensorType === "temperature") tempReadOk = true;
            if (!lastSuccessAt || latest.collected_at > lastSuccessAt) {
              lastSuccessAt = latest.collected_at;
            }
          }
        }
      }

      return {
        device_id: dev.deviceId,
        device_name: dev.name,
        device_status: dev.deviceStatus,
        discovered: true,
        has_temperature_capability: hasTempCap,
        temperature_read_ok: tempReadOk,
        supported_metrics: supported,
        unsupported_metrics: unsupported,
        permission_denied_metrics: permissionDenied,
        unavailable_metrics: unavailable,
        stale_metrics: stale,
        last_success_at: lastSuccessAt,
      };
    });

    return {
      total_devices: allDevices.length,
      total_sensors: allSensors.length,
      stale_after_seconds: staleAfterSeconds,
      devices: devicesCoverage,
    };
  }

  private formatSmartRow(row: typeof smartDevices.$inferSelect) {
    let temperatureSensorsCelsius: number[] | null = null;
    if (row.temperatureSensorsJson) {
      try {
        const parsed = JSON.parse(row.temperatureSensorsJson);
        if (Array.isArray(parsed)) {
          temperatureSensorsCelsius = parsed.filter((v): v is number => typeof v === "number");
        }
      } catch {
        temperatureSensorsCelsius = null;
      }
    }
    return {
      ...row,
      smartPassed: row.smartPassed === null ? null : row.smartPassed === 1,
      writeCacheEnabled:
        row.writeCacheEnabled === null ? null : row.writeCacheEnabled === 1,
      trimSupported: row.trimSupported === null ? null : row.trimSupported === 1,
      selfTestPassed: row.selfTestPassed === null ? null : row.selfTestPassed === 1,
      temperatureSensorsCelsius,
    };
  }

  private getMountsForDevice(deviceId: string) {
    const devSensors = this.db
      .select()
      .from(sensors)
      .where(and(eq(sensors.deviceId, deviceId), eq(sensors.source, "df")))
      .all();
    if (devSensors.length === 0) return [];

    const byMount = new Map<
      string,
      {
        mountpoint: string;
        fstype: string | null;
        usagePercent: number | null;
        usedBytes: number | null;
        availBytes: number | null;
        totalBytes: number | null;
        collectedAt: string | null;
      }
    >();

    for (const s of devSensors) {
      const latest = this.db
        .select({
          value: sensorReadings.value,
          quality: sensorReadings.quality,
          collectedAt: sensorReadings.collectedAt,
        })
        .from(sensorReadings)
        .where(eq(sensorReadings.sensorId, s.sensorId))
        .orderBy(desc(sensorReadings.id))
        .limit(1)
        .get();
      const usageMatch = /^Mount (.+) Usage \(([^)]+)\)$/.exec(s.sensorName);
      const simpleMatch = /^Mount (.+) (Used|Available|Total)$/.exec(s.sensorName);
      const mountpoint = usageMatch?.[1] ?? simpleMatch?.[1];
      if (!mountpoint) continue;

      const entry = byMount.get(mountpoint) ?? {
        mountpoint,
        fstype: null,
        usagePercent: null,
        usedBytes: null,
        availBytes: null,
        totalBytes: null,
        collectedAt: null,
      };
      if (usageMatch) {
        entry.fstype = usageMatch[2] ?? null;
        entry.usagePercent = latest?.quality === "valid" ? latest.value : null;
      } else if (simpleMatch?.[2] === "Used") {
        entry.usedBytes = latest?.quality === "valid" ? latest.value : null;
      } else if (simpleMatch?.[2] === "Available") {
        entry.availBytes = latest?.quality === "valid" ? latest.value : null;
      } else if (simpleMatch?.[2] === "Total") {
        entry.totalBytes = latest?.quality === "valid" ? latest.value : null;
      }
      if (latest?.collectedAt && (!entry.collectedAt || latest.collectedAt > entry.collectedAt)) {
        entry.collectedAt = latest.collectedAt;
      }
      byMount.set(mountpoint, entry);
    }
    return Array.from(byMount.values()).sort((a, b) => a.mountpoint.localeCompare(b.mountpoint));
  }

  listStorage() {
    const storageDevs = this.listDevices({ deviceType: "storage" });
    return storageDevs.map((dev) => {
      const latestSmart = this.db
        .select()
        .from(smartDevices)
        .where(eq(smartDevices.deviceId, dev.deviceId))
        .orderBy(desc(smartDevices.collectedAt), desc(smartDevices.id))
        .limit(1)
        .get();
      return {
        device: dev,
        latest_smart: latestSmart ? this.formatSmartRow(latestSmart) : null,
        mounts: this.getMountsForDevice(dev.deviceId),
      };
    });
  }

  getStorageSmart(deviceId: string, limit: number = 30) {
    const dev = this.db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, deviceId))
      .get();
    if (!dev) return null;

    const history = this.db
      .select()
      .from(smartDevices)
      .where(eq(smartDevices.deviceId, deviceId))
      .orderBy(desc(smartDevices.collectedAt), desc(smartDevices.id))
      .limit(Math.min(limit, 200))
      .all();

    const latestRow = history[0];
    const attrs = latestRow
      ? this.db
          .select()
          .from(smartAttributes)
          .where(eq(smartAttributes.smartDeviceRowId, latestRow.id))
          .all()
      : [];

    return {
      device: {
        ...dev,
        capabilities: JSON.parse(dev.capabilitiesJson) as string[],
      },
      latest: latestRow
        ? {
            ...this.formatSmartRow(latestRow),
            attributes: attrs,
          }
        : null,
      history: history.map((h) => this.formatSmartRow(h)),
    };
  }

  listCollectors() {
    return this.db.select().from(collectorStatus).all();
  }

  listDiagnostics(limit: number = 100) {
    return this.db
      .select()
      .from(healthEvents)
      .orderBy(desc(healthEvents.occurredAt), desc(healthEvents.id))
      .limit(Math.min(limit, 500))
      .all()
      .map((e) => ({
        ...e,
        details: e.detailsJson ? (JSON.parse(e.detailsJson) as unknown) : null,
      }));
  }

  getSystemOverview(staleAfterSeconds: number) {
    const hostList = this.listHosts();
    const devList = this.listDevices();
    const collectors = this.listCollectors();
    const recentDiagnostics = this.listDiagnostics(10);
    const coverage = this.getCoverage(staleAfterSeconds);
    return {
      hosts: hostList,
      device_count: devList.length,
      sensor_count: coverage.total_sensors,
      collectors,
      recent_diagnostics: recentDiagnostics,
      coverage_summary: {
        devices_with_stale: coverage.devices.filter((d) => d.stale_metrics.length > 0)
          .length,
        devices_with_permission_denied: coverage.devices.filter(
          (d) => d.permission_denied_metrics.length > 0,
        ).length,
      },
    };
  }
}
