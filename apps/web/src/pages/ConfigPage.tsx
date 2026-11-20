import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiClientError,
  type ConfigResponse,
  type UserInfo,
} from "../lib/api.ts";
import {
  ErrorState,
  LoadingState,
  PermissionDeniedNotice,
} from "../components/States.tsx";

export function ConfigView({
  user,
  config,
  onSave,
  saving,
  savedNotice,
}: {
  user: UserInfo;
  config: ConfigResponse;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
  savedNotice: string | null;
}) {
  const [staleSec, setStaleSec] = useState(
    String(config.settings.stale_after_seconds ?? config.defaults.stale_after_seconds),
  );
  const [rawDays, setRawDays] = useState(
    String(config.settings.retention_raw_days ?? config.defaults.retention_raw_days),
  );

  const isAdmin = user.role === "admin";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave({
      stale_after_seconds: Number(staleSec),
      retention_raw_days: Number(rawDays),
    });
  };

  return (
    <div className="panel">
      <h2>系统配置</h2>
      {!isAdmin && (
        <div style={{ marginBottom: 12 }}>
          <PermissionDeniedNotice
            subject="当前账户为只读角色（viewer），无法修改系统配置。"
            remediation="如需调整数据保留策略或过期阈值，请使用管理员（admin）账户登录。"
          />
        </div>
      )}

      {savedNotice && (
        <div className="banner banner-info" style={{ marginBottom: 12 }}>
          {savedNotice}
        </div>
      )}

      <form className="form-grid" onSubmit={handleSubmit}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>数据过期判定阈值（秒）</span>
          <input
            type="number"
            min={10}
            max={3600}
            disabled={!isAdmin}
            value={staleSec}
            onChange={(e) => setStaleSec(e.target.value)}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>原始采样保留天数（默认 14 天）</span>
          <input
            type="number"
            min={1}
            max={365}
            disabled={!isAdmin}
            value={rawDays}
            onChange={(e) => setRawDays(e.target.value)}
          />
        </label>
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
          默认聚合保留：1 分钟聚合 {config.defaults.retention_1m_days} 天 · 1 小时聚合{" "}
          {config.defaults.retention_1h_days} 天 · SMART 历史 {config.defaults.retention_smart_days}{" "}
          天（敏感配置项不会下发至前端）。
        </div>
        {isAdmin && (
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "保存中..." : "保存配置（写审计日志）"}
          </button>
        )}
      </form>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <h3 style={{ marginTop: 0 }}>数据导出</h3>
        <div className="row">
          <a className="btn btn-secondary" href={api.exportReportUrl()} download>
            导出脱敏健康与诊断报告 (JSON)
          </a>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>
          导出报告包含主机、设备、覆盖率、最新健康分析、告警与诊断日志，自动剔除用户凭据与敏感配置。
        </div>
      </div>
    </div>
  );
}

export function ConfigPage({ user }: { user: UserInfo }) {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [notif, setNotif] = useState<{
    webhook_enabled: boolean;
    webhook_url: string;
    has_secret: boolean;
  } | null>(null);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [notifNotice, setNotifNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.config(), api.notifications().catch(() => null)])
      .then(([cfg, n]) => {
        setConfig(cfg);
        if (n) {
          setNotif(n);
          setWebhookEnabled(n.webhook_enabled);
          setWebhookUrl(n.webhook_url);
        }
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

  const handleSave = (patch: Record<string, unknown>) => {
    setSaving(true);
    setSavedNotice(null);
    setError(null);
    api
      .updateConfig(patch)
      .then((res) => {
        setConfig((prev) => (prev ? { ...prev, settings: res.settings } : prev));
        setSavedNotice("配置已保存并记录审计日志。");
      })
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      )
      .finally(() => setSaving(false));
  };

  const handleSaveNotif = (e: FormEvent) => {
    e.preventDefault();
    setNotifNotice(null);
    setError(null);
    api
      .updateNotifications({
        webhook_enabled: webhookEnabled,
        webhook_url: webhookUrl,
        ...(webhookSecret.trim() ? { webhook_secret: webhookSecret.trim() } : {}),
      })
      .then((res) => {
        setNotif(res);
        setWebhookSecret("");
        setNotifNotice("告警 Webhook 通知配置已保存（密钥已脱敏保存）。");
      })
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      );
  };

  const handleTestNotif = () => {
    setNotifNotice(null);
    api
      .testNotification()
      .then((res) =>
        setNotifNotice(
          res.delivered
            ? `测试通知发送成功（HTTP ${res.status}）。`
            : `测试通知发送失败：${res.error ?? "未知错误"}`,
        ),
      )
      .catch((err) =>
        setNotifNotice(
          err instanceof ApiClientError ? err.message : String(err),
        ),
      );
  };

  if (loading) return <LoadingState message="正在加载系统配置..." />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (!config) return null;
  const isAdmin = user.role === "admin";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ConfigView
        user={user}
        config={config}
        onSave={handleSave}
        saving={saving}
        savedNotice={savedNotice}
      />

      {notif && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>告警通知（Webhook）</h3>
          {notifNotice && (
            <div className="banner banner-info" style={{ marginBottom: 12 }}>
              {notifNotice}
            </div>
          )}
          <form className="form-grid" onSubmit={handleSaveNotif}>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={webhookEnabled}
                onChange={(e) => setWebhookEnabled(e.target.checked)}
              />
              <span>启用告警状态变更 Webhook 推送</span>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>Webhook URL（仅允许 http/https，已禁止云元数据 SSRF 地址）</span>
              <input
                type="url"
                disabled={!isAdmin}
                placeholder="http://192.168.9.10:8080/webhook"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>
                HMAC-SHA256 签名密钥（可选，当前状态：{notif.has_secret ? "已配置" : "未配置"}）
              </span>
              <input
                type="password"
                disabled={!isAdmin}
                placeholder="留空保持不变"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </label>
            {isAdmin && (
              <div className="row">
                <button type="submit" className="btn">
                  保存通知配置
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!notif.webhook_url}
                  onClick={handleTestNotif}
                >
                  发送测试通知
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
