import { Elysia } from "elysia";
import { healthRoute } from "./routes/health.ts";

export function createApp() {
  return new Elysia().use(healthRoute);
}
