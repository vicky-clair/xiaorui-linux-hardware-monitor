import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type AnalysisRow,
  type UserInfo,
} from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import {
  translateAnalysisText,
  translateThresholdSource,
  translateTrend,
  useI18n,
} from "../lib/i18n.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function AnalysisView({
  results,
  canRun,
  running,
  onRun,
}: {
  results: AnalysisRow[];
  canRun: boolean;
  running: boolean;
  onRun: () => void;
}) {
  const { locale, t } = useI18n();

  const severityBadge = (sev: AnalysisRow["severity"]) => {
    switch (sev) {
      case "normal":
        return <span className="badge badge-ok">{t("sev.normal")}</span>;
      case "warning":
        return <span className="badge badge-warn">{t("sev.warning")}</span>;
      case "critical":
        return <span className="badge badge-err">{t("sev.critical")}</span>;
      default:
        return <span className="badge badge-muted">{t("sev.unknown")}</span>;
    }
  };

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{t("analysis.title")}</h2>
        {canRun && (
          <button type="button" className="btn" disabled={running} onClick={onRun}>
            {running ? t("analysis.running") : t("analysis.runNow")}
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <EmptyState title={t("analysis.empty")} description={t("analysis.emptyDesc")} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("th.deviceId")}</th>
                <th>{t("th.severityLevel")}</th>
                <th>{t("th.score")}</th>
                <th>{t("th.trend")}</th>
                <th>{t("th.thresholdSource")}</th>
                <th>{t("th.evidence")}</th>
                <th>{t("th.versionTime")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const rowClass =
                  r.severity === "critical"
                    ? "row-critical"
                    : r.severity === "warning"
                      ? "row-warning"
                      : undefined;
                const scoreClass =
                  r.severity === "critical"
                    ? "mono text-danger"
                    : r.severity === "warning"
                      ? "mono text-warn"
                      : "mono";
                return (
                  <tr key={r.id} className={rowClass}>
                    <td className={r.severity === "critical" ? "mono text-danger" : "mono"}>
                      {r.device_id}
                    </td>
                    <td>{severityBadge(r.severity)}</td>
                    <td className={scoreClass} style={{ fontWeight: 700 }}>
                      {r.score !== null ? `${r.score.toFixed(1)} / 100` : t("analysis.unscorable")}
                    </td>
                    <td>{translateTrend(locale, r.trend)}</td>
                    <td>{translateThresholdSource(locale, r.threshold_source)}</td>
                    <td>
                      {r.factors.map((f, idx) => (
                        <div
                          key={idx}
                          style={{ fontSize: 12 }}
                          className={f.delta <= -40 ? "text-danger" : f.delta < 0 ? "text-warn" : undefined}
                        >
                          <span className="mono">
                            [{f.metric} {f.delta >= 0 ? `+${f.delta}` : f.delta}]
                          </span>{" "}
                          {translateAnalysisText(locale, f.reason)}
                        </div>
                      ))}
                      {r.anomalies.map((a, idx) => (
                        <div key={`a-${idx}`} style={{ fontSize: 12, color: "#fcd34d" }}>
                          {t("analysis.anomalyPrefix")} {a.code}:{" "}
                          {translateAnalysisText(locale, a.reason)}
                        </div>
                      ))}
                      {r.correlations.map((c, idx) => (
                        <div key={`c-${idx}`} style={{ fontSize: 12, color: "#fca5a5" }}>
                          {t("analysis.correlationPrefix")} {c.code}:{" "}
                          {translateAnalysisText(locale, c.summary)}
                        </div>
                      ))}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      <div className="mono">
                        engine={r.engine_version} · {r.rule_version}
                      </div>
                      <div>{formatLocalTime(r.analyzed_at, locale)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AnalysisPage({ user }: { user: UserInfo }) {
  const { t } = useI18n();
  const [results, setResults] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .analysis()
      .then((res) => setResults(res.results))
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

  const handleRun = () => {
    setRunning(true);
    setError(null);
    api
      .runAnalysis()
      .then(() => load())
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      )
      .finally(() => setRunning(false));
  };

  if (loading) return <LoadingState message={t("analysis.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  return (
    <AnalysisView
      results={results}
      canRun={user.role === "admin"}
      running={running}
      onRun={handleRun}
    />
  );
}
