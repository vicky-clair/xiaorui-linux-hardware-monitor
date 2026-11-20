import { useEffect, useState } from "react";
import { api, ApiClientError, type CoverageResponse } from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import { DeviceStatusBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function CoverageView({ data }: { data: CoverageResponse }) {
  if (data.devices.length === 0) return <EmptyState title="暂无传感器覆盖率记录" />;

  return (
    <div className="panel">
      <h2>
        传感器覆盖率（{data.total_devices} 台设备 / {data.total_sensors} 个传感器，过期阈值{" "}
        {data.stale_after_seconds} s）
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>设备</th>
              <th>状态</th>
              <th>温度能力</th>
              <th>已支持指标</th>
              <th>权限不足</th>
              <th>硬件不支持</th>
              <th>数据过期 (stale)</th>
              <th>最近成功采样</th>
            </tr>
          </thead>
          <tbody>
            {data.devices.map((d) => (
              <tr key={d.device_id}>
                <td>
                  <div>{d.device_name}</div>
                  <div className="mono" style={{ color: "var(--text-muted)" }}>
                    {d.device_id}
                  </div>
                </td>
                <td>
                  <DeviceStatusBadge status={d.device_status} />
                </td>
                <td>
                  {d.has_temperature_capability
                    ? d.temperature_read_ok
                      ? "支持且已读"
                      : "支持（未读到）"
                    : "无"}
                </td>
                <td>{d.supported_metrics.join("、") || "—"}</td>
                <td style={{ color: d.permission_denied_metrics.length ? "#fcd34d" : undefined }}>
                  {d.permission_denied_metrics.join("、") || "—"}
                </td>
                <td style={{ color: "var(--text-muted)" }}>
                  {d.unsupported_metrics.join("、") || "—"}
                </td>
                <td style={{ color: d.stale_metrics.length ? "#fca5a5" : undefined }}>
                  {d.stale_metrics.join("、") || "—"}
                </td>
                <td>{formatLocalTime(d.last_success_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CoveragePage() {
  const [data, setData] = useState<CoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .coverage()
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

  if (loading) return <LoadingState message="正在加载传感器覆盖率..." />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (!data) return <EmptyState />;
  return <CoverageView data={data} />;
}
