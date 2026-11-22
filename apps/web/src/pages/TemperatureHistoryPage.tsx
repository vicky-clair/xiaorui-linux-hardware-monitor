// 温度历史曲线与安全导出页：支持 15m/1h/6h/24h/7d 多粒度聚合查询、三语传感器名称本地化、统计摘要与 ECharts 断点曲线渲染。
import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type AggReadingRow,
  type DeviceRow,
  type RawReadingRow,
  type SensorRow,
} from "../lib/api.ts";
import { formatReadingValue, resolveTimeRange, type TimeRangeKey } from "../lib/format.ts";
import { translateSensorName, useI18n } from "../lib/i18n.tsx";
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
  const { locale, t } = useI18n();
  const [sensors, setSensors] = useState<SensorRow[]>([]);
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 12 小时超低功耗模式下默认展示最近 24 小时，打开页面即可直接看到历史曲线
  const [range, setRange] = useState<TimeRangeKey>("24h");
  const [series, setSeries] = useState<ChartSeriesInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const formatSensorLabel = (s: SensorRow, devMap: Record<string, string>) => {
    const localizedName = translateSensorName(locale, s.sensorName);
    const devName = devMap[s.deviceId];
    // 当同类型传感器存在多个设备（如多块硬盘的 SMART 温度）时附带清晰设备名区分
    if (s.source === "smartctl" || s.source === "nvme-cli") {
      return devName ? `${localizedName} · ${devName}` : localizedName;
    }
    return localizedName;
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([api.sensors({ sensorType: "temperature" }), api.devices().catch(() => null)])
      .then(([sRes, dRes]) => {
        const supported = sRes.sensors.filter((s) => s.capabilityStatus === "supported");
        const devMap: Record<string, string> = {};
        if (dRes) {
          for (const d of dRes.devices as DeviceRow[]) {
            devMap[d.deviceId] = d.name;
          }
        }
        setDeviceNames(devMap);
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
          name: sensor ? formatSensorLabel(sensor, deviceNames) : sid,
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
  }, [selectedIds, range, sensors, deviceNames, locale]);

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

  const statsList = series
    .map((s) => {
      const validVals = s.points
        .map((p) => p[1])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (validVals.length === 0) return null;
      return {
        name: s.name,
        latest: validVals[validVals.length - 1]!,
        min: Math.min(...validVals),
        max: Math.max(...validVals),
        count: validVals.length,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
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

      <div className="banner banner-info" style={{ marginBottom: 12, fontSize: 12 }}>
        {t("history.hint")}
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "3px 10px", fontSize: 12 }}
          onClick={() => setSelectedIds(sensors.map((s) => s.sensorId))}
        >
          {t("history.selectAll")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "3px 10px", fontSize: 12 }}
          onClick={() => setSelectedIds([])}
        >
          {t("history.clearAll")}
        </button>
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
            <span>{formatSensorLabel(s, deviceNames)}</span>
          </label>
        ))}
      </div>

      {statsList.length > 0 && (
        <div className="kv-grid">
          {statsList.map((st) => (
            <div className="kv-item" key={st.name}>
              <div className="kv-label">{st.name}</div>
              <div className="kv-val">
                {t("history.latest")}{" "}
                {formatReadingValue(st.latest, "celsius", "valid", locale)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {t("history.min")} {st.min.toFixed(1)} °C · {t("history.max")}{" "}
                {st.max.toFixed(1)} °C · {t("history.samples")} {st.count}
              </div>
            </div>
          ))}
        </div>
      )}

      {series.every((s) => s.points.length === 0) ? (
        <EmptyState title={t("history.noPoints")} description={t("history.noPointsDesc")} />
      ) : (
        <TimeSeriesChart series={series} unitLabel="°C" height={340} />
      )}
    </div>
  );
}
