import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { SCHEMA_VERSION } from "@lhm/protocol";

describe("GET /api/v1/health", () => {
  test("returns unified envelope with protocol schema version", async () => {
    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/api/v1/health"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { status: string; service: string; protocol_schema_version: string };
      error: unknown;
      request_id: string;
      timestamp: string;
    };
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data.status).toBe("ok");
    expect(body.data.protocol_schema_version).toBe(SCHEMA_VERSION);
    expect(body.request_id.startsWith("req-")).toBe(true);
  });
});
