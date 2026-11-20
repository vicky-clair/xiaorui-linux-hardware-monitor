import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiClientError,
  type AlertRow,
  type AlertRuleRow,
  type UserInfo,
} from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import { useI18n } from "../lib/i18n.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedNotice,
} from "../components/States.tsx";

export function AlertsView({
  user,
  alerts,
  rules,
  onAck,
  onCreateRule,
  onDeleteRule,
  warning,
}: {
  user: UserInfo;
  alerts: AlertRow[];
  rules: AlertRuleRow[];
  onAck: (id: string) => void;
  onCreateRule: (rule: {
    rule_id: string;
    metric: string;
    device_type: AlertRuleRow["device_type"];
    device_id: string | null;
    operator: AlertRuleRow["operator"];
    threshold: number;
    unit: AlertRuleRow["unit"];
    duration_seconds: number;
    severity: AlertRuleRow["severity"];
  }) => void;
  onDeleteRule: (ruleId: string) => void;
  warning: string | null;
}) {
  const { locale, t } = useI18n();
  const [ruleId, setRuleId] = useState("cpu-temp-warn");
  const [threshold, setThreshold] = useState("80");
  const [duration, setDuration] = useState("60");
  const isAdmin = user.role === "admin";

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    onCreateRule({
      rule_id: ruleId.trim(),
      metric: "temperature",
      device_type: "cpu",
      device_id: null,
      operator: "gte",
      threshold: Number(threshold),
      unit: "celsius",
      duration_seconds: Number(duration),
      severity: "warning",
    });
  };

  return (
    <>
      <div className="panel">
        <h2>{t("alerts.title")}</h2>
        {alerts.length === 0 ? (
          <EmptyState title={t("alerts.empty")} description={t("alerts.emptyDesc")} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("th.status")}</th>
                  <th>{t("th.severity")}</th>
                  <th>{t("th.deviceRule")}</th>
                  <th>{t("th.summary")}</th>
                  <th>{t("th.triggeredAt")}</th>
                  <th>{t("th.ackInfo")}</th>
                  <th>{t("th.action")}</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.alert_id}>
                    <td>
                      <span
                        className={`badge ${a.status === "firing" ? "badge-err" : "badge-ok"}`}
                      >
                        {t(`alertStatus.${a.status}`)}
                      </span>
                    </td>
                    <td className="mono">{t(`sev.${a.severity}`)}</td>
                    <td className="mono">
                      <div>{a.device_id}</div>
                      <div style={{ color: "var(--text-muted)" }}>{a.rule_id}</div>
                    </td>
                    <td>{a.summary}</td>
                    <td>{formatLocalTime(a.triggered_at, locale)}</td>
                    <td>
                      {a.acknowledged_by
                        ? `${a.acknowledged_by} (${formatLocalTime(a.acknowledged_at, locale)})`
                        : t("alerts.unacked")}
                    </td>
                    <td>
                      {!a.acknowledged_at && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => onAck(a.alert_id)}
                        >
                          {t("alerts.ackBtn")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>{t("alerts.rulesTitle")}</h2>
        {!isAdmin && (
          <div style={{ marginBottom: 12 }}>
            <PermissionDeniedNotice
              subject={t("alerts.viewerDenied")}
              remediation={t("alerts.viewerRemediation")}
            />
          </div>
        )}
        {warning && (
          <div className="banner banner-warn" style={{ marginBottom: 12 }}>
            {t("alerts.warningPrefix")}
            {warning}
          </div>
        )}

        {isAdmin && (
          <form className="row" onSubmit={handleCreate} style={{ marginBottom: 14 }}>
            <input
              type="text"
              required
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              placeholder={t("alerts.ruleIdPlaceholder")}
            />
            <input
              type="number"
              required
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={t("alerts.thresholdPlaceholder")}
              style={{ width: 120 }}
            />
            <input
              type="number"
              required
              min={0}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder={t("alerts.durationPlaceholder")}
              style={{ width: 110 }}
            />
            <button type="submit" className="btn">
              {t("alerts.addRuleBtn")}
            </button>
          </form>
        )}

        {rules.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-muted)" }}>{t("alerts.noRules")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("th.ruleId")}</th>
                  <th>{t("th.deviceType")}</th>
                  <th>{t("th.metricCond")}</th>
                  <th>{t("th.duration")}</th>
                  <th>{t("th.severity")}</th>
                  {isAdmin && <th>{t("th.action")}</th>}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.rule_id}>
                    <td className="mono">{r.rule_id}</td>
                    <td className="mono">{r.device_type}</td>
                    <td className="mono">
                      {r.metric} {r.operator} {r.threshold} {r.unit}
                    </td>
                    <td>{r.duration_seconds} s</td>
                    <td className="mono">{t(`sev.${r.severity}`)}</td>
                    {isAdmin && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => onDeleteRule(r.rule_id)}
                        >
                          {t("alerts.deleteBtn")}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export function AlertsPage({ user }: { user: UserInfo }) {
  const { t } = useI18n();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [rules, setRules] = useState<AlertRuleRow[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.alerts(), api.alertRules()])
      .then(([a, r]) => {
        setAlerts(a.alerts);
        setRules(r.rules);
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

  const handleAck = (id: string) => {
    api.ackAlert(id).then(load).catch((err) => setError({ message: String(err) }));
  };

  const handleCreateRule = (rule: Omit<AlertRuleRow, "enabled">) => {
    setWarning(null);
    api
      .createAlertRule(rule)
      .then((res) => {
        setWarning(res.warning);
        load();
      })
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      );
  };

  const handleDeleteRule = (id: string) => {
    api.deleteAlertRule(id).then(load).catch((err) => setError({ message: String(err) }));
  };

  if (loading) return <LoadingState message={t("alerts.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  return (
    <AlertsView
      user={user}
      alerts={alerts}
      rules={rules}
      onAck={handleAck}
      onCreateRule={handleCreateRule}
      onDeleteRule={handleDeleteRule}
      warning={warning}
    />
  );
}
