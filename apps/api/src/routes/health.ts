// API 服务健康检查路由（GET /api/v1/health，供 Docker healthcheck 与运维探活使用，不暴露敏感信息）。
import { Elysia } from "elysia";
import { SCHEMA_VERSION } from "@lhm/protocol";
import { okResponse } from "../middleware/envelope.ts";

export const healthRoute = new Elysia({ prefix: "/api/v1" }).get(
  "/health",
  () =>
    okResponse({
      status: "ok",
      service: "lhm-api",
      protocol_schema_version: SCHEMA_VERSION,
    }),
);
