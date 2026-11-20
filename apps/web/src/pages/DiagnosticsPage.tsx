import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type CollectorRow,
  type DiagnosticRow,
} from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import { CapabilityBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function DiagnosticsPage() {
  const [collectors, setCollectors] = useState<CollectorRow[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.collectors(), api.diagnostics(100)])
      .then(([c, d]) => {
        setCollectors(c.collectors);
        setDiagnostics(d.diagnostics);
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

  if (loading) return <LoadingState message="正在加载采集器状态与诊断日志..." />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;

  return (
    <>
      <div className="panel">
        <h2>采集器健康与运行状态</h2>
        {collectors.length === 0 ? (
          <EmptyState title="暂无采集器上报" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>采集器</th>
                  <th>运行状态</th>
                  <th>能力状态</th>
                  <th>采集周期</th>
                  <th>连续失败</th>
                  <th>最近错误</th>
                  <th>最近成功时间</th>
                </tr>
              </thead>
              <tbody>
                {collectors.map((c) => (
                  <tr key={`${c.hostId}-${c.collectorName}`}>
                    <td className="mono">{c.collectorName}</td>
                    <td>{c.status}</td>
                    <td>
                      <CapabilityBadge status={c.capabilityStatus} />
                    </td>
                    <td>{c.intervalSeconds} s</td>
                    <td>{c.consecutiveFailures}</td>
                    <td className="mono">
                      {c.lastErrorCode ? `${c.lastErrorCode}: ${c.lastErrorMessage ?? ""}` : "—"}
                    </td>
                    <td>{formatLocalTime(c.lastSuccessAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>结构化诊断事件</h2>
        {diagnostics.length === 0 ? (
          <EmptyState title="暂无诊断记录" description="当前未记录任何权限不足、超时或采集异常。" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>级别</th>
                  <th>错误代码</th>
                  <th>采集器 / 设备</th>
                  <th>诊断说明与修复建议</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.map((d) => (
                  <tr key={d.id}>
                    <td>{formatLocalTime(d.occurredAt)}</td>
                    <td className="mono">{d.level}</td>
                    <td className="mono">{d.errorCode}</td>
                    <td className="mono">
                      {d.collectorName ?? "—"} / {d.deviceId ?? "—"}
                    </td>
                    <td>
                      <div>{d.message}</div>
                      {d.remediation && (
                        <div style={{ color: "#93c5fd", fontSize: 12, marginTop: 2 }}>
                          修复建议：{d.remediation}
                        </div>
                      )}
                    </td>
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
