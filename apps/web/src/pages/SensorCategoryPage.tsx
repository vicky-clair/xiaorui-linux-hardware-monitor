import { useEffect, useState } from "react";
import type { SensorReading } from "@lhm/protocol/types";
import {
  api,
  ApiClientError,
  type DeviceRow,
  type RawReadingRow,
  type SensorRow,
} from "../lib/api.ts";
import { formatLocalTime, formatReadingValue } from "../lib/format.ts";
import {
  CapabilityBadge,
  DeviceStatusBadge,
  QualityBadge,
} from "../components/StatusBadge.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDeniedNotice,
} from "../components/States.tsx";

export interface SensorCategoryProps {
  title: string;
  deviceTypes?: string[];
  sensorTypes?: string[];
  emptyDescription: string;
  liveReadings: Record<string, SensorReading>;
}

export function SensorCategoryPage({
  title,
  deviceTypes,
  sensorTypes,
  emptyDescription,
  liveReadings,
}: SensorCategoryProps) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sensors, setSensors] = useState<SensorRow[]>([]);
  const [initialLatest, setInitialLatest] = useState<Record<string, RawReadingRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.devices(), api.sensors()])
      .then(async ([devRes, senRes]) => {
        const matchedDevices = deviceTypes
          ? devRes.devices.filter((d) => deviceTypes.includes(d.deviceType))
          : devRes.devices;
        const devIdSet = new Set(matchedDevices.map((d) => d.deviceId));
        const matchedSensors = senRes.sensors.filter((s) => {
          const matchDev = deviceTypes ? devIdSet.has(s.deviceId) : true;
          const matchSen = sensorTypes ? sensorTypes.includes(s.sensorType) : true;
          return matchDev && matchSen;
        });
        setDevices(matchedDevices);
        setSensors(matchedSensors);

        // Fetch single latest point for each supported sensor once on page mount (live updates come via WS)
        const entries = await Promise.all(
          matchedSensors
            .filter((s) => s.capabilityStatus === "supported")
            .slice(0, 30)
            .map(async (s) => {
              const res = await api
                .sensorReadings(s.sensorId, { granularity: "raw", limit: 1 })
                .catch(() => null);
              const first = res?.items[0] as RawReadingRow | undefined;
              return first ? ([s.sensorId, first] as const) : null;
            }),
        );
        const map: Record<string, RawReadingRow> = {};
        for (const e of entries) {
          if (e) map[e[0]] = e[1];
        }
        setInitialLatest(map);
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

  useEffect(load, [title]);

  if (loading) return <LoadingState message={`正在加载 ${title}...`} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (sensors.length === 0) {
    return <EmptyState title={`${title}暂无传感器`} description={emptyDescription} />;
  }

  const deniedSensors = sensors.filter((s) => s.capabilityStatus === "permission_denied");
  const devMap = new Map(devices.map((d) => [d.deviceId, d]));

  return (
    <>
      {deniedSensors.length > 0 && (
        <PermissionDeniedNotice
          subject={`以下指标因权限不足无法读取：${deniedSensors.map((s) => s.sensorName).join("、")}`}
          remediation="请查看「采集器诊断」页面获取最小权限配置建议，不要将权限不足视为硬件故障。"
        />
      )}

      <div className="panel">
        <h2>{title}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>设备</th>
                <th>设备状态</th>
                <th>传感器</th>
                <th>来源</th>
                <th>能力状态</th>
                <th>当前值</th>
                <th>数据质量</th>
                <th>采样时间</th>
              </tr>
            </thead>
            <tbody>
              {sensors.map((s) => {
                const dev = devMap.get(s.deviceId);
                const live = liveReadings[s.sensorId];
                const hist = initialLatest[s.sensorId];
                const value = live ? live.value : hist?.value ?? null;
                const quality = live ? live.quality : hist?.quality ?? "missing";
                const collectedAt = live ? live.collected_at : hist?.collectedAt ?? null;

                return (
                  <tr key={s.sensorId}>
                    <td>
                      <div>{dev?.name ?? s.deviceId}</div>
                      <div className="mono" style={{ color: "var(--text-muted)" }}>
                        {s.deviceId}
                      </div>
                    </td>
                    <td>
                      <DeviceStatusBadge status={dev?.deviceStatus ?? "unknown"} />
                    </td>
                    <td>{s.sensorName}</td>
                    <td className="mono">{s.source}</td>
                    <td>
                      <CapabilityBadge status={s.capabilityStatus} />
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {s.capabilityStatus === "supported"
                        ? formatReadingValue(value, s.unit, quality)
                        : "—"}
                    </td>
                    <td>
                      {s.capabilityStatus === "supported" ? (
                        <QualityBadge quality={quality} />
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td>{formatLocalTime(collectedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
