import { describe, expect, test } from "bun:test";
import { PROTOCOL_NAME, SCHEMA_VERSION } from "@lhm/protocol";
import { createAppRuntime } from "../src/app.ts";

describe("WebSocket /api/v1/stream authentication, Origin check, and incremental push", () => {
  test("rejects unauthenticated or bad-Origin connections and streams subscribed readings", async () => {
    const rt = createAppRuntime({
      dbPath: ":memory:",
      bootstrapToken: "ws-bootstrap-token",
      allowedOrigins: ["http://localhost:5173"],
    });

    const server = rt.app.listen({ hostname: "127.0.0.1", port: 0 });
    const port = server.server?.port;
    expect(port).toBeTruthy();

    try {
      // Bootstrap & login to obtain session cookie
      await fetch(`http://127.0.0.1:${port}/api/v1/auth/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bootstrap_token: "ws-bootstrap-token",
          username: "wsadmin",
          password: "StrongPassword123!",
        }),
      });
      const login = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "wsadmin",
          password: "StrongPassword123!",
        }),
      });
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

      const expectWsRejected = (headers: Record<string, string>) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Expected WS rejection but timed out")),
            3000,
          );
          const ws = new WebSocket(
            `ws://127.0.0.1:${port}/api/v1/stream`,
            { headers } as unknown as string[],
          );
          ws.addEventListener("open", () => {
            clearTimeout(timer);
            ws.close();
            reject(new Error("Expected WS to be rejected, but it opened"));
          });
          ws.addEventListener("error", () => {
            clearTimeout(timer);
            resolve();
          });
          ws.addEventListener("close", () => {
            clearTimeout(timer);
            resolve();
          });
        });

      // 1. Unauthenticated WS upgrade rejected (401)
      await expectWsRejected({ origin: "http://localhost:5173" });

      // 2. Disallowed Origin rejected (403)
      await expectWsRejected({ cookie, origin: "https://evil.example" });

      // 3. Authenticated WebSocket with valid Origin receives live reading push
      const received: Array<{ type: string; data: Record<string, unknown> }> = [];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket test timed out")), 4000);
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/api/v1/stream`,
          { headers: { cookie, origin: "http://localhost:5173" } } as unknown as string[],
        );
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("WebSocket connection failed"));
        });
        ws.addEventListener("message", (ev) => {
          const msg = JSON.parse(String(ev.data)) as {
            type: string;
            data: Record<string, unknown>;
          };
          received.push(msg);
          if (msg.type === "ping") {
            ws.send(
              JSON.stringify({
                action: "subscribe",
                topics: ["reading"],
                sensor_ids: ["cpu-system-0-temp-pkg"],
              }),
            );
            // Trigger IPC reading ingestion after subscription settles
            setTimeout(() => {
              rt.ipcProcessor.processMessage({
                protocol: PROTOCOL_NAME,
                schema_version: SCHEMA_VERSION,
                message_id: crypto.randomUUID(),
                message_type: "sensor_readings",
                host_id: "host-ws",
                agent_instance_id: "inst-ws",
                sequence: 1,
                sent_at: "2026-11-20T10:00:00Z",
                payload: {
                  readings: [
                    {
                      schema_version: "1.0",
                      host_id: "host-ws",
                      device_id: "cpu-system-0",
                      sensor_id: "cpu-system-0-temp-pkg",
                      metric: "temperature",
                      value: 58.5,
                      unit: "celsius",
                      quality: "valid",
                      source: "hwmon",
                      collected_at: "2026-11-20T10:00:00Z",
                    },
                  ],
                },
              });
            }, 60);
          } else if (msg.type === "reading") {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        });
      });

      expect(received.some((m) => m.type === "ping")).toBe(true);
      const readingEv = received.find((m) => m.type === "reading");
      expect(readingEv?.data.value).toBe(58.5);
    } finally {
      server.stop(true);
      rt.close();
    }
  });
});
