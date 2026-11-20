import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type DeviceDetail,
  type DeviceRow,
} from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import { CapabilityBadge, DeviceStatusBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function DevicesPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .devices()
      .then((res) => setDevices(res.devices))
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

  const inspect = (id: string) => {
    api
      .deviceDetail(id)
      .then(setDetail)
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      );
  };

  if (loading) return <LoadingState message="正在加载硬件设备列表..." />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (devices.length === 0) return <EmptyState title="暂无已发现设备" />;

  return (
    <>
      <div className="panel">
        <h2>硬件设备列表</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>稳定设备 ID</th>
                <th>类型</th>
                <th>名称 / 型号</th>
                <th>厂商</th>
                <th>状态</th>
                <th>最近发现</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.deviceId}>
                  <td className="mono">{d.deviceId}</td>
                  <td className="mono">{d.deviceType}</td>
                  <td>
                    <div>{d.name}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{d.model}</div>
                  </td>
                  <td>{d.vendor}</td>
                  <td>
                    <DeviceStatusBadge status={d.deviceStatus} />
                  </td>
                  <td>{formatLocalTime(d.lastSeenAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => inspect(d.deviceId)}
                    >
                      身份详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="panel">
          <h3>设备身份与拓扑：{detail.name}</h3>
          <div className="mono" style={{ marginBottom: 12, color: "var(--text-muted)" }}>
            stable={String(detail.identity?.stable ?? false)} · driver=
            {detail.identity?.driver ?? "—"} · pci={detail.identity?.pciBusId ?? "—"} · wwn=
            {detail.identity?.wwn ?? "—"} · topology={detail.identity?.topology ?? "—"}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>传感器 ID</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>单位</th>
                  <th>能力状态</th>
                </tr>
              </thead>
              <tbody>
                {detail.sensors.map((s) => (
                  <tr key={s.sensorId}>
                    <td className="mono">{s.sensorId}</td>
                    <td>{s.sensorName}</td>
                    <td className="mono">{s.sensorType}</td>
                    <td className="mono">{s.unit}</td>
                    <td>
                      <CapabilityBadge status={s.capabilityStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
