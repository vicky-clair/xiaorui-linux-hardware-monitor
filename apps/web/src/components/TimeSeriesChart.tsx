import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { Unit } from "@lhm/protocol/types";

export interface ChartSeriesInput {
  name: string;
  unit: Unit;
  /** Pairs of [timestampMs, valueOrNull]. `null` renders as an explicit gap, NEVER 0. */
  points: Array<[number, number | null]>;
}

/**
 * Pure ECharts option builder (exported for unit testing of null-gap preservation).
 */
export function buildTimeSeriesOption(
  seriesList: ChartSeriesInput[],
  unitLabel: string,
): echarts.EChartsOption {
  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f172a",
      borderColor: "#334155",
      textStyle: { color: "#f1f5f9" },
    },
    legend: {
      top: 0,
      textStyle: { color: "#cbd5e1" },
    },
    grid: { left: 56, right: 20, top: 36, bottom: 32 },
    xAxis: {
      type: "time",
      axisLabel: { color: "#94a3b8" },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: {
      type: "value",
      name: unitLabel,
      nameTextStyle: { color: "#94a3b8" },
      axisLabel: { color: "#94a3b8" },
      splitLine: { lineStyle: { color: "#1e293b" } },
    },
    series: seriesList.map((s) => ({
      name: s.name,
      type: "line" as const,
      showSymbol: false,
      connectNulls: false, // Mandatory: missing values render as breaks, never interpolated or zeroed
      data: s.points,
    })),
  };
}

export function TimeSeriesChart({
  series,
  unitLabel,
  height = 300,
}: {
  series: ChartSeriesInput[];
  unitLabel: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(buildTimeSeriesOption(series, unitLabel), true);

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [series, unitLabel]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
