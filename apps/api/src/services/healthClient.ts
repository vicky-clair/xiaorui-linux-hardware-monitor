/**
 * Haskell 无状态健康分析引擎 HTTP 客户端（ADR-0004）。
 * 组装设备/传感器最新读数、15 分钟历史窗口、告警规则与上一轮状态快照发送至 POST /v1/analyze；
 * 若引擎超时或不可达，严格降级为 severity="unknown"、score=null 并写入 HEALTH_ENGINE_UNAVAILABLE 诊断，绝不伪造正常。
 */
import {
  createProtocolValidator,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type DeviceStatus,
  type DeviceType,
  type ReadingQuality,
  type SensorReading,
  type Unit,
} from "@lhm/protocol";
import type { ApiConfig } from "../config/env.ts";
import type { AlertRepository } from "../repositories/alertRepo.ts";
import type { TelemetryRepository } from "../repositories/telemetryRepo.ts";
import type { RealtimeHub } from "../websocket/hub.ts";
import type { AlertNotifier } from "./notifier.ts";

export interface AnalysisRunOutcome {
  ok: boolean;
  degraded: boolean;
  reason?: string;
  analyzed_devices: number;
  transitions_count: number;
}

/**
 * Stateless client to the Haskell Health Engine (ADR-0004).
 * Never reports healthy/normal when the engine is unavailable or times out.
 */
export class HealthAnalysisService {
  private readonly validator = createProtocolValidator();

  constructor(
    private readonly config: ApiConfig,
    private readonly telemetryRepo: TelemetryRepository,
    private readonly alertRepo: AlertRepository,
    private readonly hub: RealtimeHub,
    private readonly notifier?: AlertNotifier,
  ) {}

  async runCycle(): Promise<AnalysisRunOutcome> {
    const hosts = this.telemetryRepo.listHosts();
    if (hosts.length === 0) {
      return { ok: true, degraded: false, analyzed_devices: 0, transitions_count: 0 };
    }

    const hostId = hosts[0]!.hostId;
    const devices = this.telemetryRepo.listDevices({ hostId });
    if (devices.length === 0) {
      return { ok: true, degraded: false, analyzed_devices: 0, transitions_count: 0 };
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const historyFrom = new Date(nowMs - 15 * 60_000).toISOString();
    const allSensors = this.telemetryRepo.listSensors();

    const latestReadings: SensorReading[] = [];
    const historyPoints: AnalyzeRequest["history_points"] = [];

    for (const sen of allSensors) {
      const q = this.telemetryRepo.querySensorReadings({
        sensorId: sen.sensorId,
        from: historyFrom,
        granularity: "raw",
        limit: 60,
      });
      const rawItems = q.items as Array<{
        hostId: string;
        deviceId: string;
        sensorId: string;
        metric: string;
        value: number | null;
        unit: Unit;
        quality: ReadingQuality;
        source: string;
        collectedAt: string;
      }>;
      if (rawItems.length === 0) continue;

      const newest = rawItems[0]!;
      const ageSec = (nowMs - Date.parse(newest.collectedAt)) / 1000;
      const effectiveQuality: ReadingQuality =
        newest.quality === "valid" && ageSec > this.config.staleAfterSeconds
          ? "stale"
          : newest.quality;

      latestReadings.push({
        schema_version: "1.0",
        host_id: newest.hostId,
        device_id: newest.deviceId,
        sensor_id: newest.sensorId,
        metric: newest.metric,
        value: newest.value,
        unit: newest.unit,
        quality: effectiveQuality,
        source: newest.source,
        collected_at: newest.collectedAt,
      });

      for (const item of rawItems.slice().reverse()) {
        historyPoints.push({
          device_id: item.deviceId,
          sensor_id: item.sensorId,
          metric: item.metric,
          value: item.value,
          quality: item.quality,
          collected_at: item.collectedAt,
        });
      }
    }

    const rules = this.alertRepo.listRules().map((r) => ({
      rule_id: r.rule_id,
      metric: r.metric,
      device_type: r.device_type,
      device_id: r.device_id ?? null,
      operator: r.operator,
      threshold: r.threshold,
      unit: r.unit,
      duration_seconds: r.duration_seconds,
      severity: r.severity,
      enabled: r.enabled,
    }));

    const reqBody: AnalyzeRequest = {
      schema_version: "1.1",
      host_id: hostId,
      evaluated_at: nowIso,
      rule_version: `rules-count-${rules.length}`,
      devices: devices.map((d) => ({
        device_id: d.deviceId,
        device_type: d.deviceType as DeviceType,
        device_status: d.deviceStatus as DeviceStatus,
      })),
      readings: latestReadings,
      history_points: historyPoints,
      rules,
      hardware_limits: [],
      prev_alert_states: this.alertRepo.listAlertStates(hostId),
    };

    try {
      const res = await fetch(`${this.config.healthEngineUrl}/v1/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(this.config.healthEngineTimeoutMs),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const parsed = (await res.json()) as unknown;
      const valid = this.validator.validate("analyze-response", parsed);
      if (!valid.valid) {
        throw new Error("AnalyzeResponse failed JSON Schema validation");
      }

      const response = parsed as AnalyzeResponse;
      this.alertRepo.applyAnalyzeResponse(response);

      for (const tr of response.alert_transitions) {
        this.hub.broadcast("alert", tr as unknown as Record<string, unknown>, {
          deviceId: tr.device_id,
        });
      }
      if (this.notifier && response.alert_transitions.length > 0) {
        void this.notifier.dispatchTransitions(response.alert_transitions);
      }

      return {
        ok: true,
        degraded: false,
        analyzed_devices: response.analysis_results.length,
        transitions_count: response.alert_transitions.length,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.alertRepo.recordDegradedAnalysis(
        hostId,
        devices.map((d) => d.deviceId),
        reason,
      );
      this.telemetryRepo.insertDiagnostic({
        diagnostic_id: `diag-${crypto.randomUUID()}`,
        host_id: hostId,
        device_id: null,
        collector_name: "health-engine",
        level: "warn",
        error_code: "HEALTH_ENGINE_UNAVAILABLE",
        source: "lhm-api",
        message: `Haskell health engine unavailable (${reason}); degraded analysis state to unknown`,
        remediation:
          "Check lhm-health-engine container/process health and LHM_HEALTH_ENGINE_URL",
        occurred_at: nowIso,
        details: { url: this.config.healthEngineUrl },
      });
      return {
        ok: false,
        degraded: true,
        reason,
        analyzed_devices: devices.length,
        transitions_count: 0,
      };
    }
  }
}
