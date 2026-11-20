import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedNotice,
  WsStatusBanner,
} from "./components/States.tsx";
import {
  CapabilityBadge,
  DeviceStatusBadge,
  QualityBadge,
} from "./components/StatusBadge.tsx";
import { buildTimeSeriesOption } from "./components/TimeSeriesChart.tsx";
import { formatReadingValue, resolveTimeRange } from "./lib/format.ts";
import { I18nProvider, translateAnalysisText, translateDiagnostic } from "./lib/i18n.tsx";
import { AlertsView } from "./pages/AlertsPage.tsx";
import { AnalysisView } from "./pages/AnalysisPage.tsx";
import { ConfigView } from "./pages/ConfigPage.tsx";
import { CoverageView } from "./pages/CoveragePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { OverviewView } from "./pages/OverviewPage.tsx";
import { StorageView } from "./pages/StoragePage.tsx";

describe("Reading formatting & null-vs-zero invariants", () => {
  test("never renders null/missing readings as 0 while preserving valid 0 with unit", () => {
    expect(formatReadingValue(null, "celsius", "missing")).toBe("— (无数据)");
    expect(formatReadingValue(undefined, "watt", "missing")).toBe("— (无数据)");
    expect(formatReadingValue(50, "celsius", "sensor_fault")).toBe("— (传感器故障)");
    expect(formatReadingValue(0, "rpm", "valid")).toBe("0 RPM");
    expect(formatReadingValue(0, "hertz", "valid")).toBe("0 Hz");
    expect(formatReadingValue(42.5, "celsius", "valid")).toBe("42.50 °C");
    expect(formatReadingValue(200_000_000, "hertz", "valid")).toBe("200 MHz");
  });

  test("maps long time ranges to aggregated API granularities", () => {
    expect(resolveTimeRange("15m").granularity).toBe("raw");
    expect(resolveTimeRange("1h").granularity).toBe("raw");
    expect(resolveTimeRange("6h").granularity).toBe("1m");
    expect(resolveTimeRange("24h").granularity).toBe("1m");
    expect(resolveTimeRange("7d").granularity).toBe("1h");
  });

  test("ECharts option enforces connectNulls=false and preserves null gaps", () => {
    const opt = buildTimeSeriesOption(
      [
        {
          name: "Package id 0",
          unit: "celsius",
          points: [
            [1700000000000, 52.0],
            [1700000003000, null],
            [1700000006000, 54.0],
          ],
        },
      ],
      "°C",
    );
    const series = opt.series as Array<{ connectNulls: boolean; data: Array<[number, number | null]> }>;
    expect(series[0]?.connectNulls).toBe(false);
    expect(series[0]?.data[1]?.[1]).toBeNull();
  });
});

describe("Unified UI states, status badges, and WebSocket banner", () => {
  test("renders loading, empty, error, permission denied, and WS disconnected states", () => {
    expect(renderToStaticMarkup(<LoadingState />)).toContain("正在加载");
    expect(renderToStaticMarkup(<EmptyState title="空数据" />)).toContain("空数据");
    expect(
      renderToStaticMarkup(<ErrorState code="SENSOR_NOT_FOUND" message="Not found" />),
    ).toContain("SENSOR_NOT_FOUND");
    expect(
      renderToStaticMarkup(
        <PermissionDeniedNotice subject="RAPL 权限不足" remediation="授予只读权限" />,
      ),
    ).toContain("权限不足");
    expect(renderToStaticMarkup(<WsStatusBanner state="disconnected" />)).toContain(
      "实时推送已断开",
    );
    expect(renderToStaticMarkup(<CapabilityBadge status="permission_denied" />)).toContain(
      "权限不足",
    );
    expect(renderToStaticMarkup(<CapabilityBadge status="unsupported" />)).toContain(
      "硬件不支持",
    );
    expect(renderToStaticMarkup(<DeviceStatusBadge status="standby" />)).toContain(
      "待机（未唤醒）",
    );
    expect(renderToStaticMarkup(<QualityBadge quality="stale" />)).toContain("数据过期");
  });
});

describe("Core page rendering", () => {
  test("renders LoginPage, OverviewView, CoverageView, StorageView (standby + 128-bit), and ConfigView RBAC", () => {
    const loginHtml = renderToStaticMarkup(<LoginPage onAuthenticated={() => {}} />);
    expect(loginHtml).toContain("Linux Hardware Monitor");
    expect(loginHtml).toContain("初始化管理员");

    const overviewHtml = renderToStaticMarkup(
      <OverviewView
        data={{
          hosts: [
            {
              hostId: "host-1",
              hostname: "debian-node",
              osName: "Debian GNU/Linux",
              osVersion: "13.6",
              kernelVersion: "6.12.107+deb13-amd64",
              architecture: "x86_64",
              agentVersion: "0.1.0",
              bootTime: null,
              uptimeSeconds: 7200,
              lastSeenAt: "2026-11-20T10:00:00Z",
            },
          ],
          device_count: 8,
          sensor_count: 29,
          collectors: [],
          recent_diagnostics: [],
          coverage_summary: {
            devices_with_stale: 0,
            devices_with_permission_denied: 3,
          },
        }}
      />,
    );
    expect(overviewHtml).toContain("debian-node");
    expect(overviewHtml).toContain("绝不在前端推断健康状态");

    const analysisHtml = renderToStaticMarkup(
      <AnalysisView
        results={[
          {
            id: 1,
            host_id: "host-1",
            device_id: "cpu-system-0",
            severity: "unknown",
            score: null,
            engine_version: "0.1.0",
            rule_version: "rules-v1",
            threshold_source: "hardware_limit",
            trend: "insufficient_data",
            anomalies: [],
            correlations: [],
            factors: [
              { metric: "quality", delta: 0, reason: "DATA_STALE: expired" },
            ],
            analyzed_at: "2026-11-20T10:00:00Z",
          },
        ]}
        canRun={true}
        running={false}
        onRun={() => {}}
      />,
    );
    expect(analysisHtml).toContain("无法评分");
    expect(analysisHtml).toContain("DATA_STALE");

    const alertsHtml = renderToStaticMarkup(
      <AlertsView
        user={{ user_id: "u1", username: "viewer1", role: "viewer" }}
        alerts={[
          {
            alert_id: "alt-1",
            host_id: "host-1",
            device_id: "cpu-system-0",
            rule_id: "cpu-hot",
            severity: "warning",
            status: "firing",
            summary: "CPU temperature high",
            triggered_at: "2026-11-20T10:00:00Z",
            acknowledged_at: null,
            acknowledged_by: null,
            resolved_at: null,
          },
        ]}
        rules={[]}
        onAck={() => {}}
        onCreateRule={() => {}}
        onDeleteRule={() => {}}
        warning={null}
      />,
    );
    expect(alertsHtml).toContain("CPU temperature high");
    expect(alertsHtml).toContain("只读角色（viewer）");

    const covHtml = renderToStaticMarkup(
      <CoverageView
        data={{
          total_devices: 1,
          total_sensors: 2,
          stale_after_seconds: 60,
          devices: [
            {
              device_id: "cpu-system-0",
              device_name: "Intel N5095A",
              device_status: "online",
              discovered: true,
              has_temperature_capability: false,
              temperature_read_ok: false,
              supported_metrics: ["CPU Utilization"],
              unsupported_metrics: [],
              permission_denied_metrics: ["CPU Package Power (RAPL)"],
              unavailable_metrics: [],
              stale_metrics: ["CPU Utilization"],
              last_success_at: null,
            },
          ],
        }}
      />,
    );
    expect(covHtml).toContain("CPU Package Power (RAPL)");
    expect(covHtml).toContain("Intel N5095A");

    const storageHtml = renderToStaticMarkup(
      <StorageView
        title="存储健康与 SMART"
        items={[
          {
            device: {
              deviceId: "disk-hdd-1",
              hostId: "host-1",
              deviceType: "storage",
              vendor: "HGST",
              model: "HDD",
              name: "HDD (sdb)",
              capabilities: ["capacity"],
              deviceStatus: "standby",
              firstSeenAt: "2026-11-20T10:00:00Z",
              lastSeenAt: "2026-11-20T10:00:00Z",
            },
            latest_smart: {
              id: 1,
              deviceId: "disk-hdd-1",
              devicePath: "/dev/sdb",
              protocolType: "ata",
              deviceStatus: "standby",
              smartPassed: null,
              temperatureCelsius: null,
              powerOnHours: null,
              powerCycles: null,
              dataUnitsRead: "340282366920938463463374607431768211455",
              dataUnitsWritten: null,
              percentageUsed: null,
              availableSpare: null,
              criticalWarning: null,
              collectedAt: "2026-11-20T10:00:00Z",
            },
          },
        ]}
        selectedSmart={null}
        onSelect={() => {}}
      />,
    );
    expect(storageHtml).toContain("待机跳过（未唤醒）");
    expect(storageHtml).toContain("340282366920938463463374607431768211455");
    expect(storageHtml).toContain("— (无数据)");

    const viewerConfigHtml = renderToStaticMarkup(
      <ConfigView
        user={{ user_id: "u1", username: "viewer1", role: "viewer" }}
        config={{
          settings: {},
          defaults: {
            stale_after_seconds: 60,
            retention_raw_days: 14,
            retention_1m_days: 90,
            retention_1h_days: 365,
            retention_smart_days: 365,
          },
        }}
        onSave={() => {}}
        saving={false}
        savedNotice={null}
      />,
    );
    expect(viewerConfigHtml).toContain("只读角色（viewer）");
  });

  test("switches UI and diagnostic/analysis logs cleanly between zh, en, and ja", () => {
    const diagSample = {
      errorCode: "SMART_PERMISSION_DENIED",
      message: "Permission denied running smartctl on /dev/sda",
      remediation: "Grant CAP_SYS_RAWIO via systemd unit (ADR-0006) to enable SMART telemetry",
    };

    const zhDiag = translateDiagnostic("zh", diagSample);
    expect(zhDiag.message).toContain("/dev/sda");
    expect(zhDiag.message).toContain("权限不足");

    const enDiag = translateDiagnostic("en", diagSample);
    expect(enDiag.message).toBe(diagSample.message);

    const jaDiag = translateDiagnostic("ja", diagSample);
    expect(jaDiag.message).toContain("/dev/sda");
    expect(jaDiag.message).toContain("権限が不足");

    expect(translateAnalysisText("ja", "DATA_STALE: expired")).toContain("期限切れ");

    const enHtml = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <LoginPage onAuthenticated={() => {}} />
      </I18nProvider>,
    );
    expect(enHtml).toContain("Bootstrap Admin");
    expect(enHtml).toContain("Sign In");

    const jaHtml = renderToStaticMarkup(
      <I18nProvider initialLocale="ja">
        <LoginPage onAuthenticated={() => {}} />
      </I18nProvider>,
    );
    expect(jaHtml).toContain("初期管理者作成");
    expect(jaHtml).toContain("ログイン");
  });
});
