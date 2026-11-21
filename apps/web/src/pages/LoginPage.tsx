import { useState, type FormEvent } from "react";
import { api, ApiClientError, type UserInfo } from "../lib/api.ts";
import { LanguageSwitcher, useI18n } from "../lib/i18n.tsx";
import { ThemeSwitcher } from "../lib/theme.tsx";
import { ErrorState } from "../components/States.tsx";

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: UserInfo) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "bootstrap") {
        await api.bootstrap(bootstrapToken.trim(), username.trim(), password);
      }
      const { user } = await api.login(username.trim(), password);
      onAuthenticated(user);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="panel" style={{ width: "100%", maxWidth: 440 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Linux Hardware Monitor</h1>
          <div className="row" style={{ gap: 8 }}>
            <ThemeSwitcher />
            <LanguageSwitcher />
          </div>
        </div>
        <p style={{ margin: "0 0 16px 0", color: "var(--text-muted)", fontSize: 13 }}>
          {mode === "login" ? t("login.descLogin") : t("login.descBootstrap")}
        </p>

        <div className="row" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`btn ${mode === "login" ? "" : "btn-secondary"}`}
            onClick={() => setMode("login")}
          >
            {t("login.tabLogin")}
          </button>
          <button
            type="button"
            className={`btn ${mode === "bootstrap" ? "" : "btn-secondary"}`}
            onClick={() => setMode("bootstrap")}
          >
            {t("login.tabBootstrap")}
          </button>
        </div>

        {error && <ErrorState code={error.code} message={error.message} />}

        <form className="form-grid" onSubmit={handleSubmit} style={{ marginTop: 12 }}>
          {mode === "bootstrap" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>{t("login.bootstrapToken")}</span>
              <input
                type="password"
                required
                value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)}
                placeholder={t("login.bootstrapPlaceholder")}
              />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{t("login.username")}</span>
            <input
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{t("login.password")}</span>
            <input
              type="password"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting
              ? t("login.submitting")
              : mode === "login"
                ? t("login.submitLogin")
                : t("login.submitBootstrap")}
          </button>
        </form>
      </div>
    </div>
  );
}
