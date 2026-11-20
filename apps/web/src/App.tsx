import { useEffect, useState } from "react";
import { SCHEMA_VERSION } from "@lhm/protocol/types";
import { api, type UserInfo } from "./lib/api.ts";
import { formatLocalTime, formatReadingValue } from "./lib/format.ts";
import { useRealtimeStream } from "./lib/ws.ts";
import { LoadingState, WsStatusBanner } from "./components/States.tsx";
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
  | "devices"
  | "coverage"
  | "diagnostics"
  | "config";

const NAV_ITEMS: Array<{ key: PageKey; label: string }> = [
  { key: "overview", label: "系统总览" },
  { key: "cpu", label: "CPU 监控" },
  { key: "gpu", label: "GPU 监控" },
  { key: "motherboard", label: "主板传感器" },
  { key: "memory", label: "内存监控" },
  { key: "storage", label: "存储健康 / SMART" },
  { key: "nvme", label: "NVMe 监控" },
  { key: "temp-history", label: "温度历史" },
  { key: "fans-voltage", label: "风扇与电压" },
  { key: "devices", label: "硬件设备列表" },
  { key: "coverage", label: "传感器覆盖率" },
  { key: "diagnostics", label: "采集器诊断" },
  { key: "config", label: "系统配置" },
];

export function App() {
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
        <LoadingState message="正在检查登录状态..." />
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
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className={`nav-btn ${page === item.key ? "active" : ""}`}
                onClick={() => setPage(item.key)}
              >
                {item.label}
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
                最近推送：{formatLocalTime(stream.lastMessageAt)}
              </span>
            )}
          </div>
          <div className="row">
            <span className="mono" style={{ color: "var(--text-muted)" }}>
              {user.username} ({user.role})
            </span>
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>
              退出登录
            </button>
          </div>
        </header>

        <main className="content">
          {page === "overview" && <OverviewPage />}
          {page === "cpu" && (
            <SensorCategoryPage
              title="CPU 监控"
              deviceTypes={["cpu"]}
              emptyDescription="未发现 CPU 传感器。"
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "gpu" && (
            <SensorCategoryPage
              title="GPU 监控"
              deviceTypes={["gpu"]}
              emptyDescription="当前主机未发现 GPU 设备或 DRM 接口。"
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "motherboard" && (
            <SensorCategoryPage
              title="主板传感器"
              deviceTypes={["motherboard", "system"]}
              emptyDescription="未发现主板 hwmon 或 thermal 传感器。"
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "memory" && (
            <SensorCategoryPage
              title="内存监控"
              deviceTypes={["memory"]}
              emptyDescription="未发现内存监控数据。"
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "storage" && <StoragePage nvmeOnly={false} />}
          {page === "nvme" && <StoragePage nvmeOnly={true} />}
          {page === "temp-history" && <TemperatureHistoryPage />}
          {page === "fans-voltage" && (
            <SensorCategoryPage
              title="风扇与电压"
              sensorTypes={["fan_speed", "voltage", "power", "current"]}
              emptyDescription="当前主机未暴露风扇转速、电压或功耗传感器（部分平台无 Super I/O 或电源遥测）。"
              liveReadings={stream.latestBySensor}
            />
          )}
          {page === "devices" && <DevicesPage />}
          {page === "coverage" && <CoveragePage />}
          {page === "diagnostics" && <DiagnosticsPage />}
          {page === "config" && <ConfigPage user={user} />}
        </main>
      </div>
    </div>
  );
}
