export interface ApiConfig {
  host: string;
  port: number;
  ipcSocketPath: string;
  dbPath: string;
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  allowedOrigins: string[];
  bootstrapToken: string | null;
  staleAfterSeconds: number;
  retentionRawDays: number;
  retention1mDays: number;
  retention1hDays: number;
  retentionSmartDays: number;
  healthEngineUrl: string;
  healthEngineTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const originsRaw = env.LHM_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173";
  return {
    host: env.LHM_API_HOST ?? "127.0.0.1",
    port: Number(env.LHM_API_PORT ?? "3000"),
    ipcSocketPath:
      env.LHM_IPC_SOCKET ?? "/run/linux-hardware-monitor/ipc.sock",
    dbPath: env.LHM_DB_PATH ?? "./data/lhm.sqlite",
    cookieSecure: (env.LHM_COOKIE_SECURE ?? "false").toLowerCase() === "true",
    sessionTtlSeconds: Number(env.LHM_SESSION_TTL_SECONDS ?? String(7 * 24 * 3600)),
    allowedOrigins: originsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    bootstrapToken: env.LHM_BOOTSTRAP_TOKEN ?? null,
    staleAfterSeconds: Number(env.LHM_STALE_AFTER_SECONDS ?? "60"),
    retentionRawDays: Number(env.LHM_RETENTION_RAW_DAYS ?? "14"),
    retention1mDays: Number(env.LHM_RETENTION_1M_DAYS ?? "90"),
    retention1hDays: Number(env.LHM_RETENTION_1H_DAYS ?? "365"),
    retentionSmartDays: Number(env.LHM_RETENTION_SMART_DAYS ?? "365"),
    healthEngineUrl: env.LHM_HEALTH_ENGINE_URL ?? "http://127.0.0.1:8090",
    healthEngineTimeoutMs: Number(env.LHM_HEALTH_ENGINE_TIMEOUT_MS ?? "5000"),
  };
}
