import { useEffect, useState } from "react";
import { api, ApiClientError, type OverviewResponse } from "../lib/api.ts";
import { formatLocalTime, formatUptime } from "../lib/format.ts";
import { CapabilityBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function OverviewView({ data }: { data: OverviewResponse }) {
  const host = data.hosts[0];
  return (
    <>
      <div className="banner banner-info">
        阶段 3 控制台仅展示实时与历史硬件遥测，不在前端推断健康状态；健康评分与告警中心将在阶段 4 由 Haskell 引擎提供。
      </div>

      <div className="card-grid">
        <div className="card">
          <p className="card-title">监控主机</p>
          <div className="card-value">{host ? host.hostname : "—"}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            {host ? `${host.osName} ${host.osVersion} · ${host.kernelVersion}` : "等待 Agent 上报"}
          </div>
        </div>
        <div className="card">
          <p className="card-title">已发现设备</p>
          <div className="card-value">{data.device_count}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            传感器总数：{data.sensor_count}
          </div>
        </div>
        <div className="card">
          <p className="card-title">权限受限设备</p>
          <div className="card-value">{data.coverage_summary.devices_with_permission_denied}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            数据过期设备：{data.coverage_summary.devices_with_stale}
          </div>
        </div>
        <div className="card">
          <p className="card-title">主机运行时间</p>
          <div className="card-value" style={{ fontSize: 18 }}>
            {host ? formatUptime(host.uptimeSeconds) : "—"}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            最近心跳：{host ? formatLocalTime(host.lastSeenAt) : "—"}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>采集器运行状态</h2>
        {data.collectors.length === 0 ? (
          <EmptyState title="尚无采集器状态" description="等待 Rust Agent 上报 collector_status。" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>采集器</th>
                  <th>运行状态</th>
                  <th>能力状态</th>
                  <th>周期</th>
                  <th>连续失败</th>
                  <th>最近成功时间</th>
                </tr>
              </thead>
              <tbody>
                {data.collectors.map((c) => (
                  <tr key={`${c.hostId}-${c.collectorName}`}>
                    <td className="mono">{c.collectorName}</td>
                    <td>{c.status}</td>
                    <td>
                      <CapabilityBadge status={c.capabilityStatus} />
                    </td>
                    <td>{c.intervalSeconds} s</td>
                    <td>{c.consecutiveFailures}</td>
                    <td>{formatLocalTime(c.lastSuccessAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>最近诊断记录</h2>
        {data.recent_diagnostics.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-muted)" }}>暂无诊断事件。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>级别</th>
                  <th>错误代码</th>
                  <th>设备</th>
                  <th>详情与建议</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_diagnostics.map((d) => (
                  <tr key={d.id}>
                    <td>{formatLocalTime(d.occurredAt)}</td>
                    <td className="mono">{d.level}</td>
                    <td className="mono">{d.errorCode}</td>
                    <td className="mono">{d.deviceId ?? "—"}</td>
                    <td>
                      <div>{d.message}</div>
                      {d.remediation && (
                        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                          建议：{d.remediation}
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

export function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .overview()
      .then(setData)
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

  if (loading) return <LoadingState message="正在加载系统总览..." />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (!data) return <EmptyState />;
  return <OverviewView data={data} />;
}
