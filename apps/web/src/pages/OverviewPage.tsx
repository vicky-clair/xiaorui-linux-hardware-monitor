import { useEffect, useState } from "react";
import { api, ApiClientError, type OverviewResponse } from "../lib/api.ts";
import { formatLocalTime, formatUptime } from "../lib/format.ts";
import {
  translateCollectorStatus,
  translateDiagnostic,
  translateLogLevel,
  useI18n,
} from "../lib/i18n.tsx";
import { CapabilityBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function OverviewView({ data }: { data: OverviewResponse }) {
  const { locale, t } = useI18n();
  const host = data.hosts[0];
  return (
    <>
      <div className="banner banner-info">{t("overview.notice")}</div>

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

export function OverviewPage() {
  const { t } = useI18n();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <LoadingState message={t("overview.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (!data) return <EmptyState />;
  return <OverviewView data={data} />;
}
