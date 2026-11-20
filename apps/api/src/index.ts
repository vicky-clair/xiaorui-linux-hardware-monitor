import { createAppRuntime } from "./app.ts";
import { startUnixIpcServer, type UnixIpcServerHandle } from "./ipc/unixServer.ts";

const runtime = createAppRuntime();

const bootstrapToken = runtime.authService.getBootstrapTokenIfNeeded();
if (bootstrapToken) {
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "lhm-api",
      level: "WARN",
      message:
        "No users configured. Call POST /api/v1/auth/bootstrap with the one-time token to create the initial admin user.",
      bootstrap_token: bootstrapToken,
    }),
  );
}

let ipcServer: UnixIpcServerHandle | null = null;
if (process.platform !== "win32") {
  ipcServer = startUnixIpcServer(
    runtime.config.ipcSocketPath,
    runtime.ipcProcessor,
  );
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "lhm-api",
      level: "INFO",
      message: `IPC Unix Socket listening at ${ipcServer.socketPath}`,
    }),
  );
}

// Background aggregation & health analysis timer (every 60s)
const aggTimer = setInterval(() => {
  const now = Date.now();
  const from1m = new Date(now - 5 * 60_000).toISOString();
  const toNow = new Date(now + 1000).toISOString();
  try {
    runtime.aggregationRepo.aggregate1m(from1m, toNow);
    const from1h = new Date(now - 2 * 3_600_000).toISOString();
    runtime.aggregationRepo.aggregate1h(from1h, toNow);
  } catch (err) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        component: "lhm-api-aggregation",
        level: "ERROR",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  void runtime.healthService.runCycle();
}, 60_000);

runtime.app.listen({
  hostname: runtime.config.host,
  port: runtime.config.port,
});

console.info(
  JSON.stringify({
    timestamp: new Date().toISOString(),
    component: "lhm-api",
    level: "INFO",
    message: `Listening on http://${runtime.config.host}:${runtime.config.port}`,
  }),
);

const shutdown = () => {
  clearInterval(aggTimer);
  ipcServer?.stop();
  runtime.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
