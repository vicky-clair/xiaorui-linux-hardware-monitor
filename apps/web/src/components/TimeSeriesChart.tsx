import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { Unit } from "@lhm/protocol/types";
import { getThemeOption, useTheme, type ChartPalette } from "../lib/theme.tsx";

export interface ChartSeriesInput {
  name: string;
  unit: Unit;
  /** Pairs of [timestampMs, valueOrNull]. `null` renders as an explicit gap, NEVER 0. */
  points: Array<[number, number | null]>;
}

const DEFAULT_CHART_PALETTE: ChartPalette = getThemeOption("slate").chart;

/**
 * Pure ECharts option builder (exported for unit testing of null-gap preservation & theme adaptation).
 */
export function buildTimeSeriesOption(
  seriesList: ChartSeriesInput[],
  unitLabel: string,
  palette: ChartPalette = DEFAULT_CHART_PALETTE,
): echarts.EChartsOption {
  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      textStyle: { color: palette.tooltipText },
    },
    legend: {
      top: 0,
      textStyle: { color: palette.legendText },
    },
    grid: { left: 56, right: 20, top: 36, bottom: 32 },
    xAxis: {
      type: "time",
      axisLabel: { color: palette.axisLabel },
      axisLine: { lineStyle: { color: palette.axisLine } },
    },
    yAxis: {
      type: "value",
      name: unitLabel,
      nameTextStyle: { color: palette.axisLabel },
      axisLabel: { color: palette.axisLabel },
      splitLine: { lineStyle: { color: palette.splitLine } },
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
  const { themeOption } = useTheme();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(buildTimeSeriesOption(series, unitLabel, themeOption.chart), true);

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [series, unitLabel, themeOption.chart]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
