/**
 * Bun API 服务启动入口（唯一 SQLite 写入者，AGENTS.md §4）。
 * 启动流程：初始化 SQLite WAL 与自动迁移 -> 首次无用户时生成一次性 bootstrap_token ->
 * 监听 Unix Domain Socket 接收 Rust Agent 数据 -> 启动 60 秒聚合/健康分析与每小时保留清理定时器 ->
 * 启动 Elysia HTTP / WebSocket 服务并监听 SIGINT/SIGTERM 优雅关机。
 */
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

// 事件驱动 + 超低频维护调度：
// 1. Agent 每次唤醒上报后防抖 3 秒立即执行一次聚合与 Haskell 健康分析；
// 2. 空闲期（如 12 小时采集模式下）仅按 LHM_MAINTENANCE_INTERVAL_SECONDS 唤醒，不空转消耗 CPU/SQLite。
let lastPruneAtMs = 0;
let ingestDebounce: ReturnType<typeof setTimeout> | null = null;

const runAggregationAndAnalysis = (allowPrune: boolean) => {
  const now = Date.now();
  const from1m = new Date(now - 5 * 60_000).toISOString();
  const toNow = new Date(now + 1000).toISOString();
  try {
    // M-3：检测心跳超时的主机并仅将其 online 设备降级为 offline（不触碰 standby 硬盘，兼容 12 小时模式）
    const timedOutHosts = runtime.telemetryRepo.detectStaleHostsAndMarkOffline(
      runtime.config.staleAfterSeconds,
      now,
    );
    for (const h of timedOutHosts) {
      for (const deviceId of h.deviceIds) {
        runtime.hub.broadcast(
          "device_status",
          { device_id: deviceId, device_status: "offline", reason: "AGENT_HEARTBEAT_TIMEOUT" },
          { deviceId },
        );
      }
    }

    runtime.aggregationRepo.aggregate1m(from1m, toNow);
    const from1h = new Date(now - 2 * 3_600_000).toISOString();
    runtime.aggregationRepo.aggregate1h(from1h, toNow);

    if (allowPrune && now - lastPruneAtMs >= 3_600_000) {
      const pruned = runtime.aggregationRepo.pruneExpired(
        {
          rawDays: runtime.config.retentionRawDays,
          agg1mDays: runtime.config.retention1mDays,
          agg1hDays: runtime.config.retention1hDays,
          smartDays: runtime.config.retentionSmartDays,
        },
        now,
      );
      lastPruneAtMs = now;
      if (
        pruned.rawDeleted > 0 ||
        pruned.agg1mDeleted > 0 ||
        pruned.agg1hDeleted > 0 ||
        pruned.smartDeleted > 0
      ) {
        console.info(
          JSON.stringify({
            timestamp: new Date(now).toISOString(),
            component: "lhm-api-retention",
            level: "INFO",
            message: "Completed routine batched retention cleanup",
            ...pruned,
          }),
        );
      }
    }
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
};

runtime.ipcProcessor.setOnDataIngested(() => {
  if (ingestDebounce) clearTimeout(ingestDebounce);
  ingestDebounce = setTimeout(() => {
    ingestDebounce = null;
    runAggregationAndAnalysis(false);
  }, 3000);
});

const maintMs = Math.max(runtime.config.maintenanceIntervalSeconds, 60) * 1000;
const aggTimer = setInterval(() => {
  runAggregationAndAnalysis(true);
}, maintMs);

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
    stale_after_seconds: runtime.config.staleAfterSeconds,
    maintenance_interval_seconds: runtime.config.maintenanceIntervalSeconds,
  }),
);

const shutdown = () => {
  if (ingestDebounce) clearTimeout(ingestDebounce);
  clearInterval(aggTimer);
  ipcServer?.stop();
  runtime.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
