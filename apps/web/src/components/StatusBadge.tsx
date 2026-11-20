import type {
  CapabilityStatus,
  DeviceStatus,
  ReadingQuality,
} from "@lhm/protocol/types";
import {
  translateCapability,
  translateDeviceStatus,
  translateQuality,
  useI18n,
} from "../lib/i18n.tsx";

export function CapabilityBadge({ status }: { status: CapabilityStatus }) {
  const { locale } = useI18n();
  const meta = translateCapability(locale, status);
  return (
    <span className={`badge badge-${meta.tone}`} data-capability={status}>
      {meta.label}
    </span>
  );
}

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const { locale } = useI18n();
  const meta = translateDeviceStatus(locale, status);
  return (
    <span className={`badge badge-${meta.tone}`} data-device-status={status}>
      {meta.label}
    </span>
  );
}

export function QualityBadge({ quality }: { quality: ReadingQuality }) {
  const { locale } = useI18n();
  const meta = translateQuality(locale, quality);
  return (
    <span className={`badge badge-${meta.tone}`} data-quality={quality}>
      {meta.label}
    </span>
  );
}
