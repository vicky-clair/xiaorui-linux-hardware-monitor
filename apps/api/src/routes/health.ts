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
