import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createAppRuntime } from "../src/app.ts";
import { escapeCsvCell } from "../src/routes/extensions.ts";
import { validateWebhookUrl } from "../src/services/notifier.ts";

async function bootstrapAndLogin(runtime: ReturnType<typeof createAppRuntime>) {
  const token = runtime.authService.getBootstrapTokenIfNeeded()!;
  await runtime.app.handle(
    new Request("http://localhost/api/v1/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bootstrap_token: token,
        username: "admin",
        password: "SuperStrongPassword!2026",
      }),
    }),
  );
  const loginRes = await runtime.app.handle(
    new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "SuperStrongPassword!2026",
      }),
    }),
  );
  const cookie = loginRes.headers.get("set-cookie")!.split(";")[0]!;
  return cookie;
}

describe("Phase 6 extensions: safe CSV/JSON export & signed webhook notifications", () => {
  test("escapeCsvCell neutralizes formula injection and preserves null as empty", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(0)).toBe("0");
    expect(escapeCsvCell("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
    expect(escapeCsvCell("+1+2")).toBe("'+1+2");
    expect(escapeCsvCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
  });

  test("validateWebhookUrl blocks SSRF metadata/loopback/IPv4-mapped/non-http/credential URLs while allowing LAN", () => {
    expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(validateWebhookUrl("http://[::ffff:169.254.169.254]/latest/meta-data").ok).toBe(false);
    expect(validateWebhookUrl("http://[::ffff:127.0.0.1]:8080/hook").ok).toBe(false);
    expect(validateWebhookUrl("http://127.0.0.1:8080/hook").ok).toBe(false);
    expect(validateWebhookUrl("http://localhost:8080/hook").ok).toBe(false);
    expect(validateWebhookUrl("http://[::1]:8080/hook").ok).toBe(false);
    expect(validateWebhookUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateWebhookUrl("http://user:pass@192.168.9.165:9999/hook").ok).toBe(false);
    expect(validateWebhookUrl("http://192.168.9.200:8080/webhook").ok).toBe(true);
    expect(validateWebhookUrl("https://hooks.example.com/lhm").ok).toBe(true);
  });

  test("exports readings CSV/JSON preserving null vs 0 and sanitized health report", async () => {
    const runtime = createAppRuntime({ dbPath: ":memory:", allowLoopbackWebhook: true });
    try {
      const cookie = await bootstrapAndLogin(runtime);

      runtime.telemetryRepo.upsertHost({
        host_id: "host-exp-1",
        hostname: "debian-lan",
        os_name: "Debian",
        os_version: "13",
        kernel_version: "6.12",
        architecture: "x86_64",
        agent_version: "0.1.0",
        boot_time: null,
        uptime_seconds: 1200,
      });
      runtime.telemetryRepo.upsertInventory("host-exp-1", [
        {
          device_id: "cpu-0",
          host_id: "host-exp-1",
          device_type: "cpu",
          vendor: "Intel",
          model: "N5095A",
          name: "CPU",
          identity: {
            stable: true,
            pci_bus_id: null,
            pci_vendor_id: null,
            pci_device_id: null,
            wwn: null,
            serial: null,
            nvme_nguid: null,
            driver: "coretemp",
            raw_path: null,
            topology: null,
          },
          capabilities: ["temperature"],
          device_status: "online",
        },
      ], [
        {
          sensor_id: "cpu-0-temp",
          device_id: "cpu-0",
          sensor_type: "temperature",
          sensor_name: "Package",
          source: "hwmon",
          unit: "celsius",
          capability_status: "supported",
          enabled: true,
        },
      ]);
      runtime.telemetryRepo.insertReadingsBatch("host-exp-1", [
        {
          schema_version: "1.0",
          host_id: "host-exp-1",
          device_id: "cpu-0",
          sensor_id: "cpu-0-temp",
          metric: "temperature",
          value: 0,
          unit: "celsius",
          quality: "valid",
          source: "hwmon",
          collected_at: "2026-11-20T10:00:00Z",
        },
        {
          schema_version: "1.0",
          host_id: "host-exp-1",
          device_id: "cpu-0",
          sensor_id: "cpu-0-temp",
          metric: "temperature",
          value: null,
          unit: "celsius",
          quality: "missing",
          source: "hwmon",
          collected_at: "2026-11-20T10:01:00Z",
        },
      ]);

      // Unauthenticated export must be rejected (401)
      const unauth = await runtime.app.handle(
        new Request("http://localhost/api/v1/export/readings?sensor_id=cpu-0-temp&format=csv"),
      );
      expect(unauth.status).toBe(401);

      // Authenticated CSV export preserves 0 and leaves null empty
      const csvRes = await runtime.app.handle(
        new Request("http://localhost/api/v1/export/readings?sensor_id=cpu-0-temp&format=csv", {
          headers: { cookie },
        }),
      );
      expect(csvRes.status).toBe(200);
      expect(csvRes.headers.get("content-type")).toContain("text/csv");
      const csvText = await csvRes.text();
      expect(csvText).toContain("2026-11-20T10:00:00Z,cpu-0-temp,cpu-0,temperature,0,celsius,valid,hwmon");
      expect(csvText).toContain("2026-11-20T10:01:00Z,cpu-0-temp,cpu-0,temperature,,celsius,missing,hwmon");

      // Report export excludes sensitive credentials/sessions
      const reportRes = await runtime.app.handle(
        new Request("http://localhost/api/v1/export/report", { headers: { cookie } }),
      );
      expect(reportRes.status).toBe(200);
      const reportText = await reportRes.text();
      expect(reportText).not.toContain("passwordHash");
      expect(reportText).not.toContain("SuperStrongPassword");
      const reportJson = JSON.parse(reportText);
      expect(reportJson.devices.length).toBe(1);
    } finally {
      runtime.close();
    }
  });

  test("webhook configuration masks secrets, enforces SSRF check, and delivers HMAC-signed test payload", async () => {
    let receivedBody = "";
    let receivedSig = "";
    const receiver = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        receivedBody = await req.text();
        receivedSig = req.headers.get("x-lhm-signature") ?? "";
        return new Response("ok", { status: 200 });
      },
    });

    const runtime = createAppRuntime({ dbPath: ":memory:", allowLoopbackWebhook: true });
    try {
      const cookie = await bootstrapAndLogin(runtime);

      // SSRF metadata URL rejected with 400
      const badRes = await runtime.app.handle(
        new Request("http://localhost/api/v1/notifications", {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            webhook_enabled: true,
            webhook_url: "http://169.254.169.254/latest/meta-data",
          }),
        }),
      );
      expect(badRes.status).toBe(400);

      // Valid local receiver saved with secret (secret NEVER echoed back)
      const saveRes = await runtime.app.handle(
        new Request("http://localhost/api/v1/notifications", {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            webhook_enabled: true,
            webhook_url: `http://127.0.0.1:${receiver.port}/hook`,
            webhook_secret: "top-secret-hmac-key",
          }),
        }),
      );
      expect(saveRes.status).toBe(200);
      const saveText = await saveRes.text();
      expect(saveText).not.toContain("top-secret-hmac-key");
      const saveJson = JSON.parse(saveText);
      expect(saveJson.data.has_secret).toBe(true);

      // Config endpoint must also NOT leak webhook_secret
      const cfgRes = await runtime.app.handle(
        new Request("http://localhost/api/v1/config", { headers: { cookie } }),
      );
      expect(await cfgRes.text()).not.toContain("top-secret-hmac-key");

      // Send signed test notification
      const testRes = await runtime.app.handle(
        new Request("http://localhost/api/v1/notifications/test", {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(testRes.status).toBe(200);
      const testJson = await testRes.json();
      expect(testJson.data.delivered).toBe(true);
      expect(testJson.data.status).toBe(200);

      const expectedSig = `sha256=${createHmac("sha256", "top-secret-hmac-key").update(receivedBody).digest("hex")}`;
      expect(receivedSig).toBe(expectedSig);
    } finally {
      runtime.close();
      receiver.stop(true);
    }
  });

  test("POST /api/v1/system/check enforces admin auth, cooldown, and returns global summary", async () => {
    const runtime = createAppRuntime({ dbPath: ":memory:", allowLoopbackWebhook: true });
    try {
      const unauth = await runtime.app.handle(
        new Request("http://localhost/api/v1/system/check", { method: "POST" }),
      );
      expect(unauth.status).toBe(401);

      const cookie = await bootstrapAndLogin(runtime);
      const first = await runtime.app.handle(
        new Request("http://localhost/api/v1/system/check", {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(first.status).toBe(200);
      const body = await first.json();
      expect(body.success).toBe(true);
      expect(typeof body.data.agent_collected).toBe("boolean");
      expect(body.data.severity_counts).toBeDefined();

      // Immediate second call within 10s cooldown must be rate-limited (429)
      const second = await runtime.app.handle(
        new Request("http://localhost/api/v1/system/check", {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(second.status).toBe(429);
    } finally {
      runtime.close();
    }
  });

  test("audit hardening: heartbeat timeout marks online offline (preserves standby), password change revokes session, and config blocks webhook secrets", async () => {
    const runtime = createAppRuntime({ dbPath: ":memory:" });
    try {
      const adminCookie = await bootstrapAndLogin(runtime);

      // 1. M-3 heartbeat timeout detection preserves standby disks and marks online devices offline
      runtime.telemetryRepo.upsertHost({
        host_id: "host-hb-1",
        hostname: "hb-node",
        os_name: "Debian",
        os_version: "13",
        kernel_version: "6.12",
        architecture: "x86_64",
        agent_version: "0.1.0",
        boot_time: null,
        uptime_seconds: 100,
      });
      runtime.telemetryRepo.upsertInventory(
        "host-hb-1",
        [
          {
            device_id: "cpu-online-0",
            host_id: "host-hb-1",
            device_type: "cpu",
            vendor: "Intel",
            model: "N5095A",
            name: "CPU",
            identity: {
              stable: true,
              pci_bus_id: null,
              pci_vendor_id: null,
              pci_device_id: null,
              wwn: null,
              serial: null,
              nvme_nguid: null,
              driver: null,
              raw_path: null,
              topology: null,
            },
            capabilities: [],
            device_status: "online",
          },
          {
            device_id: "disk-standby-0",
            host_id: "host-hb-1",
            device_type: "storage",
            vendor: "HGST",
            model: "HDD",
            name: "HDD",
            identity: {
              stable: true,
              pci_bus_id: null,
              pci_vendor_id: null,
              pci_device_id: null,
              wwn: null,
              serial: null,
              nvme_nguid: null,
              driver: null,
              raw_path: null,
              topology: null,
            },
            capabilities: [],
            device_status: "standby",
          },
        ],
        [],
      );
      const futureMs = Date.now() + 120_000;
      const stale = runtime.telemetryRepo.detectStaleHostsAndMarkOffline(60, futureMs);
      expect(stale.length).toBe(1);
      expect(stale[0]?.deviceIds).toEqual(["cpu-online-0"]);
      const devs = runtime.telemetryRepo.listDevices();
      expect(devs.find((d) => d.deviceId === "cpu-online-0")?.deviceStatus).toBe("offline");
      expect(devs.find((d) => d.deviceId === "disk-standby-0")?.deviceStatus).toBe("standby");

      // 2. L-API-1: PUT /config rejects direct modification of notification_webhook_* keys
      const badCfg = await runtime.app.handle(
        new Request("http://localhost/api/v1/config", {
          method: "PUT",
          headers: { cookie: adminCookie, "content-type": "application/json" },
          body: JSON.stringify({ notification_webhook_secret: "oops" }),
        }),
      );
      expect(badCfg.status).toBe(400);

      // 3. L-API-2: Changing a user's password immediately revokes their active session
      const createRes = await runtime.app.handle(
        new Request("http://localhost/api/v1/users", {
          method: "POST",
          headers: { cookie: adminCookie, "content-type": "application/json" },
          body: JSON.stringify({
            username: "viewer2",
            password: "ViewerPassword!2026",
            role: "viewer",
          }),
        }),
      );
      const createdUser = (await createRes.json()).data.user;
      const vLogin = await runtime.app.handle(
        new Request("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "viewer2", password: "ViewerPassword!2026" }),
        }),
      );
      const viewerCookie = vLogin.headers.get("set-cookie")!.split(";")[0]!;

      // L-API-3: viewer cannot acknowledge alerts (403)
      const ackForbidden = await runtime.app.handle(
        new Request("http://localhost/api/v1/alerts/alt-1/ack", {
          method: "POST",
          headers: { cookie: viewerCookie },
        }),
      );
      expect(ackForbidden.status).toBe(403);

      // Admin changes viewer2 password -> viewerCookie must become unauthorized (401)
      const patchRes = await runtime.app.handle(
        new Request(`http://localhost/api/v1/users/${createdUser.user_id}`, {
          method: "PATCH",
          headers: { cookie: adminCookie, "content-type": "application/json" },
          body: JSON.stringify({ password: "NewViewerPassword!2026" }),
        }),
      );
      expect(patchRes.status).toBe(200);
      const meAfter = await runtime.app.handle(
        new Request("http://localhost/api/v1/auth/me", { headers: { cookie: viewerCookie } }),
      );
      expect(meAfter.status).toBe(401);
    } finally {
      runtime.close();
    }
  });
});
