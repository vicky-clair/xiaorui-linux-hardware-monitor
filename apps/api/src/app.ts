import { Elysia } from "elysia";
import { AuthService } from "./auth/service.ts";
import { loadConfig, type ApiConfig } from "./config/env.ts";
import { IpcProcessor } from "./ipc/processor.ts";
import { errorResponse } from "./middleware/envelope.ts";
import { AggregationRepository } from "./repositories/aggregationRepo.ts";
import { AuthRepository } from "./repositories/authRepo.ts";
import { openDatabase, type DatabaseHandle } from "./repositories/db.ts";
import { TelemetryRepository } from "./repositories/telemetryRepo.ts";
import { createAuthRoutes } from "./routes/auth.ts";
import { healthRoute } from "./routes/health.ts";
import { createTelemetryRoutes } from "./routes/telemetry.ts";
import { RealtimeHub } from "./websocket/hub.ts";

export interface AppRuntime {
  app: ReturnType<typeof buildElysiaApp>;
  config: ApiConfig;
  dbHandle: DatabaseHandle;
  telemetryRepo: TelemetryRepository;
  aggregationRepo: AggregationRepository;
  authRepo: AuthRepository;
  authService: AuthService;
  ipcProcessor: IpcProcessor;
  hub: RealtimeHub;
  close: () => void;
}

function buildElysiaApp(deps: {
  config: ApiConfig;
  authService: AuthService;
  authRepo: AuthRepository;
  telemetryRepo: TelemetryRepository;
  hub: RealtimeHub;
}) {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (code === "NOT_FOUND") {
        set.status = 404;
        return errorResponse("NOT_FOUND", "Endpoint not found");
      }
      set.status = 500;
      const message =
        error instanceof Error ? error.message : "Unexpected internal error";
      return errorResponse("INTERNAL_ERROR", message);
    })
    .use(healthRoute)
    .use(createAuthRoutes(deps.authService, deps.authRepo))
    .use(createTelemetryRoutes(deps));
}

export function createAppRuntime(overrides?: Partial<ApiConfig>): AppRuntime {
  const config: ApiConfig = { ...loadConfig(), ...overrides };
  const dbHandle = openDatabase(config.dbPath);
  const telemetryRepo = new TelemetryRepository(dbHandle);
  const aggregationRepo = new AggregationRepository(dbHandle);
  const authRepo = new AuthRepository(dbHandle);
  const authService = new AuthService(authRepo, config);
  const hub = new RealtimeHub();
  const ipcProcessor = new IpcProcessor(telemetryRepo, hub);

  const app = buildElysiaApp({
    config,
    authService,
    authRepo,
    telemetryRepo,
    hub,
  });

  return {
    app,
    config,
    dbHandle,
    telemetryRepo,
    aggregationRepo,
    authRepo,
    authService,
    ipcProcessor,
    hub,
    close: () => dbHandle.close(),
  };
}

/** Convenience helper for lightweight Phase 0/2 tests using in-memory SQLite. */
export function createApp(overrides?: Partial<ApiConfig>) {
  return createAppRuntime({ dbPath: ":memory:", ...overrides }).app;
}
