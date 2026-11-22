// 存储健康与 SMART / NVMe 监控页：展示持久化分区容量进度条、硬盘运行特征/自检记录、NVMe 扩展健康与三语 SMART 属性明细。
import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type StorageItem,
  type StorageSmartDetail,
} from "../lib/api.ts";
import { formatBytes, formatLocalTime, formatReadingValue } from "../lib/format.ts";
import { useI18n } from "../lib/i18n.tsx";
import { getSmartAttrMeaning, getSmartAttrTone } from "../lib/smartMeta.ts";
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

  const allMounts = items.flatMap((it) =>
    (it.mounts ?? []).map((m) => ({
      ...m,
      deviceName: it.device.name,
      deviceId: it.device.deviceId,
    })),
  );

  const latestDetail = selectedSmart?.latest ?? null;

  return (
    <>
      {allMounts.length > 0 && (
        <div className="panel">
          <h2>{t("storage.mountsTitle")}</h2>
          <div className="card-grid">
            {allMounts.map((m) => {
              const pct = m.usagePercent ?? 0;
              const barClass =
                pct >= 90 ? "progress-err" : pct >= 85 ? "progress-warn" : "progress-ok";
              const pctClass = pct >= 90 ? "text-danger" : pct >= 85 ? "text-warn" : "";
              return (
                <div className="card" key={`${m.deviceId}-${m.mountpoint}`}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="mono" style={{ fontWeight: 700 }}>
                      {m.mountpoint}
                    </span>
                    <span className="badge badge-muted">{m.fstype ?? "fs"}</span>
                  </div>
                  <div
                    className={`card-value ${pctClass}`}
                    style={{ fontSize: 20, marginTop: 4 }}
                  >
                    {m.usagePercent !== null ? `${m.usagePercent.toFixed(1)}%` : t("fmt.noData")}
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-bar ${barClass}`}
                      style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("storage.mountUsed")}:{" "}
                    {m.usedBytes !== null ? formatBytes(m.usedBytes, locale) : "—"} /{" "}
                    {m.totalBytes !== null ? formatBytes(m.totalBytes, locale) : "—"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("storage.mountAvail")}:{" "}
                    {m.availBytes !== null ? formatBytes(m.availBytes, locale) : "—"} ·{" "}
                    {m.deviceName}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                      {smart?.firmwareVersion ? ` · FW ${smart.firmwareVersion}` : ""}
                      {smart?.apmLevel !== null && smart?.apmLevel !== undefined
                        ? ` · APM ${smart.apmLevel}`
                        : ""}
                    </div>
                  </td>
                  <td>
                    <DeviceStatusBadge status={smart?.deviceStatus ?? device.deviceStatus} />
                  </td>
                  <td className="mono">{smart?.protocolType ?? "—"}</td>
                  <td>
                    {smart?.deviceStatus === "standby" ? (
                      t("storage.standbySkip")
                    ) : smart?.smartPassed === true ? (
                      <span className="badge badge-ok">{t("storage.passed")}</span>
                    ) : smart?.smartPassed === false ? (
                      <span className="badge badge-err text-danger">{t("storage.failed")}</span>
                    ) : (
                      t("fmt.noData")
                    )}
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
            {t("storage.driveMetaTitle")}
            {selectedSmart.device.name}
          </h3>
          {!latestDetail ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              {t("storage.noSmartReport")}
            </p>
          ) : (
            <>
              <div className="kv-grid">
                <div className="kv-item">
                  <div className="kv-label">{t("storage.firmware")}</div>
                  <div className="kv-val">{latestDetail.firmwareVersion ?? "—"}</div>
                </div>
                <div className="kv-item">
                  <div className="kv-label">{t("storage.serial")}</div>
                  <div className="kv-val">{latestDetail.serialNumber ?? "—"}</div>
                </div>
                <div className="kv-item">
                  <div className="kv-label">{t("storage.rotationRate")}</div>
                  <div className="kv-val">
                    {latestDetail.rotationRateRpm === 0
                      ? t("storage.ssd")
                      : latestDetail.rotationRateRpm
                        ? `${latestDetail.rotationRateRpm} RPM`
                        : "—"}
                  </div>
                </div>
                <div className="kv-item">
                  <div className="kv-label">{t("storage.sataSpeed")}</div>
                  <div className="kv-val">{latestDetail.sataLinkSpeed ?? "—"}</div>
                </div>
                <div className="kv-item">
                  <div className="kv-label">{t("storage.apmLevel")}</div>
                  <div className="kv-val">
                    {latestDetail.apmLevel !== null && latestDetail.apmLevel !== undefined
                      ? String(latestDetail.apmLevel)
                      : "—"}
                  </div>
                </div>
                <div className="kv-item">
                  <div className="kv-label">{t("storage.writeCache")} / {t("storage.trim")}</div>
                  <div className="kv-val">
                    {latestDetail.writeCacheEnabled === true
                      ? t("storage.enabled")
                      : latestDetail.writeCacheEnabled === false
                        ? t("storage.disabled")
                        : "—"}{" "}
                    /{" "}
                    {latestDetail.trimSupported === true
                      ? t("storage.supported")
                      : latestDetail.trimSupported === false
                        ? t("storage.unsupported")
                        : "—"}
                  </div>
                </div>
                <div className="kv-item">
                  <div className="kv-label">{t("storage.selfTest")}</div>
                  <div
                    className={`kv-val ${
                      latestDetail.selfTestPassed === false ? "text-danger" : ""
                    }`}
                  >
                    {latestDetail.selfTestLastStatus
                      ? `${latestDetail.selfTestLastStatus}${
                          latestDetail.selfTestLastHours
                            ? ` (@${latestDetail.selfTestLastHours}h)`
                            : ""
                        }`
                      : "—"}
                  </div>
                </div>
                <div className="kv-item">
                  <div className="kv-label">{t("storage.errorLog")}</div>
                  <div
                    className={`kv-val ${
                      latestDetail.errorLogCount && latestDetail.errorLogCount > 0
                        ? "text-warn"
                        : ""
                    }`}
                  >
                    {latestDetail.errorLogCount !== null &&
                    latestDetail.errorLogCount !== undefined
                      ? String(latestDetail.errorLogCount)
                      : "—"}
                  </div>
                </div>
                {(latestDetail.protocolType === "nvme" ||
                  latestDetail.mediaErrors !== null ||
                  latestDetail.unsafeShutdowns !== null) && (
                  <>
                    <div className="kv-item">
                      <div className="kv-label">{t("storage.nvmeLife")}</div>
                      <div className="kv-val">
                        {latestDetail.percentageUsed !== null
                          ? `${latestDetail.percentageUsed}%`
                          : "—"}{" "}
                        /{" "}
                        {latestDetail.availableSpare !== null
                          ? `${latestDetail.availableSpare}%`
                          : "—"}
                      </div>
                    </div>
                    <div className="kv-item">
                      <div className="kv-label">{t("storage.mediaErrors")}</div>
                      <div
                        className={`kv-val ${
                          latestDetail.mediaErrors && latestDetail.mediaErrors !== "0"
                            ? "text-danger"
                            : ""
                        }`}
                      >
                        {latestDetail.mediaErrors ?? "—"}
                      </div>
                    </div>
                    <div className="kv-item">
                      <div className="kv-label">{t("storage.unsafeShutdowns")}</div>
                      <div className="kv-val">{latestDetail.unsafeShutdowns ?? "—"}</div>
                    </div>
                    <div className="kv-item">
                      <div className="kv-label">{t("storage.thermalThrottleTime")}</div>
                      <div className="kv-val">
                        {latestDetail.warningTempTimeMin ?? "—"}m /{" "}
                        {latestDetail.criticalCompTimeMin ?? "—"}m
                      </div>
                    </div>
                    {latestDetail.temperatureSensorsCelsius &&
                      latestDetail.temperatureSensorsCelsius.length > 0 && (
                        <div className="kv-item">
                          <div className="kv-label">{t("storage.tempSensors")}</div>
                          <div className="kv-val">
                            {latestDetail.temperatureSensorsCelsius
                              .map((c) => `${c.toFixed(1)} °C`)
                              .join(" / ")}
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>

              <h3 style={{ marginTop: 8 }}>
                {t("storage.rawAttrTitle")}
                {selectedSmart.device.name}
              </h3>
              {latestDetail.attributes.length === 0 ? (
                <p style={{ margin: 0, color: "var(--text-muted)" }}>
                  {t("storage.lastCollectPrefix")}
                  {formatLocalTime(latestDetail.collectedAt, locale)}
                  {t("storage.currentStatusPrefix")}
                  {latestDetail.deviceStatus} ({t("storage.noAtaTable")})
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>{t("th.attrName")}</th>
                        <th>{t("th.attrMeaning")}</th>
                        <th>Value</th>
                        <th>Worst</th>
                        <th>Threshold</th>
                        <th>{t("th.rawDisplay")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestDetail.attributes.map((a) => {
                        const tone = getSmartAttrTone(a);
                        const rowClass =
                          tone === "critical"
                            ? "row-critical"
                            : tone === "warning"
                              ? "row-warning"
                              : "";
                        const valClass =
                          tone === "critical"
                            ? "text-danger"
                            : tone === "warning"
                              ? "text-warn"
                              : "";
                        const displayRaw =
                          a.rawString && a.rawString !== a.rawValue
                            ? `${a.rawString} (${a.rawValue})`
                            : a.rawValue;
                        return (
                          <tr key={`${a.attrId}-${a.name}`} className={rowClass}>
                            <td className="mono">{a.attrId}</td>
                            <td>{a.name}</td>
                            <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              {getSmartAttrMeaning(a.attrId, locale)}
                            </td>
                            <td className="mono">{a.value ?? "—"}</td>
                            <td className="mono">{a.worst ?? "—"}</td>
                            <td className="mono">{a.threshold ?? "—"}</td>
                            <td className={`mono ${valClass}`}>{displayRaw}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
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
