import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type StorageItem,
  type StorageSmartDetail,
} from "../lib/api.ts";
import { formatLocalTime, formatReadingValue } from "../lib/format.ts";
import { useI18n } from "../lib/i18n.tsx";
import { DeviceStatusBadge } from "../components/StatusBadge.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";

export function StorageView({
  title,
  items,
  selectedSmart,
  onSelect,
}: {
  title: string;
  items: StorageItem[];
  selectedSmart: StorageSmartDetail | null;
  onSelect: (deviceId: string) => void;
}) {
  const { locale, t } = useI18n();
  if (items.length === 0) {
    return (
      <EmptyState
        title={`${title}${t("storage.emptySuffix")}`}
        description={t("storage.emptyDesc")}
      />
    );
  }

  return (
    <>
      <div className="panel">
        <h2>{title}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("th.device")}</th>
                <th>{t("th.deviceStatus")}</th>
                <th>{t("th.protocol")}</th>
                <th>{t("th.smartSelfTest")}</th>
                <th>{t("th.temperature")}</th>
                <th>{t("th.powerOnHours")}</th>
                <th>{t("th.dataUnitsRead")}</th>
                <th>{t("th.dataUnitsWritten")}</th>
                <th>{t("th.action")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ device, latest_smart: smart }) => (
                <tr key={device.deviceId}>
                  <td>
                    <div>{device.name}</div>
                    <div className="mono" style={{ color: "var(--text-muted)" }}>
                      {device.deviceId}
                    </div>
                  </td>
                  <td>
                    <DeviceStatusBadge status={smart?.deviceStatus ?? device.deviceStatus} />
                  </td>
                  <td className="mono">{smart?.protocolType ?? "—"}</td>
                  <td>
                    {smart?.deviceStatus === "standby"
                      ? t("storage.standbySkip")
                      : smart?.smartPassed === true
                        ? t("storage.passed")
                        : smart?.smartPassed === false
                          ? t("storage.failed")
                          : t("fmt.noData")}
                  </td>
                  <td className="mono">
                    {smart?.temperatureCelsius !== null &&
                    smart?.temperatureCelsius !== undefined
                      ? formatReadingValue(smart.temperatureCelsius, "celsius", "valid", locale)
                      : t("fmt.noData")}
                  </td>
                  <td className="mono">{smart?.powerOnHours ?? "—"}</td>
                  <td className="mono">{smart?.dataUnitsRead ?? "—"}</td>
                  <td className="mono">{smart?.dataUnitsWritten ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onSelect(device.deviceId)}
                    >
                      {t("storage.smartDetailBtn")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSmart && (
        <div className="panel">
          <h3>
            {t("storage.rawAttrTitle")}
            {selectedSmart.device.name}
          </h3>
          {!selectedSmart.latest ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              {t("storage.noSmartReport")}
            </p>
          ) : selectedSmart.latest.attributes.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              {t("storage.lastCollectPrefix")}
              {formatLocalTime(selectedSmart.latest.collectedAt, locale)}
              {t("storage.currentStatusPrefix")}
              {selectedSmart.latest.deviceStatus} ({t("storage.noAtaTable")})
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t("th.attrName")}</th>
                    <th>Value</th>
                    <th>Worst</th>
                    <th>Threshold</th>
                    <th>{t("th.rawValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSmart.latest.attributes.map((a) => (
                    <tr key={`${a.attrId}-${a.name}`}>
                      <td className="mono">{a.attrId}</td>
                      <td>{a.name}</td>
                      <td className="mono">{a.value ?? "—"}</td>
                      <td className="mono">{a.worst ?? "—"}</td>
                      <td className="mono">{a.threshold ?? "—"}</td>
                      <td className="mono">{a.rawValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function StoragePage({ nvmeOnly = false }: { nvmeOnly?: boolean }) {
  const { t } = useI18n();
  const [items, setItems] = useState<StorageItem[]>([]);
  const [selected, setSelected] = useState<StorageSmartDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .storage()
      .then((res) => {
        const filtered = nvmeOnly
          ? res.storage.filter(
              (s) =>
                s.latest_smart?.protocolType === "nvme" ||
                s.device.deviceId.includes("nvme") ||
                s.device.name.toLowerCase().includes("nvme"),
            )
          : res.storage;
        setItems(filtered);
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

  useEffect(load, [nvmeOnly]);

  const handleSelect = (deviceId: string) => {
    api
      .storageSmart(deviceId)
      .then(setSelected)
      .catch((err) =>
        setError(
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : { message: String(err) },
        ),
      );
  };

  if (loading) return <LoadingState message={t("storage.loading")} />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  return (
    <StorageView
      title={nvmeOnly ? t("storage.titleNvme") : t("storage.titleAll")}
      items={items}
      selectedSmart={selected}
      onSelect={handleSelect}
    />
  );
}
