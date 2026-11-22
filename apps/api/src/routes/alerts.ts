// 告警管理、规则增删改与 Haskell 健康分析按需触发 REST 路由（写操作仅限 admin 并写入审计日志）。
import { Elysia } from "elysia";
import type {
  AlertRuleSpec,
  DeviceType,
  RuleOperator,
  Severity,
  Unit,
} from "@lhm/protocol";
import type { AuthService } from "../auth/service.ts";
import { errorResponse, okResponse } from "../middleware/envelope.ts";
import type { AlertRepository } from "../repositories/alertRepo.ts";
import type { AuthRepository } from "../repositories/authRepo.ts";
import type { HealthAnalysisService } from "../services/healthClient.ts";

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1"
  );
}

const VALID_OPS = new Set<RuleOperator>(["gt", "gte", "lt", "lte"]);
const VALID_SEV = new Set<Severity>(["normal", "warning", "critical", "unknown"]);

export function createAlertRoutes(deps: {
  authService: AuthService;
  authRepo: AuthRepository;
  alertRepo: AlertRepository;
  healthService: HealthAnalysisService;
}) {
  const { authService, authRepo, alertRepo, healthService } = deps;

  return new Elysia({ prefix: "/api/v1" })
    .get("/analysis", ({ request, query, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const limit = query.limit ? Number(query.limit) : 100;
      return okResponse({
        results: alertRepo.listLatestAnalysis(Number.isFinite(limit) ? limit : 100),
      });
    })
    .post("/analysis/run", async ({ request, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      const outcome = await healthService.runCycle();
      return okResponse(outcome);
    })
    .get("/alerts", ({ request, query, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const limit = query.limit ? Number(query.limit) : 100;
      return okResponse({
        alerts: alertRepo.listAlerts({
          status: query.status,
          limit: Number.isFinite(limit) ? limit : 100,
        }),
      });
    })
    .post("/alerts/:id/ack", ({ request, params, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      const acked = alertRepo.acknowledgeAlert(params.id, session.username);
      if (!acked) {
        set.status = 404;
        return errorResponse("NOT_FOUND", `Alert '${params.id}' not found`);
      }
      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "ALERT_ACK",
        targetType: "alert",
        targetId: params.id,
        ipAddress: clientIp(request),
      });
      return okResponse(acked);
    })
    .get("/alert-rules", ({ request, set }) => {
      if (!authService.authenticateRequest(request)) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      return okResponse({ rules: alertRepo.listRules() });
    })
    .post("/alert-rules", ({ request, body, set }) => {
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
      const ruleId = String(b.rule_id ?? `rule-${crypto.randomUUID().slice(0, 8)}`).trim();
      const operator = String(b.operator ?? "") as RuleOperator;
      const severity = String(b.severity ?? "") as Severity;
      const threshold = Number(b.threshold);
      const duration = Number(b.duration_seconds ?? 0);

      if (
        !b.metric ||
        !b.device_type ||
        !b.unit ||
        !VALID_OPS.has(operator) ||
        !VALID_SEV.has(severity) ||
        !Number.isFinite(threshold) ||
        !Number.isFinite(duration) ||
        duration < 0
      ) {
        set.status = 400;
        return errorResponse("VALIDATION_ERROR", "Invalid alert rule specification");
      }

      const spec: AlertRuleSpec = {
        rule_id: ruleId,
        metric: String(b.metric),
        device_type: String(b.device_type) as DeviceType,
        device_id: b.device_id ? String(b.device_id) : null,
        operator,
        threshold,
        unit: String(b.unit) as Unit,
        duration_seconds: Math.floor(duration),
        severity,
        enabled: b.enabled !== false,
      };

      const created = alertRepo.createRule(spec);
      const warning =
        spec.metric === "temperature" && spec.threshold > 100
          ? "Configured temperature threshold exceeds typical hardware critical limits (100 °C)"
          : null;

      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "ALERT_RULE_CREATE",
        targetType: "alert_rule",
        targetId: created.rule_id,
        details: { threshold: spec.threshold, warning },
        ipAddress: clientIp(request),
      });
      set.status = 201;
      return okResponse({ rule: created, warning });
    })
    .patch("/alert-rules/:id", ({ request, params, body, set }) => {
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
      const updated = alertRepo.updateRule(params.id, {
        ...(b.threshold !== undefined ? { threshold: Number(b.threshold) } : {}),
        ...(b.duration_seconds !== undefined
          ? { duration_seconds: Number(b.duration_seconds) }
          : {}),
        ...(b.severity !== undefined ? { severity: String(b.severity) as Severity } : {}),
        ...(b.enabled !== undefined ? { enabled: Boolean(b.enabled) } : {}),
      });
      if (!updated) {
        set.status = 404;
        return errorResponse("NOT_FOUND", `Alert rule '${params.id}' not found`);
      }
      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "ALERT_RULE_UPDATE",
        targetType: "alert_rule",
        targetId: params.id,
        ipAddress: clientIp(request),
      });
      return okResponse({ rule: updated });
    })
    .delete("/alert-rules/:id", ({ request, params, set }) => {
      const session = authService.authenticateRequest(request);
      if (!session) {
        set.status = 401;
        return errorResponse("UNAUTHORIZED", "Authentication required");
      }
      if (session.role !== "admin") {
        set.status = 403;
        return errorResponse("FORBIDDEN", "Administrator role required");
      }
      if (!alertRepo.deleteRule(params.id)) {
        set.status = 404;
        return errorResponse("NOT_FOUND", `Alert rule '${params.id}' not found`);
      }
      authRepo.writeAuditLog({
        actorUserId: session.user_id,
        actorUsername: session.username,
        action: "ALERT_RULE_DELETE",
        targetType: "alert_rule",
        targetId: params.id,
        ipAddress: clientIp(request),
      });
      return okResponse({ deleted: true });
    });
}
