import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type StorageItem,
  type StorageSmartDetail,
} from "../lib/api.ts";
import { formatLocalTime, formatReadingValue } from "../lib/format.ts";
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
  if (items.length === 0) {
    return (
      <EmptyState
        title={`${title}：未发现设备`}
        description="当前主机未发现该类型的存储设备。"
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
                <th>设备</th>
                <th>设备状态</th>
                <th>协议</th>
                <th>SMART 自检</th>
                <th>温度</th>
                <th>通电小时</th>
                <th>读取数据单元 (128-bit)</th>
                <th>写入数据单元 (128-bit)</th>
                <th>操作</th>
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
                      ? "待机跳过（未唤醒）"
                      : smart?.smartPassed === true
                        ? "通过"
                        : smart?.smartPassed === false
                          ? "未通过"
                          : "— (无数据)"}
                  </td>
                  <td className="mono">
                    {smart?.temperatureCelsius !== null &&
                    smart?.temperatureCelsius !== undefined
                      ? formatReadingValue(smart.temperatureCelsius, "celsius", "valid")
                      : "— (无数据)"}
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
                      SMART 详情
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
          <h3>SMART 原始属性：{selectedSmart.device.name}</h3>
          {!selectedSmart.latest ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              尚未收到该设备的 SMART 报告（若非 root 运行，请检查采集器诊断中的 SMART_PERMISSION_DENIED）。
            </p>
          ) : selectedSmart.latest.attributes.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              最近采集时间：{formatLocalTime(selectedSmart.latest.collectedAt)}；当前状态：
              {selectedSmart.latest.deviceStatus}，无 ATA 属性表。
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>属性名</th>
                    <th>Value</th>
                    <th>Worst</th>
                    <th>Threshold</th>
                    <th>Raw Value (精确字符串)</th>
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

  if (loading) return <LoadingState message="正在加载存储与 SMART 信息..." />;
  if (error) return <ErrorState code={error.code} message={error.message} onRetry={load} />;
  return (
    <StorageView
      title={nvmeOnly ? "NVMe 监控" : "存储健康与 SMART"}
      items={items}
      selectedSmart={selected}
      onSelect={handleSelect}
    />
  );
}
