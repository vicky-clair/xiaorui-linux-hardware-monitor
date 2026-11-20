import { useEffect, useState } from "react";
import { SCHEMA_VERSION } from "@lhm/protocol/types";
import { api, type UserInfo } from "./lib/api.ts";
import { formatLocalTime, formatReadingValue } from "./lib/format.ts";
import { LanguageSwitcher, useI18n } from "./lib/i18n.tsx";
import { useRealtimeStream } from "./lib/ws.ts";
import { LoadingState, WsStatusBanner } from "./components/States.tsx";
import { AlertsPage } from "./pages/AlertsPage.tsx";
import { AnalysisPage } from "./pages/AnalysisPage.tsx";
import { ConfigPage } from "./pages/ConfigPage.tsx";
import { CoveragePage } from "./pages/CoveragePage.tsx";
import { DevicesPage } from "./pages/DevicesPage.tsx";
import { DiagnosticsPage } from "./pages/DiagnosticsPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { SensorCategoryPage } from "./pages/SensorCategoryPage.tsx";
import { StoragePage } from "./pages/StoragePage.tsx";
import { TemperatureHistoryPage } from "./pages/TemperatureHistoryPage.tsx";

export { formatReadingValue };

export type PageKey =
  | "overview"
  | "cpu"
  | "gpu"
  | "motherboard"
  | "memory"
  | "storage"
  | "nvme"
  | "temp-history"
  | "fans-voltage"
  | "alerts"
  | "analysis"
  | "devices"
  | "coverage"
  | "diagnostics"
  | "config";

const NAV_KEYS: PageKey[] = [
  "overview",
  "cpu",
  "gpu",
  "motherboard",
  "memory",
  "storage",
  "nvme",
  "temp-history",
  "fans-voltage",
  "alerts",
  "analysis",
  "devices",
  "coverage",
  "diagnostics",
  "config",
];

export function App() {
  const { locale, t } = useI18n();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [page, setPage] = useState<PageKey>("overview");

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  const stream = useRealtimeStream(user !== null);

  if (checkingAuth) {
    return (
      <div className="auth-shell">
        <LoadingState message={t("shell.checkingAuth")} />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onAuthenticated={setUser} />;
  }

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Linux Hardware Monitor
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
            Protocol v{SCHEMA_VERSION}
          </div>
        </div>
        <ul className="nav-list">
          {NAV_KEYS.map((key) => (
            <li key={key}>
              <button
                type="button"
                className={`nav-btn ${page === key ? "active" : ""}`}
                onClick={() => setPage(key)}
              >
                {t(`nav.${key}`)}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="row">
            <WsStatusBanner state={stream.connectionState} />
            {stream.lastMessageAt && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("shell.lastPush")}
                {formatLocalTime(stream.lastMessageAt, locale)}
              </span>
            )}
          </div>
          <div className="row">
            <LanguageSwitcher />
            <span className="mono" style={{ color: "var(--text-muted)" }}>
              {user.username} ({user.role})
            </span>
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>
              {t("shell.logout")}
            </button>
          </div>
        </header>

        <main className="content">
          {page === "overview" && <OverviewPage />}
          {page === "cpu" && (
            <SensorCategoryPage
              categoryKey="cpu"
              title={t("nav.cpu")}
              deviceTypes={["cpu"]}
              emptyDescription={t("empty.cpu")}
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "gpu" && (
            <SensorCategoryPage
              categoryKey="gpu"
              title={t("nav.gpu")}
              deviceTypes={["gpu"]}
              emptyDescription={t("empty.gpu")}
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "motherboard" && (
            <SensorCategoryPage
              categoryKey="motherboard"
              title={t("nav.motherboard")}
              deviceTypes={["motherboard", "system"]}
              emptyDescription={t("empty.motherboard")}
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "memory" && (
            <SensorCategoryPage
              categoryKey="memory"
              title={t("nav.memory")}
              deviceTypes={["memory"]}
              emptyDescription={t("empty.memory")}
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "storage" && <StoragePage nvmeOnly={false} />}
          {page === "nvme" && <StoragePage nvmeOnly={true} />}
          {page === "temp-history" && <TemperatureHistoryPage />}
          {page === "fans-voltage" && (
            <SensorCategoryPage
              categoryKey="fans-voltage"
              title={t("nav.fans-voltage")}
              sensorTypes={["fan_speed", "voltage", "power", "current"]}
              emptyDescription={t("empty.fansVoltage")}
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "alerts" && <AlertsPage user={user} />}
          {page === "analysis" && <AnalysisPage user={user} />}
          {page === "devices" && <DevicesPage />}
          {page === "coverage" && <CoveragePage />}
          {page === "diagnostics" && <DiagnosticsPage />}
          {page === "config" && <ConfigPage user={user} />}
        </main>
      </div>
    </div>
  );
}
