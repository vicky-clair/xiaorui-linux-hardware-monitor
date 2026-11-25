// 硬件遥测查询路由：提供总览、设备列表与身份详情、传感器读数（raw/1m/1h）、存储/SMART 详情、覆盖率与诊断日志接口。
import { Elysia } from "elysia";
import type { AuthService } from "../auth/service.ts";
import type { ApiConfig } from "../config/env.ts";
import { errorResponse, okResponse } from "../middleware/envelope.ts";
import type { AuthRepository } from "../repositories/authRepo.ts";
import type { TelemetryRepository } from "../repositories/telemetryRepo.ts";
import type { RealtimeHub } from "../websocket/hub.ts";

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
  );
}

export function createTelemetryRoutes(deps: {
  config: ApiConfig;
  authService: AuthService;
  authRepo: AuthRepository;
  telemetryRepo: TelemetryRepository;
  hub: RealtimeHub;
}) {
  const { config, authService, authRepo, telemetryRepo, hub } = deps;
  const effectiveStaleAfter = () => {
    const raw = authRepo.getInternalSetting("stale_after_seconds")?.value;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 10 ? n : config.staleAfterSeconds;
  };

  return new Elysia({ prefix: "/api/v1" })
    .get("/system/overview", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse(
        telemetryRepo.getSystemOverview(effectiveStaleAfter()),
      );
    })
    .get("/hosts", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse({ hosts: telemetryRepo.listHosts() });
    })
    .get("/devices", ({ request, query, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const limit = query.limit ? Number(query.limit) : undefined;
      return okResponse({
        devices: telemetryRepo.listDevices({
          hostId: query.host_id,
          deviceType: query.device_type,
          limit: Number.isFinite(limit) ? limit : undefined,
        }),
      });
    })
    .get("/devices/:id", ({ request, params, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const detail = telemetryRepo.getDeviceDetail(params.id);
      if (!detail) {
        set.status = 404;
        return errorResponse("DEVICE_NOT_FOUND", `Device '${params.id}' not found`);
      }
      return okResponse(detail);
    })
    .get("/sensors", ({ request, query, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const limit = query.limit ? Number(query.limit) : undefined;
      return okResponse({
        sensors: telemetryRepo.listSensors({
          deviceId: query.device_id,
          sensorType: query.sensor_type,
          limit: Number.isFinite(limit) ? limit : undefined,
        }),
      });
    })
    .get("/sensors/:id/readings", ({ request, params, query, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (!telemetryRepo.getSensor(params.id)) {
        set.status = 404;
        return errorResponse("SENSOR_NOT_FOUND", `Sensor '${params.id}' not found`);
      }
      const g = query.granularity;
      const granularity = g === "1m" || g === "1h" ? g : "raw";
      const limit = query.limit ? Number(query.limit) : undefined;
      const cursor = query.cursor ? Number(query.cursor) : undefined;
      const result = telemetryRepo.querySensorReadings({
        sensorId: params.id,
        from: query.from,
        to: query.to,
        granularity,
        limit: Number.isFinite(limit) ? limit : undefined,
        cursor: Number.isFinite(cursor) ? cursor : undefined,
      });
      return okResponse(result);
    })
    .get("/coverage", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse(telemetryRepo.getCoverage(effectiveStaleAfter()));
    })
    .get("/storage", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse({ storage: telemetryRepo.listStorage() });
    })
    .get("/storage/:id/smart", ({ request, params, query, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const limit = query.limit ? Number(query.limit) : 30;
      const smart = telemetryRepo.getStorageSmart(
        params.id,
        Number.isFinite(limit) ? limit : 30,
      );
      if (!smart) {
        set.status = 404;
        return errorResponse("DEVICE_NOT_FOUND", `Storage device '${params.id}' not found`);
      }
      return okResponse(smart);
    })
    .get("/collectors", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse({ collectors: telemetryRepo.listCollectors() });
    })
    .get("/diagnostics", ({ request, query, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const limit = query.limit ? Number(query.limit) : 100;
      return okResponse({
        diagnostics: telemetryRepo.listDiagnostics(
          Number.isFinite(limit) ? limit : 100,
        ),
      });
    })
    .get("/config", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse({
        settings: authRepo.getPublicSettings(),
        defaults: {
          stale_after_seconds: config.staleAfterSeconds,
          retention_raw_days: config.retentionRawDays,
          retention_1m_days: config.retention1mDays,
          retention_1h_days: config.retention1hDays,
          retention_smart_days: config.retentionSmartDays,
        },
      });
    })
    .put("/config", ({ request, body, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        set.status = 400;
        return errorResponse("VALIDATION_ERROR", "Request body must be a JSON object");
      }
      const updates = body as Record<string, unknown>;
      // 禁止经通用配置接口覆写通知敏感键，统一由 /api/v1/notifications 管理
      if (Object.keys(updates).some((k) => k.startsWith("notification_webhook_"))) {
        set.status = 400;
        return errorResponse(
          "VALIDATION_ERROR",
          "Use PUT /api/v1/notifications to manage webhook notification settings",
        );
      }
      authRepo.upsertSettings(updates, session.username);
      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "CONFIG_UPDATE",
        targetType: "settings",
        details: { keys: Object.keys(updates) },
        ipAddress: clientIp(request),
      });
      return okResponse({ settings: authRepo.getPublicSettings() });
    })
    .ws("/stream", {
      beforeHandle({ request, set }) {
        const origin = request.headers.get("origin");
        if (!authService.isOriginAllowed(origin)) {
          set.status = 403;
          return errorResponse("INVALID_ORIGIN", "WebSocket origin not allowed");
        }
        const session = authService.authenticateRequest(request);
        if (!session) {
          set.status = 401;
          return errorResponse("UNAUTHORIZED", "WebSocket authentication required");
        }
      },
      open(ws) {
        hub.register(ws.id, (payload) => ws.send(payload));
        ws.send(
          JSON.stringify({
            type: "ping",
            data: { connected: true },
            timestamp: new Date().toISOString(),
          }),
        );
      },
      message(ws, message) {
        try {
          const parsed =
            typeof message === "string"
              ? (JSON.parse(message) as Record<string, unknown>)
              : (message as Record<string, unknown>);
          hub.updateSubscription(ws.id, {
            action:
              parsed.action === "unsubscribe" ? "unsubscribe" : "subscribe",
            topics: Array.isArray(parsed.topics)
              ? parsed.topics.map(String)
              : undefined,
            device_ids: Array.isArray(parsed.device_ids)
              ? parsed.device_ids.map(String)
              : undefined,
            sensor_ids: Array.isArray(parsed.sensor_ids)
              ? parsed.sensor_ids.map(String)
              : undefined,
          });
        } catch {
          // ignore malformed subscription message without crashing socket
        }
      },
      close(ws) {
        hub.unregister(ws.id);
      },
    });
}
