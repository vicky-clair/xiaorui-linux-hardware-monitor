import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type DeviceDetail,
  type DeviceRow,
} from "../lib/api.ts";
import { formatLocalTime } from "../lib/format.ts";
import { useI18n } from "../lib/i18n.tsx";
import { CapabilityBadge, DeviceStatusBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function DevicesPage() {
  const { locale, t } = useI18n();
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

  if (loading) return <LoadingState message={t("devices.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  if (devices.length === 0) return <EmptyState title={t("devices.empty")} />;

  return (
    <>
      <div className="panel">
        <h2>{t("devices.title")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("th.stableDeviceId")}</th>
                <th>{t("th.type")}</th>
                <th>{t("th.nameModel")}</th>
                <th>{t("th.vendor")}</th>
                <th>{t("th.status")}</th>
                <th>{t("th.lastSeen")}</th>
                <th>{t("th.action")}</th>
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
                  <td>{formatLocalTime(d.lastSeenAt, locale)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => inspect(d.deviceId)}
                    >
                      {t("devices.inspectBtn")}
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
          <h3>
            {t("devices.identityTitle")}
            {detail.name}
          </h3>
          <div className="mono" style={{ marginBottom: 12, color: "var(--text-muted)" }}>
            stable={String(detail.identity?.stable ?? false)} · driver=
            {detail.identity?.driver ?? "—"} · pci={detail.identity?.pciBusId ?? "—"} · wwn=
            {detail.identity?.wwn ?? "—"} · topology={detail.identity?.topology ?? "—"}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("th.sensorId")}</th>
                  <th>{t("th.name")}</th>
                  <th>{t("th.type")}</th>
                  <th>{t("th.unit")}</th>
                  <th>{t("th.capability")}</th>
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
