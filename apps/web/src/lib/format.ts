import type {
  CapabilityStatus,
  DeviceStatus,
  ReadingQuality,
  Unit,
} from "@lhm/protocol/types";
import { localeToBcp47, translate, type Locale } from "./i18n.tsx";

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
  locale: Locale = "zh",
): string {
  if (value === null || value === undefined || quality === "missing") {
    return translate(locale, "fmt.noData");
  }
  if (quality === "sensor_fault") {
    return translate(locale, "fmt.sensorFault");
  }
  if (unit === "byte") {
    return formatBytes(value, locale);
  }
  if (unit === "byte_per_second") {
    return formatBytesPerSecond(value, locale);
  }
  if (unit === "hertz") {
    return formatHertz(value, locale);
  }
  const symbol = UNIT_SYMBOLS[unit];
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return symbol ? `${rounded} ${symbol}` : rounded;
}

export function formatBytes(bytes: number, locale: Locale = "zh"): string {
  if (!Number.isFinite(bytes)) return translate(locale, "fmt.noData");
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

export function formatBytesPerSecond(bps: number, locale: Locale = "zh"): string {
  if (!Number.isFinite(bps)) return translate(locale, "fmt.noData");
  if (bps === 0) return "0 B/s";
  const mbps = bps / 125_000;
  if ([10, 100, 1000, 2500, 5000, 10000, 25000, 40000, 100000].includes(Math.round(mbps))) {
    const roundedMbps = Math.round(mbps);
    const mbSec = (bps / 1_000_000).toFixed(0);
    return `${roundedMbps} Mbps (${mbSec} MB/s)`;
  }
  return `${formatBytes(bps, locale)}/s`;
}

export function formatHertz(hz: number, locale: Locale = "zh"): string {
  if (!Number.isFinite(hz)) return translate(locale, "fmt.noData");
  if (hz === 0) return "0 Hz";
  if (hz >= 1_000_000_000) return `${(hz / 1_000_000_000).toFixed(2)} GHz`;
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(0)} MHz`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

/** Formats UTC RFC 3339 timestamps in the browser's local timezone and active locale. */
export function formatLocalTime(
  iso: string | null | undefined,
  locale: Locale = "zh",
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(localeToBcp47(locale), { hour12: false });
}

export function formatUptime(
  seconds: number | null | undefined,
  locale: Locale = "zh",
): string {
  if (seconds === null || seconds === undefined) return "—";
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const dUnit = translate(locale, "fmt.day");
  const hUnit = translate(locale, "fmt.hour");
  const mUnit = translate(locale, "fmt.min");
  if (days > 0) return `${days} ${dUnit} ${hrs} ${hUnit} ${mins} ${mUnit}`;
  if (hrs > 0) return `${hrs} ${hUnit} ${mins} ${mUnit}`;
  return `${mins} ${mUnit}`;
}

export const CAPABILITY_LABELS: Record<
  CapabilityStatus,
  { label: string; tone: "ok" | "warn" | "muted" | "err" }
> = {
  supported: { label: "支持", tone: "ok" },
  unsupported: { label: "硬件不支持", tone: "muted" },
  permission_denied: { label: "权限不足", tone: "warn" },
  unavailable: { label: "暂不可用", tone: "muted" },
  unknown: { label: "未知", tone: "muted" },
};

export const DEVICE_STATUS_LABELS: Record<
  DeviceStatus,
  { label: string; tone: "ok" | "standby" | "err" | "muted" }
> = {
  online: { label: "在线", tone: "ok" },
  standby: { label: "待机（未唤醒）", tone: "standby" },
  offline: { label: "离线", tone: "err" },
  unknown: { label: "未知", tone: "muted" },
};

export const QUALITY_LABELS: Record<
  ReadingQuality,
  { label: string; tone: "ok" | "warn" | "err" | "muted" }
> = {
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
