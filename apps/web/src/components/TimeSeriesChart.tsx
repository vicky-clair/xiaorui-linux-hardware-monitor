// ECharts 时序折线图组件：强制 connectNulls=false 保留缺失断点（绝不补零），并自动联动 6 套浅/深色背景主题配色与多语言时间提示。
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { Unit } from "@lhm/protocol/types";
import { localeToBcp47, translate, useI18n, type Locale } from "../lib/i18n.tsx";
import { getThemeOption, useTheme, type ChartPalette } from "../lib/theme.tsx";

export interface ChartSeriesInput {
  name: string;
  unit: Unit;
  /** Pairs of [timestampMs, valueOrNull]. `null` renders as an explicit gap, NEVER 0. */
  points: Array<[number, number | null]>;
}

const DEFAULT_CHART_PALETTE: ChartPalette = getThemeOption("slate").chart;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatAxisTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Pure ECharts option builder (exported for unit testing of null-gap preservation & theme/locale adaptation).
 */
export function buildTimeSeriesOption(
  seriesList: ChartSeriesInput[],
  unitLabel: string,
  palette: ChartPalette = DEFAULT_CHART_PALETTE,
  locale: Locale = "zh",
): echarts.EChartsOption {
  const noDataText = translate(locale, "fmt.noData");
  const bcp47 = localeToBcp47(locale);

  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      textStyle: { color: palette.tooltipText },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        if (list.length === 0) return "";
        const first = list[0] as { value?: [number, number | null] };
        const ts = first?.value?.[0];
        const header =
          typeof ts === "number" && Number.isFinite(ts)
            ? new Date(ts).toLocaleString(bcp47, { hour12: false })
            : "";
        const lines = list.map((item) => {
          const row = item as {
            marker?: string;
            seriesName?: string;
            value?: [number, number | null];
          };
          const v = row.value?.[1];
          const formatted =
            typeof v === "number" && Number.isFinite(v)
              ? `${Number.isInteger(v) ? v : v.toFixed(2)} ${unitLabel}`
              : noDataText;
          return `${row.marker ?? ""}${row.seriesName ?? ""}: <b>${formatted}</b>`;
        });
        return `<div style="font-size:12px"><div style="margin-bottom:4px;opacity:0.8">${header}</div>${lines.join("<br/>")}</div>`;
      },
    },
    legend: {
      top: 0,
      textStyle: { color: palette.legendText },
    },
    grid: { left: 56, right: 20, top: 44, bottom: 36 },
    xAxis: {
      type: "time",
      axisLabel: {
        color: palette.axisLabel,
        formatter: (value: number) => formatAxisTime(value),
      },
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
      // 低频/12 小时模式采样点稀疏时显示圆点，确保单点/少点清晰可见且可悬浮查看
      showSymbol: s.points.length <= 30,
      symbolSize: 6,
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
  const { locale } = useI18n();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(buildTimeSeriesOption(series, unitLabel, themeOption.chart, locale), true);

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [series, unitLabel, themeOption.chart, locale]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
