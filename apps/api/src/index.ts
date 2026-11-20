import { createApp } from "./app.ts";
import { loadConfig } from "./config/env.ts";

const config = loadConfig();
const app = createApp();

app.listen({
  hostname: config.host,
  port: config.port,
});

console.info(
  JSON.stringify({
    timestamp: new Date().toISOString(),
    component: "lhm-api",
    level: "INFO",
    message: `Listening on http://${config.host}:${config.port}`,
  }),
);
