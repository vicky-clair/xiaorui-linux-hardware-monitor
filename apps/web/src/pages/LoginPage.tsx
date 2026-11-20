import { useState, type FormEvent } from "react";
import { api, ApiClientError, type UserInfo } from "../lib/api.ts";
import { ErrorState } from "../components/States.tsx";

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: UserInfo) => void }) {
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
        <h1 style={{ margin: "0 0 6px 0", fontSize: 20 }}>Linux Hardware Monitor</h1>
        <p style={{ margin: "0 0 16px 0", color: "var(--text-muted)", fontSize: 13 }}>
          {mode === "login"
            ? "请使用已配置账户登录硬件监控控制台。"
            : "首次启动请使用 API 日志输出的一次性引导令牌创建管理员账户。"}
        </p>

        <div className="row" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`btn ${mode === "login" ? "" : "btn-secondary"}`}
            onClick={() => setMode("login")}
          >
            账户登录
          </button>
          <button
            type="button"
            className={`btn ${mode === "bootstrap" ? "" : "btn-secondary"}`}
            onClick={() => setMode("bootstrap")}
          >
            初始化管理员
          </button>
        </div>

        {error && <ErrorState code={error.code} message={error.message} />}

        <form className="form-grid" onSubmit={handleSubmit} style={{ marginTop: 12 }}>
          {mode === "bootstrap" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>一次性引导令牌（Bootstrap Token）</span>
              <input
                type="password"
                required
                value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)}
                placeholder="来自 lhm-api 启动日志"
              />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>用户名</span>
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
            <span>密码（至少 10 位）</span>
            <input
              type="password"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "提交中..." : mode === "login" ? "登录" : "创建管理员并登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
