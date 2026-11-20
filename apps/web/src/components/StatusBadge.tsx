import type {
  CapabilityStatus,
  DeviceStatus,
  ReadingQuality,
} from "@lhm/protocol/types";
import {
  CAPABILITY_LABELS,
  DEVICE_STATUS_LABELS,
  QUALITY_LABELS,
} from "../lib/format.ts";

export function CapabilityBadge({ status }: { status: CapabilityStatus }) {
  const meta = CAPABILITY_LABELS[status] ?? { label: status, tone: "muted" };
  return (
    <span className={`badge badge-${meta.tone}`} data-capability={status}>
      {meta.label}
    </span>
  );
}

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const meta = DEVICE_STATUS_LABELS[status] ?? { label: status, tone: "muted" };
  return (
    <span className={`badge badge-${meta.tone}`} data-device-status={status}>
      {meta.label}
    </span>
  );
}

export function QualityBadge({ quality }: { quality: ReadingQuality }) {
  const meta = QUALITY_LABELS[quality] ?? { label: quality, tone: "muted" };
  return (
    <span className={`badge badge-${meta.tone}`} data-quality={quality}>
      {meta.label}
    </span>
  );
}
