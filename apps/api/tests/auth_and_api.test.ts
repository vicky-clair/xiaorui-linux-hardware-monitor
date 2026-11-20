import { describe, expect, test } from "bun:test";
import { createAppRuntime } from "../src/app.ts";

function extractCookie(res: Response): string {
  const raw = res.headers.get("set-cookie");
  expect(raw).toBeTruthy();
  return raw!.split(";")[0]!;
}

describe("Authentication, RBAC, audit logs, and REST API endpoints", () => {
  test("enforces bootstrap token, Argon2id login, rate limits, viewer vs admin RBAC, and config masking", async () => {
    const rt = createAppRuntime({
      dbPath: ":memory:",
      bootstrapToken: "test-bootstrap-secret-token",
    });

    try {
      // Seed telemetry via repository
      rt.telemetryRepo.upsertHost({
        host_id: "host-01",
        hostname: "debian-node",
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
            name: "Intel N5095A",
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

      // 1. Protected endpoint rejects unauthenticated caller
      const unauth = await rt.app.handle(
        new Request("http://localhost/api/v1/system/overview"),
      );
      expect(unauth.status).toBe(401);
      const unauthBody = (await unauth.json()) as { error: { code: string } };
      expect(unauthBody.error.code).toBe("UNAUTHORIZED");

      // 2. Bootstrap with wrong token fails
      const badBoot = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/bootstrap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bootstrap_token: "wrong",
            username: "admin",
            password: "StrongPassword123!",
          }),
        }),
      );
      expect(badBoot.status).toBe(403);

      // 3. Bootstrap with valid token succeeds once
      const okBoot = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/bootstrap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bootstrap_token: "test-bootstrap-secret-token",
            username: "admin",
            password: "StrongPassword123!",
          }),
        }),
      );
      expect(okBoot.status).toBe(201);

      // Second bootstrap permanently blocked
      const dupBoot = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/bootstrap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bootstrap_token: "test-bootstrap-secret-token",
            username: "admin2",
            password: "StrongPassword123!",
          }),
        }),
      );
      expect(dupBoot.status).toBe(403);

      // 4. Rate limit on 5 failed login attempts for an IP
      for (let i = 0; i < 5; i++) {
        const fail = await rt.app.handle(
          new Request("http://localhost/api/v1/auth/login", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": "10.0.0.99",
            },
            body: JSON.stringify({
              username: "attacker",
              password: "WrongPassword123!",
            }),
          }),
        );
        expect(fail.status).toBe(401);
      }
      const throttled = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "10.0.0.99",
          },
          body: JSON.stringify({
            username: "attacker",
            password: "WrongPassword123!",
          }),
        }),
      );
      expect(throttled.status).toBe(429);

      // 5. Admin logs in and creates viewer user
      const loginRes = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: "admin",
            password: "StrongPassword123!",
          }),
        }),
      );
      expect(loginRes.status).toBe(200);
      const adminCookie = extractCookie(loginRes);

      const createViewer = await rt.app.handle(
        new Request("http://localhost/api/v1/users", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: adminCookie,
          },
          body: JSON.stringify({
            username: "readonly_user",
            password: "ViewerPassword123!",
            role: "viewer",
          }),
        }),
      );
      expect(createViewer.status).toBe(201);

      // 6. Admin stores public + sensitive setting; GET /config MUST omit sensitive keys
      rt.authRepo.upsertSettings(
        { retention_raw_days: 14, internal_secret: "do-not-expose" },
        "admin",
        new Set(["internal_secret"]),
      );
      const putCfg = await rt.app.handle(
        new Request("http://localhost/api/v1/config", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: adminCookie,
          },
          body: JSON.stringify({ ui_refresh_ms: 3000 }),
        }),
      );
      expect(putCfg.status).toBe(200);

      // 7. Viewer logs in: can read telemetry/config, forbidden on admin mutations
      const viewerLogin = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: "readonly_user",
            password: "ViewerPassword123!",
          }),
        }),
      );
      expect(viewerLogin.status).toBe(200);
      const viewerCookie = extractCookie(viewerLogin);

      for (const path of [
        "/api/v1/auth/me",
        "/api/v1/system/overview",
        "/api/v1/hosts",
        "/api/v1/devices",
        "/api/v1/devices/cpu-system-0",
        "/api/v1/sensors",
        "/api/v1/sensors/cpu-system-0-temp-pkg/readings",
        "/api/v1/coverage",
        "/api/v1/storage",
        "/api/v1/collectors",
        "/api/v1/diagnostics",
        "/api/v1/config",
      ]) {
        const res = await rt.app.handle(
          new Request(`http://localhost${path}`, {
            headers: { cookie: viewerCookie },
          }),
        );
        expect(res.status).toBe(200);
        if (path === "/api/v1/config") {
          const cfgBody = (await res.json()) as {
            data: { settings: Record<string, unknown> };
          };
          expect(cfgBody.data.settings.ui_refresh_ms).toBe(3000);
          expect(cfgBody.data.settings.internal_secret).toBeUndefined();
        }
      }

      const viewerPutCfg = await rt.app.handle(
        new Request("http://localhost/api/v1/config", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: viewerCookie,
          },
          body: JSON.stringify({ ui_refresh_ms: 1000 }),
        }),
      );
      expect(viewerPutCfg.status).toBe(403);

      // Audit logs captured bootstrap, login, user create, config update
      const audits = rt.authRepo.listAuditLogs();
      expect(audits.some((a) => a.action === "CONFIG_UPDATE")).toBe(true);
      expect(audits.some((a) => a.action === "USER_CREATE")).toBe(true);

      // Logout invalidates session
      const logoutRes = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/logout", {
          method: "POST",
          headers: { cookie: viewerCookie },
        }),
      );
      expect(logoutRes.status).toBe(200);
      const afterLogout = await rt.app.handle(
        new Request("http://localhost/api/v1/auth/me", {
          headers: { cookie: viewerCookie },
        }),
      );
      expect(afterLogout.status).toBe(401);
    } finally {
      rt.close();
    }
  });
});
