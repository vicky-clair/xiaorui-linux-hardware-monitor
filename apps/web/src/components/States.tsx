// 控制台统一状态展示组件：加载态、空数据、请求失败重试、权限不足说明与 WebSocket 实时连接状态条。
import type { WsConnectionState } from "../lib/ws.ts";
import { useI18n } from "../lib/i18n.tsx";

export function LoadingState({ message }: { message?: string }) {
  const { t } = useI18n();
  return (
    <div className="panel" role="status" aria-busy="true">
      <p style={{ margin: 0, color: "var(--text-muted)" }}>
        {message ?? t("state.loading")}
      </p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="panel">
      <h3 style={{ marginBottom: 4 }}>{title ?? t("state.emptyTitle")}</h3>
      <p style={{ margin: 0, color: "var(--text-muted)" }}>
        {description ?? t("state.emptyDesc")}
      </p>
    </div>
  );
}

export function ErrorState({
  code,
  message,
  onRetry,
}: {
  code?: string;
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="banner banner-err" role="alert">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>
            {t("state.requestFailed")}
            {code ? ` (${code})` : ""}:{" "}
          </strong>
          <span>{message}</span>
        </div>
        {onRetry && (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            {t("state.retry")}
          </button>
        )}
      </div>
    </div>
  );
}

export function PermissionDeniedNotice({
  subject,
  remediation,
}: {
  subject: string;
  remediation?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="banner banner-warn" role="note">
      <strong>{t("state.permissionDenied")}</strong>
      <span>{subject}</span>
      {remediation ? (
        <div style={{ marginTop: 4, opacity: 0.9 }}>
          {t("state.suggestion")}
          {remediation}
        </div>
      ) : null}
    </div>
  );
}

export function WsStatusBanner({ state }: { state: WsConnectionState }) {
  const { t } = useI18n();
  if (state === "connected") {
    return <span className="badge badge-ok">{t("ws.connected")}</span>;
  }
  if (state === "connecting") {
    return <span className="badge badge-warn">{t("ws.connecting")}</span>;
  }
  return (
    <span className="badge badge-err" role="status">
      {t("ws.disconnected")}
    </span>
  );
}
