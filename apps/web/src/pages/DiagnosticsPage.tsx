import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type CollectorRow,
  type DiagnosticRow,
} from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import {
  translateCollectorStatus,
  translateDiagnostic,
  translateLogLevel,
  useI18n,
} from "../lib/i18n.tsx";
import { CapabilityBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function DiagnosticsPage() {
  const { locale, t } = useI18n();
  const [collectors, setCollectors] = useState<CollectorRow[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.collectors(), api.diagnostics(100)])
      .then(([c, d]) => {
        setCollectors(c.collectors);
        setDiagnostics(d.diagnostics);
      })
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

  if (loading) return <LoadingState message={t("diag.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;

  return (
    <>
      <div className="panel">
        <h2>{t("diag.collectorsTitle")}</h2>
        {collectors.length === 0 ? (
          <EmptyState title={t("diag.noCollectors")} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("th.collector")}</th>
                  <th>{t("th.runStatus")}</th>
                  <th>{t("th.capability")}</th>
                  <th>{t("th.collectInterval")}</th>
                  <th>{t("th.failures")}</th>
                  <th>{t("th.lastError")}</th>
                  <th>{t("th.lastSuccess")}</th>
                </tr>
              </thead>
              <tbody>
                {collectors.map((c) => (
                  <tr key={`${c.hostId}-${c.collectorName}`}>
                    <td className="mono">{c.collectorName}</td>
                    <td>{translateCollectorStatus(locale, c.status)}</td>
                    <td>
                      <CapabilityBadge status={c.capabilityStatus} />
                    </td>
                    <td>{c.intervalSeconds} s</td>
                    <td>{c.consecutiveFailures}</td>
                    <td className="mono">
                      {c.lastErrorCode ? `${c.lastErrorCode}: ${c.lastErrorMessage ?? ""}` : "—"}
                    </td>
                    <td>{formatLocalTime(c.lastSuccessAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>{t("diag.eventsTitle")}</h2>
        {diagnostics.length === 0 ? (
          <EmptyState title={t("diag.noEvents")} description={t("diag.noEventsDesc")} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("th.time")}</th>
                  <th>{t("th.level")}</th>
                  <th>{t("th.errorCode")}</th>
                  <th>{t("th.collectorDevice")}</th>
                  <th>{t("th.diagAndRemediation")}</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.map((d) => {
                  const localized = translateDiagnostic(locale, d);
                  return (
                    <tr key={d.id}>
                      <td>{formatLocalTime(d.occurredAt, locale)}</td>
                      <td className="mono">{translateLogLevel(locale, d.level)}</td>
                      <td className="mono">{d.errorCode}</td>
                      <td className="mono">
                        {d.collectorName ?? "—"} / {d.deviceId ?? "—"}
                      </td>
                      <td>
                        <div>{localized.message}</div>
                        {localized.remediation && (
                          <div style={{ color: "#93c5fd", fontSize: 12, marginTop: 2 }}>
                            {t("diag.remediationPrefix")}
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
