// 告警中心与规则管理页：展示 Haskell 引擎状态机生成的告警记录（firing 行红字高亮），
// 支持管理员按设备类型（CPU / GPU / 存储 / 主板）创建规则或一键应用推荐安全规则集。
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

const RECOMMENDED_RULES: Array<Omit<AlertRuleRow, "enabled">> = [
  {
    rule_id: "cpu-temp-warn",
    metric: "temperature",
    device_type: "cpu",
    device_id: null,
    operator: "gte",
    threshold: 80,
    unit: "celsius",
    duration_seconds: 60,
    severity: "warning",
  },
  {
    rule_id: "cpu-temp-crit",
    metric: "temperature",
    device_type: "cpu",
    device_id: null,
    operator: "gte",
    threshold: 90,
    unit: "celsius",
    duration_seconds: 30,
    severity: "critical",
  },
  {
    rule_id: "storage-temp-warn",
    metric: "temperature",
    device_type: "storage",
    device_id: null,
    operator: "gte",
    threshold: 55,
    unit: "celsius",
    duration_seconds: 120,
    severity: "warning",
  },
  {
    rule_id: "storage-temp-crit",
    metric: "temperature",
    device_type: "storage",
    device_id: null,
    operator: "gte",
    threshold: 65,
    unit: "celsius",
    duration_seconds: 60,
    severity: "critical",
  },
  {
    rule_id: "gpu-temp-warn",
    metric: "temperature",
    device_type: "gpu",
    device_id: null,
    operator: "gte",
    threshold: 85,
    unit: "celsius",
    duration_seconds: 60,
    severity: "warning",
  },
  {
    rule_id: "motherboard-temp-warn",
    metric: "temperature",
    device_type: "motherboard",
    device_id: null,
    operator: "gte",
    threshold: 75,
    unit: "celsius",
    duration_seconds: 60,
    severity: "warning",
  },
];

export function AlertsView({
  user,
  alerts,
  rules,
  onAck,
  onCreateRule,
  onDeleteRule,
  onApplyPresets,
  warning,
  presetNotice,
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
  onApplyPresets?: () => void;
  warning: string | null;
  presetNotice?: string | null;
}) {
  const { locale, t } = useI18n();
  const [ruleId, setRuleId] = useState("cpu-temp-warn");
  const [deviceType, setDeviceType] = useState<AlertRuleRow["device_type"]>("cpu");
  const [severity, setSeverity] = useState<AlertRuleRow["severity"]>("warning");
  const [threshold, setThreshold] = useState("80");
  const [duration, setDuration] = useState("60");
  const isAdmin = user.role === "admin";

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    onCreateRule({
      rule_id: ruleId.trim(),
      metric: "temperature",
      device_type: deviceType,
      device_id: null,
      operator: "gte",
      threshold: Number(threshold),
      unit: "celsius",
      duration_seconds: Number(duration),
      severity,
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
                {alerts.map((a) => {
                  const isFiring = a.status === "firing";
                  return (
                    <tr key={a.alert_id} className={isFiring ? "row-critical" : undefined}>
                      <td>
                        <span className={`badge ${isFiring ? "badge-err" : "badge-ok"}`}>
                          {t(`alertStatus.${a.status}`)}
                        </span>
                      </td>
                      <td className={`mono ${a.severity === "critical" ? "text-danger" : a.severity === "warning" ? "text-warn" : ""}`}>
                        {t(`sev.${a.severity}`)}
                      </td>
                      <td className="mono">
                        <div>{a.device_id}</div>
                        <div style={{ color: "var(--text-muted)" }}>{a.rule_id}</div>
                      </td>
                      <td className={isFiring ? "text-danger" : undefined}>{a.summary}</td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{t("alerts.rulesTitle")}</h2>
          {isAdmin && onApplyPresets && (
            <button type="button" className="btn btn-secondary" onClick={onApplyPresets}>
              {t("alerts.presetBtn")}
            </button>
          )}
        </div>
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
        {presetNotice && (
          <div className="banner banner-info" style={{ marginBottom: 12 }}>
            {presetNotice}
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
            <select
              aria-label={t("th.deviceType")}
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value as AlertRuleRow["device_type"])}
            >
              <option value="cpu">CPU</option>
              <option value="storage">Storage</option>
              <option value="gpu">GPU</option>
              <option value="motherboard">Motherboard</option>
            </select>
            <select
              aria-label={t("th.severity")}
              value={severity}
              onChange={(e) => setSeverity(e.target.value as AlertRuleRow["severity"])}
            >
              <option value="warning">{t("sev.warning")}</option>
              <option value="critical">{t("sev.critical")}</option>
            </select>
            <input
              type="number"
              required
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={t("alerts.thresholdPlaceholder")}
              style={{ width: 110 }}
            />
            <input
              type="number"
              required
              min={0}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder={t("alerts.durationPlaceholder")}
              style={{ width: 100 }}
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
                    <td
                      className={`mono ${
                        r.severity === "critical"
                          ? "text-danger"
                          : r.severity === "warning"
                            ? "text-warn"
                            : ""
                      }`}
                    >
                      {t(`sev.${r.severity}`)}
                    </td>
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
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
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
    setPresetNotice(null);
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

  const handleApplyPresets = async () => {
    setPresetNotice(null);
    setError(null);
    const existingIds = new Set(rules.map((r) => r.rule_id));
    try {
      for (const preset of RECOMMENDED_RULES) {
        if (!existingIds.has(preset.rule_id)) {
          await api.createAlertRule(preset);
        }
      }
      setPresetNotice(t("alerts.presetDone"));
      load();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? { code: err.code, message: err.message }
          : { message: String(err) },
      );
    }
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
      onApplyPresets={handleApplyPresets}
      warning={warning}
      presetNotice={presetNotice}
    />
  );
}
