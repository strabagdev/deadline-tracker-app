"use client";

import React, { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import type { ECharts, EChartsOption } from "echarts/core";
import {
  BarChart as EChartsBarChart,
  LineChart as EChartsLineChart,
  PieChart as EChartsPieChart,
} from "echarts/charts";
import {
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  EChartsBarChart,
  CanvasRenderer,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  EChartsLineChart,
  EChartsPieChart,
  TitleComponent,
  TooltipComponent,
]);

type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

type ChartPoint = {
  label: string;
  value: number;
};

function formatValue(value: number) {
  return new Intl.NumberFormat("es-CL").format(value);
}

function BaseEChart({
  option,
  height = 260,
}: {
  option: EChartsOption;
  height?: number;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const chart = echarts.getInstanceByDom(node) ?? echarts.init(node, undefined, {
      renderer: "canvas",
    });
    chartRef.current = chart;
    chart.setOption(option, true);

    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          chart.resize();
        })
      : null;

    observer?.observe(node);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [option]);

  return <div ref={rootRef} style={{ height }} aria-hidden />;
}

export function DonutChart({
  slices,
  centerLabel,
}: {
  slices: DonutSlice[];
  centerLabel: string;
}) {
  const total = slices.reduce((acc, slice) => acc + slice.value, 0);
  const donutCenterX = "30%";
  const donutCenterY = "50%";
  const option: EChartsOption = {
    animationDuration: 350,
    color: slices.map((slice) => slice.color),
    graphic: [
      {
        type: "group",
        left: donutCenterX,
        top: donutCenterY,
        z: 10,
        bounding: "raw",
        children: [
          {
            type: "text",
            x: 0,
            y: -12,
            style: {
              text: "Total",
              textAlign: "center",
              textVerticalAlign: "middle",
              fill: "#64748b",
              fontSize: 11,
              fontFamily: "sans-serif",
            },
          },
          {
            type: "text",
            x: 0,
            y: 10,
            style: {
              text: formatValue(total),
              textAlign: "center",
              textVerticalAlign: "middle",
              fill: "#0f172a",
              fontSize: 22,
              fontWeight: 700,
              fontFamily: "sans-serif",
            },
          },
        ],
      },
    ],
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 0,
      top: "middle",
      itemWidth: 10,
      itemHeight: 10,
      icon: "circle",
      itemGap: 10,
      textStyle: {
        color: "#475569",
        fontSize: 12,
        overflow: "truncate",
        width: 132,
      },
      formatter(name) {
        const slice = slices.find((item) => item.label === name);
        if (!slice) return name;
        const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
        return `${name} ${formatValue(slice.value)} (${pct}%)`;
      },
    },
    series: [
      {
        type: "pie",
        radius: ["52%", "72%"],
        center: [donutCenterX, donutCenterY],
        avoidLabelOverlap: true,
        label: { show: false },
        emphasis: {
          scale: true,
          label: { show: false },
        },
        data: slices.map((slice) => ({
          name: slice.label,
          value: slice.value,
          itemStyle: { color: slice.color },
        })),
      },
    ],
    tooltip: {
      trigger: "item",
      formatter(params) {
        const item = Array.isArray(params) ? params[0] : params;
        const percent = typeof item.percent === "number" ? item.percent : 0;
        return `${item.name}<br/>${formatValue(Number(item.value ?? 0))} (${percent}%)`;
      },
    },
    aria: {
      enabled: true,
      decal: { show: false },
      label: { description: centerLabel },
    },
  };

  return <BaseEChart option={option} height={240} />;
}

export function BarChart({
  points,
}: {
  points: ChartPoint[];
}) {
  const option: EChartsOption = {
    animationDuration: 350,
    grid: {
      left: 8,
      right: 8,
      top: 8,
      bottom: 8,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter(params) {
        const item = Array.isArray(params) ? params[0] : params;
        return `${item.name}<br/>${formatValue(Number(item.value ?? 0))}`;
      },
    },
    xAxis: {
      type: "value",
      axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.2)" } },
    },
    yAxis: {
      type: "category",
      data: points.map((point) => point.label),
      axisLabel: {
        color: "#475569",
        width: 140,
        overflow: "truncate",
      },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        data: points.map((point) => point.value),
        barWidth: 14,
        itemStyle: {
          color: "#0ea5e9",
          borderRadius: [0, 999, 999, 0],
        },
      },
    ],
  };

  return <BaseEChart option={option} height={Math.max(180, points.length * 38)} />;
}

export function TrendLineChart({
  points,
}: {
  points: ChartPoint[];
}) {
  if (points.length === 0) return null;

  const option: EChartsOption = {
    animationDuration: 350,
    grid: {
      left: 8,
      right: 12,
      top: 16,
      bottom: 48,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      formatter(params) {
        const item = Array.isArray(params) ? params[0] : params;
        return `${item.name}<br/>${formatValue(Number(item.value ?? 0))}`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.label),
      axisLabel: {
        color: "#64748b",
        rotate: points.length > 6 ? 30 : 0,
      },
      axisLine: {
        lineStyle: { color: "rgba(148,163,184,0.45)" },
      },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.2)" } },
    },
    series: [
      {
        type: "line",
        data: points.map((point) => point.value),
        smooth: false,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: {
          color: "#0ea5e9",
          width: 3,
        },
        itemStyle: {
          color: "#0284c7",
        },
        areaStyle: {
          color: "rgba(14,165,233,0.14)",
        },
      },
    ],
  };

  return <BaseEChart option={option} height={260} />;
}
