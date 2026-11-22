// 温度历史曲线与安全导出页：支持 15m/1h/6h/24h/7d 多粒度聚合查询、ECharts 断点曲线渲染及 CSV/JSON 导出。
import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type AggReadingRow,
  type RawReadingRow,
  type SensorRow,
} from "../lib/api.ts";
import { resolveTimeRange, type TimeRangeKey } from "../lib/format.ts";
import { useI18n } from "../lib/i18n.tsx";
import {
  TimeSeriesChart,
  type ChartSeriesInput,
} from "../components/TimeSeriesChart.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

const RANGE_KEYS: Array<{ key: TimeRangeKey; labelKey: string }> = [
  { key: "15m", labelKey: "history.range15m" },
  { key: "1h", labelKey: "history.range1h" },
  { key: "6h", labelKey: "history.range6h" },
  { key: "24h", labelKey: "history.range24h" },
  { key: "7d", labelKey: "history.range7d" },
];

export function TemperatureHistoryPage() {
  const { t } = useI18n();
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

  if (loading) return <LoadingState message={t("history.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} />;
  if (sensors.length === 0) {
    return (
      <EmptyState
        title={t("history.noSensors")}
        description={t("history.noSensorsDesc")}
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
        <h2 style={{ margin: 0 }}>{t("history.title")}</h2>
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
                {t("history.exportCsv")}
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
                {t("history.exportJson")}
              </a>
            </>
          )}
          <select
            aria-label={t("history.rangeAria")}
            value={range}
            onChange={(e) => setRange(e.target.value as TimeRangeKey)}
          >
            {RANGE_KEYS.map((o) => (
              <option key={o.key} value={o.key}>
                {t(o.labelKey)}
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
        <EmptyState title={t("history.noPoints")} description={t("history.noPointsDesc")} />
      ) : (
        <TimeSeriesChart series={series} unitLabel="°C" height={340} />
      )}
    </div>
  );
}
