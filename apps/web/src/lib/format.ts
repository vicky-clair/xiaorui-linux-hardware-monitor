import type {
  CapabilityStatus,
  DeviceStatus,
  ReadingQuality,
  Unit,
} from "@lhm/protocol/types";

const UNIT_SYMBOLS: Record<Unit, string> = {
  celsius: "°C",
  rpm: "RPM",
  volt: "V",
  watt: "W",
  ampere: "A",
  percent: "%",
  hertz: "Hz",
  byte: "B",
  byte_per_second: "B/s",
  second: "s",
  count: "",
};

/**
 * Formats a sensor reading value with unit.
 * Missing/null readings are NEVER rendered as 0 (AGENTS.md §2, docs/web/ui-spec.md §2).
 * Valid 0 values (e.g. 0 RPM, 0 Hz idle GPU, 0 °C) ARE displayed as 0 with unit.
 */
export function formatReadingValue(
  value: number | null | undefined,
  unit: Unit,
  quality: ReadingQuality = "valid",
): string {
  if (value === null || value === undefined || quality === "missing") {
    return "— (无数据)";
  }
  if (quality === "sensor_fault") {
    return "— (传感器故障)";
  }
  if (unit === "byte") {
    return formatBytes(value);
  }
  if (unit === "hertz") {
    return formatHertz(value);
  }
  const symbol = UNIT_SYMBOLS[unit];
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return symbol ? `${rounded} ${symbol}` : rounded;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "— (无数据)";
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[idx]}`;
}

export function formatHertz(hz: number): string {
  if (!Number.isFinite(hz)) return "— (无数据)";
  if (hz === 0) return "0 Hz";
  if (hz >= 1_000_000_000) return `${(hz / 1_000_000_000).toFixed(2)} GHz`;
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(0)} MHz`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

/** Formats UTC RFC 3339 timestamps in the browser's local timezone. */
export function formatLocalTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hrs} 小时 ${mins} 分`;
  if (hrs > 0) return `${hrs} 小时 ${mins} 分`;
  return `${mins} 分`;
}

export const CAPABILITY_LABELS: Record<CapabilityStatus, { label: string; tone: "ok" | "warn" | "muted" | "err" }> = {
  supported: { label: "支持", tone: "ok" },
  unsupported: { label: "硬件不支持", tone: "muted" },
  permission_denied: { label: "权限不足", tone: "warn" },
  unavailable: { label: "暂不可用", tone: "muted" },
  unknown: { label: "未知", tone: "muted" },
};

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, { label: string; tone: "ok" | "standby" | "err" | "muted" }> = {
  online: { label: "在线", tone: "ok" },
  standby: { label: "待机（未唤醒）", tone: "standby" },
  offline: { label: "离线", tone: "err" },
  unknown: { label: "未知", tone: "muted" },
};

export const QUALITY_LABELS: Record<ReadingQuality, { label: string; tone: "ok" | "warn" | "err" | "muted" }> = {
  valid: { label: "有效", tone: "ok" },
  stale: { label: "数据过期", tone: "warn" },
  sensor_fault: { label: "传感器故障", tone: "err" },
  out_of_range: { label: "超出范围", tone: "warn" },
  missing: { label: "无数据", tone: "muted" },
};

export type TimeRangeKey = "15m" | "1h" | "6h" | "24h" | "7d";

/** Selects appropriate API aggregation granularity for the chosen time range. */
export function resolveTimeRange(
  range: TimeRangeKey,
  nowMs: number = Date.now(),
): { from: string; to: string; granularity: "raw" | "1m" | "1h" } {
  const durations: Record<TimeRangeKey, { ms: number; granularity: "raw" | "1m" | "1h" }> = {
    "15m": { ms: 15 * 60_000, granularity: "raw" },
    "1h": { ms: 60 * 60_000, granularity: "raw" },
    "6h": { ms: 6 * 3_600_000, granularity: "1m" },
    "24h": { ms: 24 * 3_600_000, granularity: "1m" },
    "7d": { ms: 7 * 86_400_000, granularity: "1h" },
  };
  const cfg = durations[range];
  return {
    from: new Date(nowMs - cfg.ms).toISOString(),
    to: new Date(nowMs).toISOString(),
    granularity: cfg.granularity,
  };
}
