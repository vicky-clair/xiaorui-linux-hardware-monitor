// 控制台根组件：负责登录鉴权状态、左侧导航、WebSocket 实时流、全局红/橙色告警提示与页面路由。
// 严格遵循架构约束：前端仅展示后端 API 与 Haskell 引擎下发的状态，绝不在前端推断硬件健康。
import { useCallback, useEffect, useState } from "react";
import { SCHEMA_VERSION } from "@lhm/protocol/types";
import { api, type AlertRow, type AnalysisRow, type UserInfo } from "./lib/api.ts";
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

/** 全局顶部红/橙色健康与告警横幅（仅按后端返回结果渲染，供任意页面实时可见） */
export function GlobalAlertBanner({
  alerts,
  analysis,
  onNavigate,
}: {
  alerts: AlertRow[];
  analysis: AnalysisRow[];
  onNavigate: (page: PageKey) => void;
}) {
  const { t } = useI18n();
  const firingAlerts = alerts.filter((a) => a.status === "firing");
  const criticalDevices = analysis.filter((r) => r.severity === "critical");
  const warningDevices = analysis.filter((r) => r.severity === "warning");

  if (firingAlerts.length === 0 && criticalDevices.length === 0 && warningDevices.length === 0) {
    return null;
  }

  const isCritical = firingAlerts.length > 0 || criticalDevices.length > 0;
  const parts: string[] = [];
  if (firingAlerts.length > 0) {
    parts.push(`${firingAlerts.length} ${t("shell.globalAlertFiringCount")}`);
  }
  if (criticalDevices.length > 0) {
    parts.push(`${criticalDevices.length} ${t("shell.globalAlertCritDevCount")}`);
  }
  if (warningDevices.length > 0) {
    parts.push(`${warningDevices.length} ${t("shell.globalAlertWarnDevCount")}`);
  }

  return (
    <div
      className={`banner ${isCritical ? "banner-err" : "banner-warn"} alert-banner-global`}
      role="alert"
    >
      <div>
        {isCritical && <span className="pulse-dot" aria-hidden="true" />}
        <strong>
          {isCritical ? t("shell.globalAlertCritical") : t("shell.globalAlertWarning")}
        </strong>
        <span>{parts.join(" · ")}</span>
        {firingAlerts[0] && (
          <span className="mono" style={{ marginLeft: 10 }}>
            [{firingAlerts[0].device_id}] {firingAlerts[0].summary}
          </span>
        )}
      </div>
      <div className="row">
        {firingAlerts.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigate("alerts")}
          >
            {t("shell.viewAlerts")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onNavigate("analysis")}
        >
          {t("shell.viewAnalysis")}
        </button>
      </div>
    </div>
  );
}

export function App() {
  const { locale, t } = useI18n();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [page, setPage] = useState<PageKey>("overview");
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisRow[]>([]);

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  const stream = useRealtimeStream(user !== null);

  // 定期拉取告警与最新 Haskell 分析摘要（每 30s），用于全局红色横幅与侧边栏计数角标
  const refreshGlobalStatus = useCallback(() => {
    if (!user) return;
    Promise.all([api.alerts().catch(() => null), api.analysis().catch(() => null)]).then(
      ([aRes, anRes]) => {
        if (aRes) setAlerts(aRes.alerts);
        if (anRes) setAnalysis(anRes.results);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      setAlerts([]);
      setAnalysis([]);
      return;
    }
    refreshGlobalStatus();
    // 超低开销：每 5 分钟轻量刷新一次全局告警与分析摘要（不频繁轮询 API）
    const timer = window.setInterval(refreshGlobalStatus, 300_000);
    return () => window.clearInterval(timer);
  }, [user, refreshGlobalStatus]);

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

  const firingCount = alerts.filter((a) => a.status === "firing").length;
  const unhealthyCount = analysis.filter(
    (r) => r.severity === "critical" || r.severity === "warning",
  ).length;
  const hasCritical = analysis.some((r) => r.severity === "critical");

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
                <span>{t(`nav.${key}`)}</span>
                {key === "alerts" && firingCount > 0 && (
                  <span className="nav-badge-err">{firingCount}</span>
                )}
                {key === "analysis" && unhealthyCount > 0 && (
                  <span className={hasCritical ? "nav-badge-err" : "nav-badge-warn"}>
                    {unhealthyCount}
                  </span>
                )}
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
          <GlobalAlertBanner alerts={alerts} analysis={analysis} onNavigate={setPage} />

          {page === "overview" && (
            <OverviewPage
              canGlobalCheck={user.role === "admin"}
              onCheckComplete={refreshGlobalStatus}
            />
          )}
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
