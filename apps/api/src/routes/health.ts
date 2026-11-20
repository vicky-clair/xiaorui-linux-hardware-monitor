import { Elysia } from "elysia";
import { SCHEMA_VERSION } from "@lhm/protocol";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } | null;
  request_id: string;
  timestamp: string;
}

export function okResponse<T>(data: T, requestId: string): ApiEnvelope<T> {
  return {
    success: true,
    data,
    error: null,
    request_id: requestId,
    timestamp: new Date().toISOString(),
  };
}

export const healthRoute = new Elysia({ prefix: "/api/v1" }).get(
  "/health",
  () => {
    const requestId = `req-${crypto.randomUUID()}`;
    return okResponse(
      {
        status: "ok",
        service: "lhm-api",
        protocol_schema_version: SCHEMA_VERSION,
      },
      requestId,
    );
  },
);
