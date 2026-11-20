import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type AggReadingRow,
  type RawReadingRow,
  type SensorRow,
} from "../lib/api.ts";
import { resolveTimeRange, type TimeRangeKey } from "../lib/format.ts";
import {
  TimeSeriesChart,
  type ChartSeriesInput,
} from "../components/TimeSeriesChart.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

const RANGE_OPTIONS: Array<{ key: TimeRangeKey; label: string }> = [
  { key: "15m", label: "最近 15 分钟 (原始)" },
  { key: "1h", label: "最近 1 小时 (原始)" },
  { key: "6h", label: "最近 6 小时 (1分钟聚合)" },
  { key: "24h", label: "最近 24 小时 (1分钟聚合)" },
  { key: "7d", label: "最近 7 天 (1小时聚合)" },
];

export function TemperatureHistoryPage() {
  const [sensors, setSensors] = useState<SensorRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [range, setRange] = useState<TimeRangeKey>("1h");
  const [series, setSeries] = useState<ChartSeriesInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .sensors({ sensorType: "temperature" })
      .then((res) => {
        const supported = res.sensors.filter((s) => s.capabilityStatus === "supported");
        setSensors(supported);
        setSelectedIds(supported.slice(0, 4).map((s) => s.sensorId));
      })
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setSeries([]);
      return;
    }
    const { from, to, granularity } = resolveTimeRange(range);
    const sensorMap = new Map(sensors.map((s) => [s.sensorId, s]));

    Promise.all(
      selectedIds.map(async (sid) => {
        const res = await api.sensorReadings(sid, { from, to, granularity, limit: 1000 });
        const sensor = sensorMap.get(sid);
        const points: Array<[number, number | null]> = res.items
          .slice()
          .reverse()
          .map((item) => {
            if ("bucketStart" in item) {
              const agg = item as AggReadingRow;
              return [Date.parse(agg.bucketStart), agg.avgValue];
            }
            const raw = item as RawReadingRow;
            return [
              Date.parse(raw.collectedAt),
              raw.quality === "valid" ? raw.value : null,
            ];
          });
        return {
          name: sensor ? `${sensor.sensorName} (${sensor.deviceId})` : sid,
          unit: "celsius" as const,
          points,
        };
      }),
    )
      .then(setSeries)
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      );
  }, [selectedIds, range, sensors]);

  if (loading) return <LoadingState message="正在加载温度传感器列表..." />;
  if (error) return <ErrorState code={error.code} message={error.message} />;
  if (sensors.length === 0) {
    return (
      <EmptyState
        title="无可用温度传感器"
        description="当前主机没有状态为 supported 的温度传感器。"
      />
    );
  }

  const toggleSensor = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const { from, to, granularity } = resolveTimeRange(range);
  const primarySensorId = selectedIds[0] ?? null;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>温度历史曲线</h2>
        <div className="row">
          {primarySensorId && (
            <>
              <a
                className="btn btn-secondary"
                href={api.exportReadingsUrl({
                  sensorId: primarySensorId,
                  from,
                  to,
                  granularity,
                  format: "csv",
                })}
                download
              >
                导出 CSV
              </a>
              <a
                className="btn btn-secondary"
                href={api.exportReadingsUrl({
                  sensorId: primarySensorId,
                  from,
                  to,
                  granularity,
                  format: "json",
                })}
                download
              >
                导出 JSON
              </a>
            </>
          )}
          <select
            aria-label="时间范围"
            value={range}
            onChange={(e) => setRange(e.target.value as TimeRangeKey)}
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        {sensors.map((s) => (
          <label
            key={s.sensorId}
            className="badge badge-muted"
            style={{ cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(s.sensorId)}
              onChange={() => toggleSensor(s.sensorId)}
            />
            <span>{s.sensorName}</span>
          </label>
        ))}
      </div>

      {series.every((s) => s.points.length === 0) ? (
        <EmptyState title="所选时间范围内无采样点" description="请切换时间范围或等待 Agent 持续上报。" />
      ) : (
        <TimeSeriesChart series={series} unitLabel="°C" height={340} />
      )}
    </div>
  );
}
