import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiClientError,
  type ConfigResponse,
  type UserInfo,
} from "../lib/api.ts";
import { LanguageSwitcher, useI18n } from "../lib/i18n.tsx";
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
  const { t } = useI18n();
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
      <h2>{t("config.title")}</h2>
      {!isAdmin && (
        <div style={{ marginBottom: 12 }}>
          <PermissionDeniedNotice
            subject={t("config.viewerDenied")}
            remediation={t("config.viewerRemediation")}
          />
        </div>
      )}

      {savedNotice && (
        <div className="banner banner-info" style={{ marginBottom: 12 }}>
          {savedNotice}
        </div>
      )}

      <div
        style={{
          marginBottom: 18,
          paddingBottom: 14,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>{t("config.langTitle")}</h3>
        <div className="row" style={{ gap: 12 }}>
          <LanguageSwitcher />
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            {t("config.langDesc")}
          </span>
        </div>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{t("config.staleLabel")}</span>
          <input
            type="number"
            min={10}
            max={604800}
            disabled={!isAdmin}
            value={staleSec}
            onChange={(e) => setStaleSec(e.target.value)}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{t("config.rawDaysLabel")}</span>
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
          {t("config.defaultsNote1")} {config.defaults.retention_1m_days}{" "}
          {t("config.defaultsNote2")} {config.defaults.retention_1h_days}{" "}
          {t("config.defaultsNote3")} {config.defaults.retention_smart_days}{" "}
          {t("config.defaultsNote4")}
        </div>
        {isAdmin && (
          <button type="submit" className="btn" disabled={saving}>
            {saving ? t("config.saving") : t("config.saveBtn")}
          </button>
        )}
      </form>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <h3 style={{ marginTop: 0 }}>{t("config.exportTitle")}</h3>
        <div className="row">
          <a className="btn btn-secondary" href={api.exportReportUrl()} download>
            {t("config.exportReportBtn")}
          </a>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>
          {t("config.exportReportDesc")}
        </div>
      </div>
    </div>
  );
}

export function ConfigPage({ user }: { user: UserInfo }) {
  const { t } = useI18n();
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
        setSavedNotice(t("config.savedNotice"));
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
        setNotifNotice(t("config.webhookSaved"));
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
            ? `${t("config.webhookTestOk")} (HTTP ${res.status})`
            : `${t("config.webhookTestFail")}${res.error ?? "unknown"}`,
        ),
      )
      .catch((err) =>
        setNotifNotice(err instanceof ApiClientError ? err.message : String(err)),
      );
  };

  if (loading) return <LoadingState message={t("config.loading")} />;
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
          <h3 style={{ marginTop: 0 }}>{t("config.webhookTitle")}</h3>
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
              <span>{t("config.webhookEnable")}</span>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>{t("config.webhookUrl")}</span>
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
                {t("config.webhookSecret")}
                {notif.has_secret ? t("config.secretConfigured") : t("config.secretNotConfigured")})
              </span>
              <input
                type="password"
                disabled={!isAdmin}
                placeholder={t("config.secretPlaceholder")}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </label>
            {isAdmin && (
              <div className="row">
                <button type="submit" className="btn">
                  {t("config.saveNotifBtn")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!notif.webhook_url}
                  onClick={handleTestNotif}
                >
                  {t("config.testNotifBtn")}
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
