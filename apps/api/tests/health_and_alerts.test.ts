import { describe, expect, test } from "bun:test";
import type { AnalyzeRequest, AnalyzeResponse } from "@lhm/protocol";
import { createAppRuntime } from "../src/app.ts";

describe("Phase 4 Health Engine client, alert lifecycle, deduplication & degradation", () => {
  test("calls stateless Haskell engine, deduplicates firing alerts, acknowledges, resolves, and degrades to unknown when unreachable", async () => {
    let calls = 0;
    const mockHaskell = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/analyze" && req.method === "POST") {
          calls += 1;
          const body = (await req.json()) as AnalyzeRequest;
          const isResolve = calls >= 3;
          const resp: AnalyzeResponse = {
            schema_version: "1.1",
            engine_version: "0.1.0",
            rule_version: body.rule_version,
            analyzed_at: body.evaluated_at,
            analysis_results: body.devices.map((d) => ({
              host_id: body.host_id,
              device_id: d.device_id,
              severity: isResolve ? "normal" : "warning",
              score: isResolve ? 100 : 80,
              engine_version: "0.1.0",
              rule_version: body.rule_version,
              threshold_source: "user_device_override",
              trend: "rising",
              anomalies: [],
              correlations: [],
              factors: [
                {
                  metric: "temperature",
                  delta: isResolve ? 0 : -20,
                  reason: isResolve ? "Recovered" : "Rule cpu-hot exceeded",
                },
              ],
              analyzed_at: body.evaluated_at,
            })),
            alert_transitions: [
              {
                state_key: `${body.host_id}:cpu-system-0:cpu-hot`,
                host_id: body.host_id,
                device_id: "cpu-system-0",
                rule_id: "cpu-hot",
                transition: isResolve ? "resolve" : "trigger",
                severity: "warning",
                summary: isResolve ? "Recovered" : "CPU temp exceeded 80 C",
                metric: "temperature",
                observed_value: isResolve ? 65 : 85,
                threshold: 80,
                threshold_source: "user_device_override",
              },
            ],
            next_alert_states: [
              {
                state_key: `${body.host_id}:cpu-system-0:cpu-hot`,
                host_id: body.host_id,
                device_id: "cpu-system-0",
                rule_id: "cpu-hot",
                state: isResolve ? "resolved" : "firing",
                pending_since: null,
                firing_since: isResolve ? null : body.evaluated_at,
                last_evaluated_at: body.evaluated_at,
              },
            ],
          };
          return Response.json(resp);
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const rt = createAppRuntime({
      dbPath: ":memory:",
      bootstrapToken: "p4-boot",
      healthEngineUrl: `http://127.0.0.1:${mockHaskell.port}`,
      healthEngineTimeoutMs: 2000,
    });

    try {
      // Seed host + device + sensor + reading
      rt.telemetryRepo.upsertHost({
        host_id: "host-01",
        hostname: "debian-srv",
        os_name: "Debian GNU/Linux",
        os_version: "13.6",
        kernel_version: "6.12.107+deb13-amd64",
        architecture: "x86_64",
        agent_version: "0.1.0",
      });
      rt.telemetryRepo.upsertInventory(
        "host-01",
        [
          {
            device_id: "cpu-system-0",
            host_id: "host-01",
            device_type: "cpu",
            vendor: "intel",
            model: "N5095A",
            name: "CPU",
            identity: { stable: true },
            capabilities: ["temperature"],
            device_status: "online",
          },
        ],
        [
          {
            sensor_id: "cpu-system-0-temp-pkg",
            device_id: "cpu-system-0",
            sensor_type: "temperature",
            sensor_name: "Package",
            source: "hwmon",
            unit: "celsius",
            capability_status: "supported",
            enabled: true,
          },
        ],
      );
      rt.telemetryRepo.insertReadingsBatch("host-01", [
        {
          schema_version: "1.0",
          host_id: "host-01",
          device_id: "cpu-system-0",
          sensor_id: "cpu-system-0-temp-pkg",
          metric: "temperature",
          value: 85,
          unit: "celsius",
          quality: "valid",
          source: "hwmon",
          collected_at: new Date().toISOString(),
        },
      ]);

      // Bootstrap & login admin
      await rt.app.handle(
        new Request("http://localhost/api/v1/auth/bootstrap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bootstrap_token: "p4-boot",
            username: "admin",
            password: "StrongPassword123!",
          }),
        }),
      );
      const login = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: "admin",
            password: "StrongPassword123!",
          }),
        }),
      );
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

      // Create alert rule via API
      const ruleRes = await rt.app.handle(
        new Request("http://localhost/api/v1/alert-rules", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            rule_id: "cpu-hot",
            metric: "temperature",
            device_type: "cpu",
            operator: "gte",
            threshold: 80,
            unit: "celsius",
            duration_seconds: 0,
            severity: "warning",
          }),
        }),
      );
      expect(ruleRes.status).toBe(201);

      // Run analysis twice -> MUST deduplicate into exactly 1 active alert
      const run1 = await rt.app.handle(
        new Request("http://localhost/api/v1/analysis/run", {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(run1.status).toBe(200);
      await rt.app.handle(
        new Request("http://localhost/api/v1/analysis/run", {
          method: "POST",
          headers: { cookie },
        }),
      );

      const alertsRes = await rt.app.handle(
        new Request("http://localhost/api/v1/alerts", { headers: { cookie } }),
      );
      const alertsBody = (await alertsRes.json()) as {
        data: { alerts: Array<{ alert_id: string; status: string }> };
      };
      expect(alertsBody.data.alerts.length).toBe(1);
      const alertId = alertsBody.data.alerts[0]!.alert_id;
      expect(alertsBody.data.alerts[0]!.status).toBe("firing");

      // Acknowledge alert
      const ackRes = await rt.app.handle(
        new Request(`http://localhost/api/v1/alerts/${alertId}/ack`, {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(ackRes.status).toBe(200);

      // Third run resolves alert
      await rt.app.handle(
        new Request("http://localhost/api/v1/analysis/run", {
          method: "POST",
          headers: { cookie },
        }),
      );
      const afterResolve = rt.alertRepo.listAlerts();
      expect(afterResolve[0]?.status).toBe("resolved");
      expect(afterResolve[0]?.acknowledged_by).toBe("admin");

      // Stop Haskell mock server -> verify graceful degradation to severity=unknown, score=null
      mockHaskell.stop(true);
      const degraded = await rt.healthService.runCycle();
      expect(degraded.degraded).toBe(true);
      const analysis = rt.alertRepo.listLatestAnalysis();
      expect(analysis[0]?.severity).toBe("unknown");
      expect(analysis[0]?.score).toBeNull();
    } finally {
      mockHaskell.stop(true);
      rt.close();
    }
  });
});
