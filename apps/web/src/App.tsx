import type { ReadingQuality, Unit } from "@lhm/protocol/types";
import { SCHEMA_VERSION } from "@lhm/protocol/types";

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
 * Formats a sensor reading value. Missing values (null) are NEVER rendered as 0.
 */
export function formatReadingValue(
  value: number | null,
  unit: Unit,
  quality: ReadingQuality,
): string {
  if (value === null || quality === "missing") {
    return "— (无数据)";
  }
  const symbol = UNIT_SYMBOLS[unit];
  return symbol ? `${value} ${symbol}` : `${value}`;
}

export function App() {
  return (
    <main>
      <h1>Linux Hardware Monitor</h1>
      <p>Protocol Schema v{SCHEMA_VERSION} — Phase 0 Scaffold</p>
    </main>
  );
}
