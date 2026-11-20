// 系统总览页：展示主机信息、设备与传感器摘要、采集器状态、最近诊断日志，
// 并支持管理员点击「立即全局健康检测」按需唤醒宿主机 Agent 实时采样并触发 Haskell 全局健康评估。
import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type GlobalCheckResult,
  type OverviewResponse,
} from "../lib/api.ts";
import { formatLocalTime, formatUptime } from "../lib/format.ts";
import {
  translateCollectorStatus,
  translateDiagnostic,
  translateLogLevel,
  useI18n,
} from "../lib/i18n.tsx";
import { CapabilityBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function OverviewView({
  data,
  canGlobalCheck = false,
  checking = false,
  checkResult = null,
  onRunGlobalCheck,
}: {
  data: OverviewResponse;
  canGlobalCheck?: boolean;
  checking?: boolean;
  checkResult?: GlobalCheckResult | null;
  onRunGlobalCheck?: () => void;
}) {
  const { locale, t } = useI18n();
  const host = data.hosts[0];

  const resultTone =
    checkResult && (checkResult.severity_counts.critical > 0 || checkResult.degraded)
      ? "banner-err"
      : checkResult && checkResult.severity_counts.warning > 0
        ? "banner-warn"
        : "banner-info";

  return (
    <>
      <div className="panel" style={{ padding: "12px 16px" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            <div>{t("overview.notice")}</div>
            <div style={{ marginTop: 4 }}>{t("overview.globalCheckHint")}</div>
          </div>
          {canGlobalCheck && onRunGlobalCheck && (
            <button
              type="button"
              className="btn"
              disabled={checking}
              onClick={onRunGlobalCheck}
            >
              {checking ? t("overview.globalChecking") : t("overview.globalCheckBtn")}
            </button>
          )}
        </div>
      </div>

      {checkResult && (
        <div className={`banner ${resultTone}`} role="status">
          <strong>
            {t("overview.checkDonePrefix")}
            {formatLocalTime(checkResult.checked_at, locale)}):{" "}
          </strong>
          <span>
            {checkResult.agent_collected
              ? t("overview.checkAgentOk")
              : `${t("overview.checkAgentSkip")}${checkResult.agent_note ? ` (${checkResult.agent_note})` : ""}`}
            {" · "}
            {t("overview.checkSummary")}
            {t("sev.normal")} {checkResult.severity_counts.normal} /{" "}
            {t("sev.warning")} {checkResult.severity_counts.warning} /{" "}
            {t("sev.critical")} {checkResult.severity_counts.critical} /{" "}
            {t("sev.unknown")} {checkResult.severity_counts.unknown}
          </span>
        </div>
      )}

      <div className="card-grid">
        <div className="card">
          <p className="card-title">{t("overview.host")}</p>
          <div className="card-value">{host ? host.hostname : "—"}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            {host
              ? `${host.osName} ${host.osVersion} · ${host.kernelVersion}`
              : t("overview.waitAgent")}
          </div>
        </div>
        <div className="card">
          <p className="card-title">{t("overview.devices")}</p>
          <div className="card-value">{data.device_count}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            {t("overview.sensorCount")}
            {data.sensor_count}
          </div>
        </div>
        <div className="card">
          <p className="card-title">{t("overview.permDeniedDevices")}</p>
          <div className="card-value">{data.coverage_summary.devices_with_permission_denied}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            {t("overview.staleDevices")}
            {data.coverage_summary.devices_with_stale}
          </div>
        </div>
        <div className="card">
          <p className="card-title">{t("overview.uptime")}</p>
          <div className="card-value" style={{ fontSize: 18 }}>
            {host ? formatUptime(host.uptimeSeconds, locale) : "—"}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            {t("overview.lastHeartbeat")}
            {host ? formatLocalTime(host.lastSeenAt, locale) : "—"}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>{t("overview.collectorsTitle")}</h2>
        {data.collectors.length === 0 ? (
          <EmptyState title={t("overview.noCollectors")} description={t("overview.noCollectorsDesc")} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("th.collector")}</th>
                  <th>{t("th.runStatus")}</th>
                  <th>{t("th.capability")}</th>
                  <th>{t("th.interval")}</th>
                  <th>{t("th.failures")}</th>
                  <th>{t("th.lastSuccess")}</th>
                </tr>
              </thead>
              <tbody>
                {data.collectors.map((c) => (
                  <tr key={`${c.hostId}-${c.collectorName}`}>
                    <td className="mono">{c.collectorName}</td>
                    <td>{translateCollectorStatus(locale, c.status)}</td>
                    <td>
                      <CapabilityBadge status={c.capabilityStatus} />
                    </td>
                    <td>{c.intervalSeconds} s</td>
                    <td>{c.consecutiveFailures}</td>
                    <td>{formatLocalTime(c.lastSuccessAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>{t("overview.recentDiagnostics")}</h2>
        {data.recent_diagnostics.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-muted)" }}>{t("overview.noDiagnostics")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("th.time")}</th>
                  <th>{t("th.level")}</th>
                  <th>{t("th.errorCode")}</th>
                  <th>{t("th.device")}</th>
                  <th>{t("th.detailsAndRemediation")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_diagnostics.map((d) => {
                  const localized = translateDiagnostic(locale, d);
                  return (
                    <tr key={d.id}>
                      <td>{formatLocalTime(d.occurredAt, locale)}</td>
                      <td className="mono">{translateLogLevel(locale, d.level)}</td>
                      <td className="mono">{d.errorCode}</td>
                      <td className="mono">{d.deviceId ?? "—"}</td>
                      <td>
                        <div>{localized.message}</div>
                        {localized.remediation && (
                          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                            {t("state.suggestion")}
                            {localized.remediation}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export function OverviewPage({
  canGlobalCheck = false,
  onCheckComplete,
}: {
  canGlobalCheck?: boolean;
  onCheckComplete?: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<GlobalCheckResult | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .overview()
      .then(setData)
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleGlobalCheck = () => {
    setChecking(true);
    setError(null);
    api
      .runGlobalCheck()
      .then((res) => {
        setCheckResult(res);
        return api.overview().then((ov) => {
          setData(ov);
          onCheckComplete?.();
        });
      })
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      )
      .finally(() => setChecking(false));
  };

  if (loading) return <LoadingState message={t("overview.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (!data) return <EmptyState />;
  return (
    <OverviewView
      data={data}
      canGlobalCheck={canGlobalCheck}
      checking={checking}
      checkResult={checkResult}
      onRunGlobalCheck={handleGlobalCheck}
    />
  );
}
