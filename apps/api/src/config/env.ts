export interface ApiConfig {
  host: string;
  port: number;
  ipcSocketPath: string;
  dbPath: string;
}

export function loadConfig(): ApiConfig {
  return {
    host: process.env.LHM_API_HOST ?? "127.0.0.1",
    port: Number(process.env.LHM_API_PORT ?? "3000"),
    ipcSocketPath:
      process.env.LHM_IPC_SOCKET ?? "/run/linux-hardware-monitor/ipc.sock",
    dbPath: process.env.LHM_DB_PATH ?? "./data/lhm.sqlite",
  };
}
