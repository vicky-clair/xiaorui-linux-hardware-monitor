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
    </div>
  );
}

export function ConfigPage({ user }: { user: UserInfo }) {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .config()
      .then(setConfig)
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

  if (loading) return <LoadingState message="正在加载系统配置..." />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (!config) return null;
  return (
    <ConfigView
      user={user}
      config={config}
      onSave={handleSave}
      saving={saving}
      savedNotice={savedNotice}
    />
  );
}
