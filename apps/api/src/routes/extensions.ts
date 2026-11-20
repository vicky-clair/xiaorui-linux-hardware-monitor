/**
 * 阶段 6 扩展 API 路由：
 * - GET /api/v1/export/readings ：安全导出单传感器 CSV/JSON（硬上限 10,000 行，CSV 防公式注入，null 不补零）
 * - GET /api/v1/export/report   ：导出脱敏系统健康与诊断报告（严格剔除用户凭据、会话与敏感配置）
 * - GET/PUT /api/v1/notifications & POST /api/v1/notifications/test ：Webhook 通知配置与签名测试
 */
import { Elysia } from "elysia";
import type { AuthService } from "../auth/service.ts";
import type { ApiConfig } from "../config/env.ts";
import { errorResponse, okResponse } from "../middleware/envelope.ts";
import { triggerAgentScan } from "../ipc/agentControl.ts";
import type { AggregationRepository } from "../repositories/aggregationRepo.ts";
import type { AlertRepository } from "../repositories/alertRepo.ts";
import type { AuthRepository } from "../repositories/authRepo.ts";
import type { TelemetryRepository } from "../repositories/telemetryRepo.ts";
import type { HealthAnalysisService } from "../services/healthClient.ts";
import type { AlertNotifier } from "../services/notifier.ts";

const MAX_EXPORT_ROWS = 10_000;

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
  );
}

/**
 * Escapes CSV values per RFC 4180 and neutralizes spreadsheet formula injection (=, +, -, @, tab, CR).
 * Preserves null/undefined as empty string — NEVER converts missing values to 0.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function createExtensionRoutes(deps: {
  config: ApiConfig;
  authService: AuthService;
  authRepo: AuthRepository;
  telemetryRepo: TelemetryRepository;
  aggregationRepo: AggregationRepository;
  alertRepo: AlertRepository;
  healthService: HealthAnalysisService;
  notifier: AlertNotifier;
}) {
  const {
    config,
    authService,
    authRepo,
    telemetryRepo,
    aggregationRepo,
    alertRepo,
    healthService,
    notifier,
  } = deps;
  let lastManualCheckMs = 0;

  return new Elysia({ prefix: "/api/v1" })
    // ---- 手动触发全局硬件采集 + 聚合 + Haskell 健康分析（管理员，10 秒冷却） ----
    .post("/system/check", async ({ request, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }

      const nowMs = Date.now();
      if (nowMs - lastManualCheckMs < 10_000) {
        set.status = 429;
        return errorResponse(
          "RATE_LIMITED",
          "Please wait at least 10 seconds between manual global health checks",
        );
      }
      lastManualCheckMs = nowMs;

      // 1. 唤醒宿主机 Rust Agent 执行一次完整实时硬件采集与 SMART/RAPL 读取
      const agentScan = await triggerAgentScan(config.agentCtrlSocketPath, 15_000);

      // 2. 立即更新 1 分钟/1 小时聚合桶
      const afterMs = Date.now();
      const toNow = new Date(afterMs + 1000).toISOString();
      try {
        aggregationRepo.aggregate1m(new Date(afterMs - 5 * 60_000).toISOString(), toNow);
        aggregationRepo.aggregate1h(new Date(afterMs - 2 * 3_600_000).toISOString(), toNow);
      } catch {
        // aggregation errors are non-fatal for analysis
      }

      // 3. 调用 Haskell 健康引擎完成全局评估与告警状态推进
      const outcome = await healthService.runCycle();
      const latest = alertRepo.listLatestAnalysis(100);
      const severityCounts = { normal: 0, warning: 0, critical: 0, unknown: 0 };
      for (const r of latest) {
        if (r.severity in severityCounts) {
          severityCounts[r.severity as keyof typeof severityCounts] += 1;
        }
      }

      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "MANUAL_GLOBAL_HEALTH_CHECK",
        targetType: "system",
        details: {
          agent_collected: agentScan.triggered,
          agent_note: agentScan.reason,
          analyzed_devices: outcome.analyzed_devices,
          degraded: outcome.degraded,
        },
        ipAddress: clientIp(request),
      });

      return okResponse({
        agent_collected: agentScan.triggered,
        agent_note: agentScan.reason,
        analysis_ok: outcome.ok,
        degraded: outcome.degraded,
        analyzed_devices: outcome.analyzed_devices,
        transitions_count: outcome.transitions_count,
        severity_counts: severityCounts,
        checked_at: new Date().toISOString(),
      });
    })
    // ---- Phase 6: Safe Data Export (CSV / JSON) ----
    .get("/export/readings", ({ request, query, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const sensorId = String(query.sensor_id ?? "").trim();
      if (!sensorId) {
        set.status = 400;
        return errorResponse("VALIDATION_ERROR", "Query parameter 'sensor_id' is required");
      }
      const sensor = telemetryRepo.getSensor(sensorId);
      if (!sensor) {
        set.status = 404;
        return errorResponse("SENSOR_NOT_FOUND", `Sensor '${sensorId}' not found`);
      }

      const g = query.granularity;
      const granularity = g === "1m" || g === "1h" ? g : "raw";
      const format = query.format === "json" ? "json" : "csv";
      const requestedLimit = query.limit ? Number(query.limit) : 2000;
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_EXPORT_ROWS)
        : 2000;

      const result = telemetryRepo.querySensorReadings({
        sensorId,
        from: query.from,
        to: query.to,
        granularity,
        limit,
      });

      const safeFilename = sensorId.replace(/[^a-zA-Z0-9._-]/g, "_");
      if (format === "json") {
        set.headers["content-type"] = "application/json; charset=utf-8";
        set.headers["content-disposition"] =
          `attachment; filename="lhm-${safeFilename}-${granularity}.json"`;
        set.headers["x-content-type-options"] = "nosniff";
        return JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            sensor_id: sensor.sensorId,
            device_id: sensor.deviceId,
            unit: sensor.unit,
            granularity,
            count: result.items.length,
            items: result.items,
          },
          null,
          2,
        );
      }

      const lines: string[] = [];
      if (granularity === "raw") {
        lines.push("collected_at,sensor_id,device_id,metric,value,unit,quality,source");
        for (const item of result.items as Array<{
          collectedAt: string;
          sensorId: string;
          deviceId: string;
          metric: string;
          value: number | null;
          unit: string;
          quality: string;
          source: string;
        }>) {
          lines.push(
            [
              item.collectedAt,
              item.sensorId,
              item.deviceId,
              item.metric,
              item.value,
              item.unit,
              item.quality,
              item.source,
            ]
              .map(escapeCsvCell)
              .join(","),
          );
        }
      } else {
        lines.push(
          "bucket_start,sensor_id,min_value,max_value,avg_value,sample_count,valid_count",
        );
        for (const item of result.items as Array<{
          bucketStart: string;
          sensorId: string;
          minValue: number | null;
          maxValue: number | null;
          avgValue: number | null;
          sampleCount: number;
          validCount: number;
        }>) {
          lines.push(
            [
              item.bucketStart,
              item.sensorId,
              item.minValue,
              item.maxValue,
              item.avgValue,
              item.sampleCount,
              item.validCount,
            ]
              .map(escapeCsvCell)
              .join(","),
          );
        }
      }

      set.headers["content-type"] = "text/csv; charset=utf-8";
      set.headers["content-disposition"] =
        `attachment; filename="lhm-${safeFilename}-${granularity}.csv"`;
      set.headers["x-content-type-options"] = "nosniff";
      return `${lines.join("\n")}\n`;
    })
    .get("/export/report", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      // Sanitized snapshot report: strictly excludes users, sessions, password hashes, and sensitive settings
      const report = {
        exported_at: new Date().toISOString(),
        hosts: telemetryRepo.listHosts(),
        devices: telemetryRepo.listDevices(),
        sensors: telemetryRepo.listSensors(),
        coverage: telemetryRepo.getCoverage(config.staleAfterSeconds),
        collectors: telemetryRepo.listCollectors(),
        latest_analysis: alertRepo.listLatestAnalysis(100),
        alerts: alertRepo.listAlerts({ limit: 100 }),
        recent_diagnostics: telemetryRepo.listDiagnostics(100),
      };
      set.headers["content-type"] = "application/json; charset=utf-8";
      set.headers["content-disposition"] =
        `attachment; filename="lhm-health-report-${new Date().toISOString().slice(0, 10)}.json"`;
      set.headers["x-content-type-options"] = "nosniff";
      return JSON.stringify(report, null, 2);
    })
    // ---- Phase 6: Alert Webhook Notifications ----
    .get("/notifications", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse(notifier.getPublicConfig());
    })
    .put("/notifications", ({ request, body, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      const b = (body ?? {}) as Record<string, unknown>;
      try {
        const updated = notifier.saveConfig(
          {
            webhook_enabled:
              b.webhook_enabled !== undefined ? Boolean(b.webhook_enabled) : undefined,
            webhook_url:
              b.webhook_url !== undefined ? String(b.webhook_url) : undefined,
            webhook_secret:
              b.webhook_secret !== undefined
                ? b.webhook_secret === null
                  ? null
                  : String(b.webhook_secret)
                : undefined,
          },
          session.username,
        );
        authRepo.writeAuditLog({
          actorUserId: session.user_id,
          actorUsername: session.username,
          action: "NOTIFICATION_CONFIG_UPDATE",
          targetType: "notifications",
          details: {
            webhook_enabled: updated.webhook_enabled,
            has_secret: updated.has_secret,
          },
          ipAddress: clientIp(request),
        });
        return okResponse(updated);
      } catch (err) {
        set.status = 400;
        return errorResponse(
          "VALIDATION_ERROR",
          err instanceof Error ? err.message : "Invalid notification configuration",
        );
      }
    })
    .post("/notifications/test", async ({ request, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      const result = await notifier.sendPayload({
        event: "test_notification",
        timestamp: new Date().toISOString(),
        actor: session.username,
        message: "Linux Hardware Monitor test webhook notification",
      });
      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "NOTIFICATION_TEST",
        targetType: "notifications",
        details: { delivered: result.delivered, status: result.status },
        ipAddress: clientIp(request),
      });
      return okResponse(result);
    });
}
