import { Elysia } from "elysia";
import { AuthService } from "./auth/service.ts";
import { loadConfig, type ApiConfig } from "./config/env.ts";
import { IpcProcessor } from "./ipc/processor.ts";
import { errorResponse } from "./middleware/envelope.ts";
import { AggregationRepository } from "./repositories/aggregationRepo.ts";
import { AlertRepository } from "./repositories/alertRepo.ts";
import { AuthRepository } from "./repositories/authRepo.ts";
import { openDatabase, type DatabaseHandle } from "./repositories/db.ts";
import { TelemetryRepository } from "./repositories/telemetryRepo.ts";
import { createAlertRoutes } from "./routes/alerts.ts";
import { createAuthRoutes } from "./routes/auth.ts";
import { createExtensionRoutes } from "./routes/extensions.ts";
import { healthRoute } from "./routes/health.ts";
import { createTelemetryRoutes } from "./routes/telemetry.ts";
import { HealthAnalysisService } from "./services/healthClient.ts";
import { AlertNotifier } from "./services/notifier.ts";
import { RealtimeHub } from "./websocket/hub.ts";

export interface AppRuntime {
  app: ReturnType<typeof buildElysiaApp>;
  config: ApiConfig;
  dbHandle: DatabaseHandle;
  telemetryRepo: TelemetryRepository;
  aggregationRepo: AggregationRepository;
  alertRepo: AlertRepository;
  authRepo: AuthRepository;
  authService: AuthService;
  healthService: HealthAnalysisService;
  notifier: AlertNotifier;
  ipcProcessor: IpcProcessor;
  hub: RealtimeHub;
  close: () => void;
}

function buildElysiaApp(deps: {
  config: ApiConfig;
  authService: AuthService;
  authRepo: AuthRepository;
  alertRepo: AlertRepository;
  healthService: HealthAnalysisService;
  notifier: AlertNotifier;
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
    .use(createTelemetryRoutes(deps))
    .use(createAlertRoutes(deps))
    .use(createExtensionRoutes(deps));
}

export function createAppRuntime(overrides?: Partial<ApiConfig>): AppRuntime {
  const config: ApiConfig = { ...loadConfig(), ...overrides };
  const dbHandle = openDatabase(config.dbPath);
  const telemetryRepo = new TelemetryRepository(dbHandle);
  const aggregationRepo = new AggregationRepository(dbHandle);
  const alertRepo = new AlertRepository(dbHandle);
  const authRepo = new AuthRepository(dbHandle);
  const authService = new AuthService(authRepo, config);
  const notifier = new AlertNotifier(authRepo);
  const hub = new RealtimeHub();
  const ipcProcessor = new IpcProcessor(telemetryRepo, hub);
  const healthService = new HealthAnalysisService(
    config,
    telemetryRepo,
    alertRepo,
    hub,
    notifier,
  );

  const app = buildElysiaApp({
    config,
    authService,
    authRepo,
    alertRepo,
    healthService,
    notifier,
    telemetryRepo,
    hub,
  });

  return {
    app,
    config,
    dbHandle,
    telemetryRepo,
    aggregationRepo,
    alertRepo,
    authRepo,
    authService,
    healthService,
    notifier,
    ipcProcessor,
    hub,
    close: () => dbHandle.close(),
  };
}

/** Convenience helper for lightweight tests using in-memory SQLite. */
export function createApp(overrides?: Partial<ApiConfig>) {
  return createAppRuntime({ dbPath: ":memory:", ...overrides }).app;
}
