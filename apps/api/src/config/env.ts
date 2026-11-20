/**
 * API 环境变量配置加载模块：
 * 所有端口、SQLite 路径、Unix Socket 路径、Allowed Origins、Cookie Secure 开关、
 * 数据保留天数与 Haskell 引擎超时时间均在此集中解析并提供安全默认值。
 */
import { dirname, join } from "node:path";

export interface ApiConfig {
  host: string;
  port: number;
  ipcSocketPath: string;
  agentCtrlSocketPath: string;
  dbPath: string;
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  allowedOrigins: string[];
  bootstrapToken: string | null;
  staleAfterSeconds: number;
  maintenanceIntervalSeconds: number;
  retentionRawDays: number;
  retention1mDays: number;
  retention1hDays: number;
  retentionSmartDays: number;
  healthEngineUrl: string;
  healthEngineTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const originsRaw = env.LHM_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173";
  const ipcSocketPath =
    env.LHM_IPC_SOCKET ?? "/run/linux-hardware-monitor/ipc.sock";
  const agentCtrlSocketPath =
    env.LHM_AGENT_CTRL_SOCKET ?? join(dirname(ipcSocketPath), "agent-ctrl.sock");
  return {
    host: env.LHM_API_HOST ?? "127.0.0.1",
    port: Number(env.LHM_API_PORT ?? "3000"),
    ipcSocketPath,
    agentCtrlSocketPath,
    dbPath: env.LHM_DB_PATH ?? "./data/lhm.sqlite",
    cookieSecure: (env.LHM_COOKIE_SECURE ?? "false").toLowerCase() === "true",
    sessionTtlSeconds: Number(env.LHM_SESSION_TTL_SECONDS ?? String(7 * 24 * 3600)),
    allowedOrigins: originsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    bootstrapToken: env.LHM_BOOTSTRAP_TOKEN ?? null,
    staleAfterSeconds: Number(env.LHM_STALE_AFTER_SECONDS ?? "60"),
    maintenanceIntervalSeconds: Number(env.LHM_MAINTENANCE_INTERVAL_SECONDS ?? "3600"),
    retentionRawDays: Number(env.LHM_RETENTION_RAW_DAYS ?? "14"),
    retention1mDays: Number(env.LHM_RETENTION_1M_DAYS ?? "90"),
    retention1hDays: Number(env.LHM_RETENTION_1H_DAYS ?? "365"),
    retentionSmartDays: Number(env.LHM_RETENTION_SMART_DAYS ?? "365"),
    healthEngineUrl: env.LHM_HEALTH_ENGINE_URL ?? "http://127.0.0.1:8090",
    healthEngineTimeoutMs: Number(env.LHM_HEALTH_ENGINE_TIMEOUT_MS ?? "5000"),
  };
}
