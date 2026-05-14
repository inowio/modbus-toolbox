import type { AnalyzerTile, AnalyzerTileLayout } from "../../api/analyzer";
import { getChartKind } from "./chartKind";

type GridLayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minH?: number;
  static?: boolean;
};

export type GridLayout = GridLayoutItem[];

export type BreakpointLayouts = {
  desktop: GridLayout;
  mobile: GridLayout;
};

function normalizeBreakpoint(breakpoint: string | null | undefined): "desktop" | "mobile" | null {
  const bp = (breakpoint || "").trim().toLowerCase();
  if (bp === "desktop" || bp === "mobile") return bp;
  return null;
}

export function coerceGridLayout(value: unknown): GridLayout {
  if (!Array.isArray(value)) return [];
  const out: GridLayout = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const i = typeof obj.i === "string" ? obj.i : String(obj.i ?? "");
    if (!i.trim()) continue;
    const x = typeof obj.x === "number" ? obj.x : Number(obj.x ?? 0);
    const y = typeof obj.y === "number" ? obj.y : Number(obj.y ?? 0);
    const w = typeof obj.w === "number" ? obj.w : Number(obj.w ?? 1);
    const h = typeof obj.h === "number" ? obj.h : Number(obj.h ?? 1);
    const minH = typeof obj.minH === "number" ? obj.minH : Number(obj.minH ?? NaN);
    out.push({
      i,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      w: Number.isFinite(w) ? Math.max(1, w) : 1,
      h: Number.isFinite(h) ? Math.max(1, h) : 1,
      minH: Number.isFinite(minH) ? Math.max(1, minH) : undefined,
    });
  }
  return out;
}

export function coerceBreakpointLayouts(value: unknown): BreakpointLayouts {
  if (!value || typeof value !== "object") {
    return { desktop: [], mobile: [] };
  }
  const obj = value as Record<string, unknown>;
  return {
    desktop: coerceGridLayout(obj.desktop),
    mobile: coerceGridLayout(obj.mobile),
  };
}

function buildDefaultLayouts(tiles: AnalyzerTile[], breakpoint: "desktop" | "mobile"): GridLayout {
  const next: GridLayout = [];

  const cols = breakpoint === "desktop" ? 12 : 4;
  const w = breakpoint === "desktop" ? 4 : 4;
  const perRow = Math.max(1, Math.floor(cols / w));
  const rowCount = Math.max(1, Math.ceil(tiles.length / perRow));
  const rowHeights: number[] = Array.from({ length: rowCount }, () => 0);

  const isTrendTile = (t: AnalyzerTile): boolean => {
    const kind = (t.kind || "").toLowerCase();
    const chartKind = getChartKind(t.configJson);
    return kind === "trend" || (kind === "chart" && chartKind === "trend");
  };

  const minHForTile = (t: AnalyzerTile): number => (isTrendTile(t) ? 10 : 5);

  for (let idx = 0; idx < tiles.length; idx += 1) {
    const t = tiles[idx];
    const rowIdx = Math.floor(idx / perRow);
    const minH = minHForTile(t);
    rowHeights[rowIdx] = Math.max(rowHeights[rowIdx] ?? 0, minH);
  }

  const rowTops: number[] = Array.from({ length: rowCount }, () => 0);
  for (let i = 1; i < rowCount; i += 1) {
    rowTops[i] = (rowTops[i - 1] ?? 0) + (rowHeights[i - 1] ?? 0);
  }

  for (let idx = 0; idx < tiles.length; idx += 1) {
    const t = tiles[idx];
    const rowIdx = Math.floor(idx / perRow);
    const x = breakpoint === "desktop" ? (idx % perRow) * w : 0;
    const y = rowTops[rowIdx] ?? 0;
    const minH = minHForTile(t);
    next.push({ i: String(t.id), x, y, w, h: minH, minH });
  }

  return next;
}

export function buildLayoutsFromSaved(tiles: AnalyzerTile[], saved: AnalyzerTileLayout[]): BreakpointLayouts {
  const savedByBp: Record<"desktop" | "mobile", Map<number, AnalyzerTileLayout>> = {
    desktop: new Map(),
    mobile: new Map(),
  };

  for (const row of saved) {
    const bp = normalizeBreakpoint(row.breakpoint);
    if (!bp) continue;
    savedByBp[bp].set(row.tileId, row);
  }

  const layouts: BreakpointLayouts = {
    desktop: buildDefaultLayouts(tiles, "desktop"),
    mobile: buildDefaultLayouts(tiles, "mobile"),
  };

  for (const bp of ["desktop", "mobile"] as const) {
    const base = layouts[bp] ?? [];
    layouts[bp] = base.map((l) => {
      const tileId = Number(l.i);
      const savedRow = savedByBp[bp].get(tileId) ?? null;
      if (!savedRow) return l;
      const minH = l.minH ?? 1;
      return {
        ...l,
        x: Number(savedRow.x) || 0,
        y: Number(savedRow.y) || 0,
        w: Math.max(1, Number(savedRow.w) || l.w),
        h: Math.max(minH, Number(savedRow.h) || l.h),
      };
    });
  }

  return layouts;
}
