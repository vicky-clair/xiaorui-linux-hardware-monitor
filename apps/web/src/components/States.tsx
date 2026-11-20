import type { WsConnectionState } from "../lib/ws.ts";

export function LoadingState({ message = "正在加载数据..." }: { message?: string }) {
  return (
    <div className="panel" role="status" aria-busy="true">
      <p style={{ margin: 0, color: "var(--text-muted)" }}>{message}</p>
    </div>
  );
}

export function EmptyState({
  title = "暂无数据",
  description = "当前主机未上报该类别数据或尚无历史采样。",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="panel">
      <h3 style={{ marginBottom: 4 }}>{title}</h3>
      <p style={{ margin: 0, color: "var(--text-muted)" }}>{description}</p>
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
  return (
    <div className="banner banner-err" role="alert">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>请求失败{code ? ` (${code})` : ""}：</strong>
          <span>{message}</span>
        </div>
        {onRetry && (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            重试
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
  return (
    <div className="banner banner-warn" role="note">
      <strong>权限不足：</strong>
      <span>{subject}</span>
      {remediation ? (
        <div style={{ marginTop: 4, opacity: 0.9 }}>建议：{remediation}</div>
      ) : null}
    </div>
  );
}

export function WsStatusBanner({ state }: { state: WsConnectionState }) {
  if (state === "connected") {
    return <span className="badge badge-ok">实时推送已连接</span>;
  }
  if (state === "connecting") {
    return <span className="badge badge-warn">实时推送连接中...</span>;
  }
  return (
    <span className="badge badge-err" role="status">
      实时推送已断开（数据可能不是最新）
    </span>
  );
}
