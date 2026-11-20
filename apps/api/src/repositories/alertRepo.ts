import { and, desc, eq } from "drizzle-orm";
import type {
  AlertRuleSpec,
  AlertStateSnapshot,
  AnalyzeResponse,
  DeviceType,
  RuleOperator,
  Severity,
  Unit,
} from "@lhm/protocol";
import type { DatabaseHandle } from "./db.ts";
import {
  alertHistory,
  alertRules,
  alertStates,
  analysisResults,
} from "./schema.ts";

export interface AlertRuleRow extends AlertRuleSpec {
  created_at: string;
  updated_at: string;
}

export class AlertRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  listRules(): AlertRuleRow[] {
    return this.db
      .select()
      .from(alertRules)
      .all()
      .map((r) => ({
        rule_id: r.ruleId,
        metric: r.metric,
        device_type: r.deviceType as DeviceType,
        device_id: r.deviceId,
        operator: r.operator as RuleOperator,
        threshold: r.threshold,
        unit: r.unit as Unit,
        duration_seconds: r.durationSeconds,
        severity: r.severity as Severity,
        enabled: r.enabled === 1,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      }));
  }

  getRule(ruleId: string): AlertRuleRow | null {
    const r = this.db
      .select()
      .from(alertRules)
      .where(eq(alertRules.ruleId, ruleId))
      .get();
    if (!r) return null;
    return {
      rule_id: r.ruleId,
      metric: r.metric,
      device_type: r.deviceType as DeviceType,
      device_id: r.deviceId,
      operator: r.operator as RuleOperator,
      threshold: r.threshold,
      unit: r.unit as Unit,
      duration_seconds: r.durationSeconds,
      severity: r.severity as Severity,
      enabled: r.enabled === 1,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  createRule(rule: AlertRuleSpec): AlertRuleRow {
    const now = new Date().toISOString();
    this.db
      .insert(alertRules)
      .values({
        ruleId: rule.rule_id,
        metric: rule.metric,
        deviceType: rule.device_type,
        deviceId: rule.device_id ?? null,
        operator: rule.operator,
        threshold: rule.threshold,
        unit: rule.unit,
        durationSeconds: rule.duration_seconds,
        severity: rule.severity,
        enabled: rule.enabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return { ...rule, device_id: rule.device_id ?? null, created_at: now, updated_at: now };
  }

  updateRule(
    ruleId: string,
    patch: Partial<Omit<AlertRuleSpec, "rule_id">>,
  ): AlertRuleRow | null {
    const existing = this.getRule(ruleId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .update(alertRules)
      .set({
        ...(patch.metric !== undefined ? { metric: patch.metric } : {}),
        ...(patch.device_type !== undefined ? { deviceType: patch.device_type } : {}),
        ...(patch.device_id !== undefined ? { deviceId: patch.device_id } : {}),
        ...(patch.operator !== undefined ? { operator: patch.operator } : {}),
        ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
        ...(patch.duration_seconds !== undefined
          ? { durationSeconds: patch.duration_seconds }
          : {}),
        ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
        updatedAt: now,
      })
      .where(eq(alertRules.ruleId, ruleId))
      .run();
    return this.getRule(ruleId);
  }

  deleteRule(ruleId: string): boolean {
    if (!this.getRule(ruleId)) return false;
    this.db.delete(alertRules).where(eq(alertRules.ruleId, ruleId)).run();
    return true;
  }

  listAlertStates(hostId?: string): AlertStateSnapshot[] {
    const rows = hostId
      ? this.db
          .select()
          .from(alertStates)
          .where(eq(alertStates.hostId, hostId))
          .all()
      : this.db.select().from(alertStates).all();

    return rows.map((r) => ({
      state_key: r.stateKey,
      host_id: r.hostId,
      device_id: r.deviceId,
      rule_id: r.ruleId,
      state: r.state as AlertStateSnapshot["state"],
      pending_since: r.pendingSince,
      firing_since: r.firingSince,
      last_evaluated_at: r.lastEvaluatedAt,
    }));
  }

  /**
   * Persists Haskell AnalyzeResponse atomically in a single SQLite transaction (ADR-0004, ADR-0007).
   * Handles active-alert deduplication per `(host_id, device_id, rule_id)`.
   */
  applyAnalyzeResponse(response: AnalyzeResponse): {
    createdAlerts: string[];
    resolvedAlerts: string[];
  } {
    const createdAlerts: string[] = [];
    const resolvedAlerts: string[] = [];
    const now = response.analyzed_at;

    const tx = this.handle.sqlite.transaction(() => {
      for (const a of response.analysis_results) {
        this.db
          .insert(analysisResults)
          .values({
            hostId: a.host_id,
            deviceId: a.device_id,
            severity: a.severity,
            score: a.score,
            engineVersion: a.engine_version,
            ruleVersion: a.rule_version,
            thresholdSource: a.threshold_source,
            factorsJson: JSON.stringify({
              trend: a.trend,
              anomalies: a.anomalies,
              correlations: a.correlations,
              factors: a.factors,
            }),
            analyzedAt: a.analyzed_at,
          })
          .run();
      }

      for (const st of response.next_alert_states) {
        this.db
          .insert(alertStates)
          .values({
            stateKey: st.state_key,
            hostId: st.host_id,
            deviceId: st.device_id,
            ruleId: st.rule_id,
            state: st.state,
            pendingSince: st.pending_since ?? null,
            firingSince: st.firing_since ?? null,
            lastEvaluatedAt: st.last_evaluated_at,
            payloadJson: null,
          })
          .onConflictDoUpdate({
            target: alertStates.stateKey,
            set: {
              state: st.state,
              pendingSince: st.pending_since ?? null,
              firingSince: st.firing_since ?? null,
              lastEvaluatedAt: st.last_evaluated_at,
            },
          })
          .run();
      }

      for (const tr of response.alert_transitions) {
        const existingActive = this.db
          .select()
          .from(alertHistory)
          .where(
            and(
              eq(alertHistory.hostId, tr.host_id),
              eq(alertHistory.deviceId, tr.device_id),
              eq(alertHistory.ruleId, tr.rule_id),
              eq(alertHistory.status, "firing"),
            ),
          )
          .get();

        if (tr.transition === "trigger" || tr.transition === "escalate") {
          if (existingActive) {
            // Active alert deduplication: update severity/summary in place
            this.db
              .update(alertHistory)
              .set({
                severity: tr.severity,
                summary: tr.summary,
                detailsJson: JSON.stringify(tr),
              })
              .where(eq(alertHistory.alertId, existingActive.alertId))
              .run();
          } else {
            const alertId = `alt-${crypto.randomUUID()}`;
            this.db
              .insert(alertHistory)
              .values({
                alertId,
                hostId: tr.host_id,
                deviceId: tr.device_id,
                ruleId: tr.rule_id,
                severity: tr.severity,
                status: "firing",
                summary: tr.summary,
                detailsJson: JSON.stringify(tr),
                triggeredAt: now,
              })
              .run();
            createdAlerts.push(alertId);
          }
        } else if (tr.transition === "resolve" && existingActive) {
          this.db
            .update(alertHistory)
            .set({
              status: "resolved",
              resolvedAt: now,
            })
            .where(eq(alertHistory.alertId, existingActive.alertId))
            .run();
          resolvedAlerts.push(existingActive.alertId);
        }
      }
    });

    tx();
    return { createdAlerts, resolvedAlerts };
  }

  /**
   * Records explicit `unknown` degradation when Haskell engine is unreachable (ADR-0004).
   * NEVER reports `normal` when analysis could not run.
   */
  recordDegradedAnalysis(hostId: string, deviceIds: string[], reason: string): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      for (const deviceId of deviceIds) {
        this.db
          .insert(analysisResults)
          .values({
            hostId,
            deviceId,
            severity: "unknown",
            score: null,
            engineVersion: "unavailable",
            ruleVersion: "unavailable",
            thresholdSource: "unavailable",
            factorsJson: JSON.stringify({
              trend: "insufficient_data",
              anomalies: [],
              correlations: [],
              factors: [
                {
                  metric: "engine",
                  delta: 0,
                  reason: `engine_unavailable: ${reason}`,
                },
              ],
            }),
            analyzedAt: now,
          })
          .run();
      }
    });
    tx();
  }

  listLatestAnalysis(limit: number = 100) {
    const stmt = this.handle.sqlite.query(`
      SELECT ar.*
      FROM analysis_results ar
      INNER JOIN (
        SELECT device_id, MAX(id) AS max_id
        FROM analysis_results
        GROUP BY device_id
      ) latest ON ar.id = latest.max_id
      ORDER BY ar.analyzed_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(Math.min(limit, 500)) as Array<{
      id: number;
      host_id: string;
      device_id: string;
      severity: string;
      score: number | null;
      engine_version: string;
      rule_version: string;
      threshold_source: string;
      factors_json: string;
      analyzed_at: string;
    }>;

    return rows.map((r) => {
      const parsed = JSON.parse(r.factors_json) as {
        trend?: string;
        anomalies?: Array<{ code: string; reason: string }>;
        correlations?: Array<{ code: string; summary: string }>;
        factors?: Array<{ metric: string; delta: number; reason: string }>;
      };
      return {
        id: r.id,
        host_id: r.host_id,
        device_id: r.device_id,
        severity: r.severity,
        score: r.score,
        engine_version: r.engine_version,
        rule_version: r.rule_version,
        threshold_source: r.threshold_source,
        trend: parsed.trend ?? "insufficient_data",
        anomalies: parsed.anomalies ?? [],
        correlations: parsed.correlations ?? [],
        factors: parsed.factors ?? [],
        analyzed_at: r.analyzed_at,
      };
    });
  }

  listAlerts(filters?: { status?: string; limit?: number }) {
    const conds = [];
    if (filters?.status) {
      conds.push(eq(alertHistory.status, filters.status));
    }
    return this.db
      .select()
      .from(alertHistory)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(alertHistory.triggeredAt))
      .limit(Math.min(filters?.limit ?? 100, 500))
      .all()
      .map((a) => ({
        alert_id: a.alertId,
        host_id: a.hostId,
        device_id: a.deviceId,
        rule_id: a.ruleId,
        severity: a.severity,
        status: a.status,
        summary: a.summary,
        details: a.detailsJson ? JSON.parse(a.detailsJson) : null,
        triggered_at: a.triggeredAt,
        acknowledged_at: a.acknowledgedAt,
        acknowledged_by: a.acknowledgedBy,
        resolved_at: a.resolvedAt,
      }));
  }

  acknowledgeAlert(alertId: string, actorUsername: string) {
    const existing = this.db
      .select()
      .from(alertHistory)
      .where(eq(alertHistory.alertId, alertId))
      .get();
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .update(alertHistory)
      .set({
        acknowledgedAt: now,
        acknowledgedBy: actorUsername,
      })
      .where(eq(alertHistory.alertId, alertId))
      .run();
    return {
      alert_id: existing.alertId,
      acknowledged_at: now,
      acknowledged_by: actorUsername,
    };
  }
}
