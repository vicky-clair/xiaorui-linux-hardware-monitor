import { useEffect, useState } from "react";
import { api, ApiClientError, type CoverageResponse } from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import { useI18n } from "../lib/i18n.tsx";
import { DeviceStatusBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function CoverageView({ data }: { data: CoverageResponse }) {
  const { locale, t } = useI18n();
  if (data.devices.length === 0) return <EmptyState title={t("coverage.empty")} />;

  return (
    <div className="panel">
      <h2>
        {t("coverage.titlePrefix")} ({data.total_devices} {t("coverage.devicesUnit")} /{" "}
        {data.total_sensors} {t("coverage.sensorsUnit")}, {t("coverage.staleThreshold")}{" "}
        {data.stale_after_seconds} s)
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("th.device")}</th>
              <th>{t("th.status")}</th>
              <th>{t("th.tempCap")}</th>
              <th>{t("th.supportedMetrics")}</th>
              <th>{t("th.permDenied")}</th>
              <th>{t("th.unsupported")}</th>
              <th>{t("th.stale")}</th>
              <th>{t("th.lastSuccessSample")}</th>
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
                      ? t("coverage.tempOk")
                      : t("coverage.tempNoRead")
                    : t("coverage.tempNone")}
                </td>
                <td>{d.supported_metrics.join(", ") || "—"}</td>
                <td style={{ color: d.permission_denied_metrics.length ? "var(--text-warn)" : undefined }}>
                  {d.permission_denied_metrics.join(", ") || "—"}
                </td>
                <td style={{ color: "var(--text-muted)" }}>
                  {d.unsupported_metrics.join(", ") || "—"}
                </td>
                <td style={{ color: d.stale_metrics.length ? "var(--text-danger)" : undefined }}>
                  {d.stale_metrics.join(", ") || "—"}
                </td>
                <td>{formatLocalTime(d.last_success_at, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CoveragePage() {
  const { t } = useI18n();
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

  if (loading) return <LoadingState message={t("coverage.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (!data) return <EmptyState />;
  return <CoverageView data={data} />;
}
