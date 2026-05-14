import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, DataZoomComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);

export type AnalyzerTrendPoint = {
  tsMs: number;
  value: number | null;
};

export default function AnalyzerTrendTile(props: {
  title: string;
  points: AnalyzerTrendPoint[];
  nowTsMs: number;
  windowMs: number | null;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const resizeTimeoutIdsRef = useRef<number[]>([]);

  const [isDark, setIsDark] = useState<boolean>(() => {
    return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  });

  const [renderPoints, setRenderPoints] = useState<AnalyzerTrendPoint[]>(() => props.points);
  const throttleTimerRef = useRef<number | null>(null);
  const pendingPointsRef = useRef<AnalyzerTrendPoint[] | null>(null);
  const latestPointsRef = useRef(props.points);
  latestPointsRef.current = props.points;

  const lastWindowMsRef = useRef<number | null>(props.windowMs);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });

    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const option = useMemo<EChartsOption>(() => {
    const data = renderPoints.map((p) => [p.tsMs, p.value] as [number, number | null]);

    const recent = renderPoints.length > 200 ? renderPoints.slice(renderPoints.length - 200) : renderPoints;
    const isBinary = recent.every((p) => p.value == null || p.value === 0 || p.value === 1);

    const maxTs = props.nowTsMs;
    const minTs = props.windowMs != null ? maxTs - props.windowMs : null;

    const axisLine = isDark ? "rgba(148, 163, 184, 0.4)" : "rgba(100, 116, 139, 0.45)";
    const axisLabel = isDark ? "rgba(226, 232, 240, 0.8)" : "rgba(15, 23, 42, 0.75)";
    const splitLine = isDark ? "rgba(148, 163, 184, 0.12)" : "rgba(100, 116, 139, 0.16)";

    const trendLine = isDark ? "rgba(16, 185, 129, 0.95)" : "rgba(5, 150, 105, 0.95)";
    const trendFill = isDark ? "rgba(16, 185, 129, 0.12)" : "rgba(5, 150, 105, 0.12)";

    const tooltipBg = isDark ? "rgba(2, 6, 23, 0.92)" : "rgba(255, 255, 255, 0.96)";
    const tooltipBorder = isDark ? "rgba(148, 163, 184, 0.22)" : "rgba(100, 116, 139, 0.22)";
    const tooltipText = isDark ? "rgba(226, 232, 240, 0.92)" : "rgba(15, 23, 42, 0.92)";

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 44, right: 18, top: 14, bottom: 34 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText },
      },
      xAxis: {
        type: "time",
        min: minTs ?? undefined,
        max: maxTs,
        axisLine: { lineStyle: { color: axisLine } },
        axisLabel: { color: axisLabel },
        splitLine: { lineStyle: { color: splitLine } },
      },
      yAxis: {
        type: "value",
        axisLine: { lineStyle: { color: axisLine } },
        axisLabel: { color: axisLabel },
        splitLine: { lineStyle: { color: splitLine } },
        scale: true,
      },
      dataZoom: [
        {
          type: "inside",
          filterMode: "none",
          startValue: minTs ?? undefined,
          endValue: maxTs,
        },
      ],
      series: [
        {
          name: props.title,
          type: "line",
          showSymbol: false,
          step: isBinary ? "end" : undefined,
          connectNulls: false,
          lineStyle: { width: 2, color: trendLine },
          areaStyle: { color: trendFill },
          data,
        },
      ],
    } satisfies EChartsOption;
  }, [isDark, props.nowTsMs, renderPoints, props.title, props.windowMs]);

  function clearResizeTimers() {
    for (const id of resizeTimeoutIdsRef.current) {
      window.clearTimeout(id);
    }
    resizeTimeoutIdsRef.current = [];
  }

  function tryResizeOnce(): boolean {
    const host = hostRef.current;
    const inst = chartRef.current?.getEchartsInstance?.();
    if (!host || !inst?.resize) return false;

    const rect = host.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    inst.resize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    return true;
  }

  function scheduleResize(attempts: number) {
    clearResizeTimers();

    const step = (remaining: number) => {
      if (tryResizeOnce()) return;
      if (remaining <= 0) return;

      const id = window.setTimeout(() => {
        step(remaining - 1);
      }, 60);
      resizeTimeoutIdsRef.current.push(id);
    };

    step(attempts);
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    scheduleResize(80);

    const ro = new ResizeObserver(() => {
      scheduleResize(24);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      clearResizeTimers();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current != null) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      pendingPointsRef.current = null;

      const inst = chartRef.current?.getEchartsInstance?.();
      if (!inst?.dispose) return;
      try {
        inst.dispose();
      } catch {
      }
    };
  }, []);

  useEffect(() => {
    if (lastWindowMsRef.current === props.windowMs) return;
    lastWindowMsRef.current = props.windowMs;

    if (throttleTimerRef.current != null) {
      window.clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    pendingPointsRef.current = null;
    setRenderPoints(latestPointsRef.current);
  }, [props.windowMs]);

  useEffect(() => {
    pendingPointsRef.current = props.points;
    if (throttleTimerRef.current != null) return;

    throttleTimerRef.current = window.setTimeout(() => {
      throttleTimerRef.current = null;
      const next = pendingPointsRef.current;
      pendingPointsRef.current = null;
      if (next) {
        setRenderPoints(next);
      }
    }, 250);
  }, [props.points]);

  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance?.();
    if (!inst?.dispatchAction) return;
    if (props.windowMs == null) return;

    const maxTs = props.nowTsMs;
    const minTs = maxTs - props.windowMs;
    inst.dispatchAction({
      type: "dataZoom",
      dataZoomIndex: 0,
      startValue: minTs,
      endValue: maxTs,
    });
  }, [props.nowTsMs, props.windowMs]);

  return (
    <div ref={hostRef} className="h-full w-full" style={{ width: "100%", height: "100%" }}>
      <ReactEChartsCore
        ref={chartRef}
        echarts={echarts}
        option={option}
        lazyUpdate
        notMerge
        opts={{ renderer: "canvas" }}
        onChartReady={() => {
          scheduleResize(80);
        }}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
