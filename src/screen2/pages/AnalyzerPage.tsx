import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { Screen2OutletContext } from "../Screen2Layout";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useErrorToast, useToast } from "../../components/ToastProvider";
import { FiActivity, FiSave } from "react-icons/fi";
import {
  createAnalyzerTile,
  deleteAnalyzerTile,
  listAnalyzerSignals,
  listAnalyzerTileLayouts,
  listAnalyzerTileSignals,
  listAnalyzerTiles,
  saveAnalyzerTileLayouts,
  setAnalyzerTilePollingEnabled,
  startAnalyzerPolling,
  stopAnalyzerPolling,
  updateAnalyzerTile,
  type AnalyzerSignal,
  type AnalyzerTile,
  type AnalyzerTileSignalInfo,
} from "../api/analyzer";
import {
  decodeAnalyzerSignal,
  parseAnalyzerRawSnapshotFromJson,
} from "../utils/analyzerSignalDecoder";
import { listSlaves, type SlaveItem } from "../api/slaves";
import type { AnalyzerTrendPoint } from "../components/AnalyzerTrendTile";
import {
  ConnectionSettings as GlobalConnectionSettings,
  ConnectionSettingsForm,
  PortItem as SerialPortItem,
  normalizeConnectionSettings,
} from "../components/ConnectionSettingsForm";
import AnalyzerHeaderCard from "./analyzer/AnalyzerHeaderCard";
import AnalyzerTilesCard from "./analyzer/AnalyzerTilesCard";
import AnalyzerAddEditTileModal from "./analyzer/AnalyzerAddEditTileModal";
import AnalyzerConfigureSignalsModal from "./analyzer/AnalyzerConfigureSignalsModal";
import { getChartKind } from "./analyzer/chartKind";
import type { BreakpointLayouts, GridLayout } from "./analyzer/layoutTypes";
import { buildLayoutsFromSaved } from "./analyzer/layoutTypes";
import { logEvent, type LogLevel } from "../api/logs";
import { formatAnalyzerAddress, type AnalyzerAddressFormat } from "../utils/analyzerAddressFormat";

type AnalyzerSignalUpdate = {
  workspace: string;
  signalId: string;
  tsMs: number;
  state: string;
  error?: string | null;
  rawWords?: number[] | null;
  rawBools?: boolean[] | null;
};

type AnalyzerPollingBackoffEvent = {
  workspace: string;
  reason: string;
  retryInMs: number;
  attempt: number;
};

export default function AnalyzerPage() {
  const { workspace } = useOutletContext<Screen2OutletContext>();
  const { pushToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pollingWanted, setPollingWanted] = useState(false);
  const pollingWantedRef = useRef(pollingWanted);
  pollingWantedRef.current = pollingWanted;

  const [nowTsMs, setNowTsMs] = useState<number>(() => Date.now());

  const [tiles, setTiles] = useState<AnalyzerTile[]>([]);
  const tilesRef = useRef(tiles);
  const [tileSignals, setTileSignals] = useState<Record<number, AnalyzerTileSignalInfo[]>>({});
  const tileSignalsRef = useRef(tileSignals);

  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [gridLayouts, setGridLayouts] = useState<BreakpointLayouts>({ desktop: [], mobile: [] });
  const layoutSaveTimerRef = useRef<number | null>(null);
  const gridHostRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState<number>(0);
  const gridWidthMeasureTimerRef = useRef<number | null>(null);
  const lastMeasuredGridWidthRef = useRef<number>(0);

  const [signals, setSignals] = useState<AnalyzerSignal[]>([]);

  const [configureSignalsOpen, setConfigureSignalsOpen] = useState(false);

  const [tileModalOpen, setTileModalOpen] = useState(false);
  const [tileModalMode, setTileModalMode] = useState<"add" | "edit">("add");
  const [tileModalInitialKind, setTileModalInitialKind] = useState<"trend" | "value">("value");
  const [tileModalEditingTile, setTileModalEditingTile] = useState<AnalyzerTile | null>(null);
  const [tileModalBusy, setTileModalBusy] = useState(false);
  const [tileModalError, setTileModalError] = useState<string | null>(null);

  const [slaves, setSlaves] = useState<SlaveItem[]>([]);

  const [liveUpdates, setLiveUpdates] = useState<Record<string, AnalyzerSignalUpdate>>({});
  const [historyByTileId, setHistoryByTileId] = useState<Record<number, AnalyzerTrendPoint[]>>({});
  const [trendWindowMinutes, setTrendWindowMinutes] = useState<number | null>(5);
  const [addressFormat, setAddressFormat] = useState<AnalyzerAddressFormat>("dec");
  const signalInfoBySignalIdRef = useRef<Record<string, AnalyzerTileSignalInfo>>({});
  const pendingLiveUpdatesRef = useRef<Record<string, AnalyzerSignalUpdate>>({});
  const pendingHistoryPointsRef = useRef<Record<number, AnalyzerTrendPoint[]>>({});
  const pendingFlushTimerRef = useRef<number | null>(null);
  const pendingHistoryFlushTimerRef = useRef<number | null>(null);

  const trendWindowMs = useMemo(() => {
    if (trendWindowMinutes == null) return null;
    const n = Number(trendWindowMinutes);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 60_000);
  }, [trendWindowMinutes]);

  const trendWindowMsRef = useRef(trendWindowMs);
  trendWindowMsRef.current = trendWindowMs;

  const historyMaxPoints = useMemo(() => {
    const HARD_CAP = 5000;
    if (trendWindowMs == null) return HARD_CAP;
    const approxPoints = Math.ceil(trendWindowMs / 250);
    return Math.max(300, Math.min(HARD_CAP, approxPoints));
  }, [trendWindowMs]);

  const historyMaxPointsRef = useRef(historyMaxPoints);
  historyMaxPointsRef.current = historyMaxPoints;

  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [connectionFormValue, setConnectionFormValue] = useState<GlobalConnectionSettings | null>(null);
  const [connectionSerialPorts, setConnectionSerialPorts] = useState<SerialPortItem[]>([]);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [connectionTestMessage, setConnectionTestMessage] = useState<string | null>(null);
  const [connectionTestError, setConnectionTestError] = useState<string | null>(null);

  const [confirmDeleteTile, setConfirmDeleteTile] = useState<AnalyzerTile | null>(null);
  const [deletingTileId, setDeletingTileId] = useState<number | null>(null);
  const [deleteTileError, setDeleteTileError] = useState<string | null>(null);

  const workspaceName = workspace.name;
  const workspaceNameRef = useRef(workspaceName);
  workspaceNameRef.current = workspaceName;

  function logWorkspace(level: LogLevel, message: string, detailsJson?: unknown) {
    const name = workspaceNameRef.current;
    void logEvent({
      scope: "workspace",
      level,
      workspaceName: name,
      source: "AnalyzerPage",
      message,
      detailsJson,
    }).catch(() => {
    });
  }

  async function openConnectionModal() {
    try {
      const [settingsValue, ports] = await Promise.all([
        invoke<GlobalConnectionSettings>("get_connection_settings", { name: workspaceName }),
        invoke<SerialPortItem[]>("list_serial_ports"),
      ]);

      setConnectionFormValue(normalizeConnectionSettings(settingsValue));
      setConnectionSerialPorts(ports);
      setConnectionTestMessage(null);
      setConnectionTestError(null);
      setConnectionModalOpen(true);
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveConnectionFromModal() {
    if (!connectionFormValue) return;
    setConnectionSaving(true);
    setConnectionTestMessage(null);
    setConnectionTestError(null);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      await invoke<void>("set_connection_settings", {
        name: workspaceName,
        settings: connectionFormValue,
        nowIso,
      });
      setConnectionModalOpen(false);
      pushToast("Saved connection settings", "info");
    } catch (e) {
      setError(String(e));
    } finally {
      setConnectionSaving(false);
    }
  }

  async function testConnectionFromModal() {
    if (!connectionFormValue) return;
    setConnectionTesting(true);
    setConnectionTestMessage(null);
    setConnectionTestError(null);
    setError(null);
    try {
      await invoke<void>("test_connection", {
        name: workspaceName,
        settings: connectionFormValue,
      });
      setConnectionTestMessage("Connection test succeeded.");
    } catch (e) {
      const msg = String(e);
      setConnectionTestError(msg);
      setError(msg);
    } finally {
      setConnectionTesting(false);
    }
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTsMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    tileSignalsRef.current = tileSignals;
  }, [tileSignals]);

  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);

  const slavesById = useMemo(() => {
    const out = new Map<number, { pollIntervalMs: number }>();
    for (const s of slaves) {
      out.set(s.id, { pollIntervalMs: s.pollIntervalMs });
    }
    return out;
  }, [slaves]);

  const signalsById = useMemo(() => {
    const out = new Map<string, AnalyzerSignal>();
    for (const s of signals) {
      out.set(s.id, s);
    }
    return out;
  }, [signals]);

  function getSignalPollIntervalMs(signalId: string): number {
    const sig = signalsById.get(signalId) ?? null;
    if (!sig) return 1000;
    const slave = slavesById.get(sig.slaveId) ?? null;
    const interval = slave?.pollIntervalMs ?? 0;
    return interval > 0 ? interval : 1000;
  }

  useEffect(() => {
    const next: Record<string, AnalyzerTileSignalInfo> = {};
    for (const links of Object.values(tileSignals)) {
      for (const l of links) {
        if (!next[l.signalId]) {
          next[l.signalId] = l;
        }
      }
    }
    signalInfoBySignalIdRef.current = next;
  }, [tileSignals]);

  useEffect(() => {
    return () => {
      if (pendingFlushTimerRef.current != null) {
        window.clearTimeout(pendingFlushTimerRef.current);
        pendingFlushTimerRef.current = null;
      }

      if (pendingHistoryFlushTimerRef.current != null) {
        window.clearTimeout(pendingHistoryFlushTimerRef.current);
        pendingHistoryFlushTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = gridHostRef.current;
    if (!el) return;

    const measureAndSet = () => {
      gridWidthMeasureTimerRef.current = null;
      const next = Math.round(el.getBoundingClientRect().width);
      if (!Number.isFinite(next) || next <= 0) return;
      if (Math.abs(next - lastMeasuredGridWidthRef.current) < 2) return;
      lastMeasuredGridWidthRef.current = next;
      setGridWidth(next);
    };

    const schedule = () => {
      if (gridWidthMeasureTimerRef.current != null) {
        window.clearTimeout(gridWidthMeasureTimerRef.current);
      }
      gridWidthMeasureTimerRef.current = window.setTimeout(measureAndSet, 120);
    };

    schedule();

    const ro = new ResizeObserver(() => {
      schedule();
    });

    ro.observe(el);
    return () => {
      ro.disconnect();
      if (gridWidthMeasureTimerRef.current != null) {
        window.clearTimeout(gridWidthMeasureTimerRef.current);
        gridWidthMeasureTimerRef.current = null;
      }
    };
  }, [layoutEditMode, tiles.length]);

  useEffect(() => {
    return () => {
      if (layoutSaveTimerRef.current != null) {
        window.clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
    };
  }, []);

  useErrorToast(error);
  useErrorToast(deleteTileError);

  function flushPendingUiUpdates() {
    const pendingLive = pendingLiveUpdatesRef.current;
    pendingLiveUpdatesRef.current = {};
    pendingFlushTimerRef.current = null;

    const liveKeys = Object.keys(pendingLive);
    if (liveKeys.length > 0) {
      setLiveUpdates((prev) => ({
        ...prev,
        ...pendingLive,
      }));
    }
  }

  function flushPendingHistoryUpdates() {
    const pendingHistory = pendingHistoryPointsRef.current;
    pendingHistoryPointsRef.current = {};
    pendingHistoryFlushTimerRef.current = null;

    const histKeys = Object.keys(pendingHistory);
    if (histKeys.length > 0) {
      const now = Date.now();
      const currentTrendWindowMs = trendWindowMsRef.current;
      const currentHistoryMaxPoints = historyMaxPointsRef.current;
      const cutoff = currentTrendWindowMs != null ? now - currentTrendWindowMs : null;
      setHistoryByTileId((prev) => {
        const next = { ...prev };
        for (const k of histKeys) {
          const tileId = Number(k);
          if (!Number.isFinite(tileId) || tileId <= 0) continue;

          const existing = next[tileId] ?? [];
          const more = pendingHistory[tileId] ?? [];
          if (more.length === 0) continue;
          const combined = [...existing, ...more];

          const prunedByTime =
            cutoff != null ? combined.filter((p) => (p.tsMs ?? 0) >= cutoff) : combined;
          next[tileId] =
            prunedByTime.length > currentHistoryMaxPoints
              ? prunedByTime.slice(prunedByTime.length - currentHistoryMaxPoints)
              : prunedByTime;
        }
        return next;
      });
    }
  }

  useEffect(() => {
    const now = Date.now();
    const cutoff = trendWindowMs != null ? now - trendWindowMs : null;
    setHistoryByTileId((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      const next: Record<number, AnalyzerTrendPoint[]> = {};
      let changed = false;
      for (const k of keys) {
        const tileId = Number(k);
        if (!Number.isFinite(tileId) || tileId <= 0) continue;

        const points = prev[tileId] ?? [];
        const prunedByTime = cutoff != null ? points.filter((p) => (p.tsMs ?? 0) >= cutoff) : points;
        const pruned =
          prunedByTime.length > historyMaxPoints
            ? prunedByTime.slice(prunedByTime.length - historyMaxPoints)
            : prunedByTime;
        next[tileId] = pruned;
        if (pruned.length !== points.length) changed = true;
      }
      return changed ? next : prev;
    });
  }, [historyMaxPoints, trendWindowMs]);

  useEffect(() => {
    const active = new Set<number>(tiles.map((t) => t.id));
    setHistoryByTileId((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;

      let changed = false;
      const next: Record<number, AnalyzerTrendPoint[]> = {};
      for (const k of keys) {
        const tileId = Number(k);
        if (!Number.isFinite(tileId) || tileId <= 0) continue;
        const points = prev[tileId] ?? [];
        if (!active.has(tileId)) {
          changed = true;
          continue;
        }
        next[tileId] = points;
      }
      return changed ? next : prev;
    });
  }, [tiles]);

  function deriveNumericSample(update: AnalyzerSignalUpdate, info: AnalyzerTileSignalInfo): number | null {
    const state = (update.state || "").toUpperCase();
    if (state !== "OK") return null;

    const rawWords = update.rawWords ?? null;
    const rawBools = update.rawBools ?? null;
    const decoded = decodeAnalyzerSignal({
      state,
      error: update.error ?? null,
      rawWords,
      rawBools,
      functionCode: info.functionCode,
      dataType: info.dataType,
      order: info.order,
      displayFormat: info.displayFormat,
      decoderJson: info.decoderJson,
    });

    if (!decoded.ok) return null;
    if (decoded.value.kind === "bool") return decoded.value.value ? 1 : 0;
    if (decoded.value.kind === "bigint") {
      const n = Number(decoded.value.value);
      return Number.isFinite(n) ? n : null;
    }
    return Number.isFinite(decoded.value.value) ? decoded.value.value : null;
  }

  function openAddTileModal(kind: "trend" | "value") {
    setTileModalError(null);
    setTileModalMode("add");
    setTileModalInitialKind(kind);
    setTileModalEditingTile(null);
    setTileModalOpen(true);
  }

  function openAddTileModalDefault() {
    openAddTileModal("value");
  }

  function openEditTileModal(tile: AnalyzerTile) {
    setTileModalError(null);
    setTileModalMode("edit");
    setTileModalInitialKind("value");
    setTileModalEditingTile(tile);
    setTileModalOpen(true);
  }

  async function refreshSignals() {
    const rows = await listAnalyzerSignals(workspaceName);
    setSignals(rows);
  }

  async function refreshSlaves() {
    const rows = await listSlaves(workspaceName);
    setSlaves(rows);
  }

  async function refreshTiles(): Promise<AnalyzerTile[]> {
    const rows = await listAnalyzerTiles(workspaceName);
    setTiles(rows);

    if (rows.length === 0) {
      setLayoutEditMode(false);
    }

    const [perTile, savedLayouts] = await Promise.all([
      Promise.all(
        rows.map(async (t) => {
          const links = await listAnalyzerTileSignals(workspaceName, t.id);
          return { tileId: t.id, links };
        }),
      ),
      listAnalyzerTileLayouts(workspaceName),
    ]);

    const next: Record<number, AnalyzerTileSignalInfo[]> = {};
    for (const t of perTile) {
      next[t.tileId] = t.links;
    }
    setTileSignals(next);

    setGridLayouts(buildLayoutsFromSaved(rows, savedLayouts));

    return rows;
  }

  async function deleteTile(tile: AnalyzerTile) {
    setConfirmDeleteTile(tile);
  }

  function schedulePersistLayouts(breakpoint: "desktop" | "mobile", layout: GridLayout) {
    if (!layoutEditMode) return;

    if (layoutSaveTimerRef.current != null) {
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }

    layoutSaveTimerRef.current = window.setTimeout(() => {
      const ws = workspaceNameRef.current;
      void (async () => {
        try {
          await Promise.all(
            layout.map(async (item) => {
              const tileId = Number(item.i);
              if (!Number.isFinite(tileId) || tileId <= 0) return;
              await saveAnalyzerTileLayouts(ws, tileId, [
                {
                  breakpoint,
                  x: Math.max(0, Math.round(item.x)),
                  y: Math.max(0, Math.round(item.y)),
                  w: Math.max(1, Math.round(item.w)),
                  h: Math.max(1, Math.round(item.h)),
                },
              ]);
            }),
          );
        } catch (e) {
          setError(String(e));
        }
      })();
    }, 650);
  }

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      const [, , nextTiles] = await Promise.all([refreshSignals(), refreshSlaves(), refreshTiles()]);

      if (pollingWantedRef.current && nextTiles.length > 0) {
        await startAnalyzerPolling(workspaceName);
      }
    } catch (e) {
      logWorkspace("error", "Analyzer refresh failed", { error: String(e) });
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onStartPolling() {
    setError(null);

    if (tiles.length === 0) {
      pushToast("Add a tile to start polling", "info");
      return;
    }

    setPollingWanted(true);
    pollingWantedRef.current = true;
    try {
      logWorkspace("info", "Analyzer polling start requested");
      await startAnalyzerPolling(workspaceName);
      pushToast("Polling started", "info");
      logWorkspace("info", "Analyzer polling started");
    } catch (e) {
      logWorkspace("error", "Analyzer polling start failed", { error: String(e) });
      setError(String(e));
    }
  }

  async function onStopPolling() {
    setError(null);
    setPollingWanted(false);
    pollingWantedRef.current = false;

    pendingLiveUpdatesRef.current = {};
    pendingHistoryPointsRef.current = {};
    if (pendingFlushTimerRef.current != null) {
      window.clearTimeout(pendingFlushTimerRef.current);
      pendingFlushTimerRef.current = null;
    }
    if (pendingHistoryFlushTimerRef.current != null) {
      window.clearTimeout(pendingHistoryFlushTimerRef.current);
      pendingHistoryFlushTimerRef.current = null;
    }
    try {
      logWorkspace("info", "Analyzer polling stop requested");
      await stopAnalyzerPolling(workspaceName);
      pushToast("Polling stopped", "info");
      logWorkspace("info", "Analyzer polling stopped");
    } catch (e) {
      logWorkspace("error", "Analyzer polling stop failed", { error: String(e) });
      setError(String(e));
    }
  }

  useEffect(() => {
    void refreshAll();
  }, [workspaceName]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let unlistenStopped: UnlistenFn | null = null;
    let unlistenBackoff: UnlistenFn | null = null;
    let disposed = false;

    const lastBackoffToastAtRef = { current: 0 } as { current: number };

    (async () => {
      try {
        unlisten = await listen<AnalyzerSignalUpdate>("analyzer_signal_update", (event) => {
          const payload = event.payload;
          if (!payload) return;
          if (payload.workspace !== workspaceNameRef.current) return;
          if (!pollingWantedRef.current) return;

          pendingLiveUpdatesRef.current[payload.signalId] = payload;

          const info = signalInfoBySignalIdRef.current[payload.signalId] ?? null;
          if (info) {
            const currentTiles = tilesRef.current;
            const currentTileSignals = tileSignalsRef.current;

            for (const t of currentTiles) {
              if (!t.pollingEnabled) continue;

              const kind = (t.kind || "").toLowerCase();
              const chartKind = getChartKind(t.configJson);
              const isTrend = kind === "trend" || (kind === "chart" && chartKind === "trend");
              if (!isTrend) continue;

              const links = currentTileSignals[t.id] ?? [];
              const primary = links.find((s) => s.role === "primary") ?? links[0] ?? null;
              if (!primary) continue;
              if (primary.signalId !== payload.signalId) continue;
              const tsMs = payload.tsMs ?? Date.now();
              const sample = deriveNumericSample(payload, primary);
              const existing = pendingHistoryPointsRef.current[t.id] ?? [];
              const last = existing.length > 0 ? existing[existing.length - 1] : null;

              const expectedMs = getSignalPollIntervalMs(primary.signalId);
              const gapBreakMs = Math.max(1000, Math.round(expectedMs * 6));
              if (last && Number.isFinite(last.tsMs) && tsMs - last.tsMs >= gapBreakMs) {
                existing.push({ tsMs: last.tsMs + 1, value: null });
              }

              const minChartPointIntervalMs = 250;
              const last2 = existing.length > 0 ? existing[existing.length - 1] : null;

              if (last2 && last2.tsMs === tsMs) {
                existing[existing.length - 1] = { tsMs, value: sample };
              } else if (
                last2 &&
                last2.value != null &&
                Number.isFinite(last2.tsMs) &&
                tsMs - last2.tsMs < minChartPointIntervalMs
              ) {
                existing[existing.length - 1] = { tsMs, value: sample };
              } else {
                existing.push({ tsMs, value: sample });
              }
              pendingHistoryPointsRef.current[t.id] = existing;
            }
          }

          if (pendingFlushTimerRef.current == null) {
            pendingFlushTimerRef.current = window.setTimeout(() => {
              flushPendingUiUpdates();
            }, 50);
          }

          if (pendingHistoryFlushTimerRef.current == null) {
            pendingHistoryFlushTimerRef.current = window.setTimeout(() => {
              flushPendingHistoryUpdates();
            }, 250);
          }
        });
        if (disposed) { void unlisten(); unlisten = null; return; }

        unlistenStopped = await listen<{ workspace: string; reason: string }>(
          "analyzer_polling_stopped",
          (event) => {
            const payload = event.payload;
            if (!payload) return;
            if (payload.workspace !== workspaceNameRef.current) return;

            logWorkspace("warn", "Analyzer polling stopped by backend", { reason: payload.reason });
            setPollingWanted(false);
            pollingWantedRef.current = false;

            pendingLiveUpdatesRef.current = {};
            pendingHistoryPointsRef.current = {};
            if (pendingFlushTimerRef.current != null) {
              window.clearTimeout(pendingFlushTimerRef.current);
              pendingFlushTimerRef.current = null;
            }
            if (pendingHistoryFlushTimerRef.current != null) {
              window.clearTimeout(pendingHistoryFlushTimerRef.current);
              pendingHistoryFlushTimerRef.current = null;
            }
            pushToast("Polling stopped (disconnected)", "error");
          },
        );
        if (disposed) { void unlistenStopped(); unlistenStopped = null; return; }

        unlistenBackoff = await listen<AnalyzerPollingBackoffEvent>(
          "analyzer_polling_backoff",
          (event) => {
            const payload = event.payload;
            if (!payload) return;
            if (payload.workspace !== workspaceNameRef.current) return;
            if (!pollingWantedRef.current) return;

            const now = Date.now();
            if (now - lastBackoffToastAtRef.current < 4000) return;
            lastBackoffToastAtRef.current = now;

            const seconds = Math.max(1, Math.round((payload.retryInMs ?? 0) / 1000));
            const attempt = payload.attempt ?? 0;
            pushToast(
              `Disconnected, retrying in ${seconds}s${attempt > 0 ? ` (attempt ${attempt})` : ""}`,
              "info",
            );

            logWorkspace("warn", "Analyzer polling backoff", {
              reason: payload.reason,
              retryInMs: payload.retryInMs,
              attempt,
            });
          },
        );
        if (disposed) { void unlistenBackoff(); unlistenBackoff = null; return; }

        logWorkspace("info", "Analyzer event listeners attached");
      } catch (e) {
        logWorkspace("error", "Failed to attach analyzer event listeners", { error: String(e) });
      }
    })();

    return () => {
      disposed = true;
      if (unlisten) {
        void unlisten();
      }
      if (unlistenStopped) {
        void unlistenStopped();
      }
      if (unlistenBackoff) {
        void unlistenBackoff();
      }
    };
  }, []);

  async function toggleTilePolling(tile: AnalyzerTile) {
    setError(null);
    try {
      const updated = await setAnalyzerTilePollingEnabled(workspaceName, tile.id, !tile.pollingEnabled);
      setTiles((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      pushToast(updated.pollingEnabled ? "Polling enabled" : "Polling disabled", "info");
      logWorkspace("info", "Analyzer tile polling toggled", {
        tileId: updated.id,
        pollingEnabled: updated.pollingEnabled,
      });
    } catch (e) {
      logWorkspace("error", "Analyzer tile polling toggle failed", { tileId: tile.id, error: String(e) });
      setError(String(e));
    }
  }

  function deriveUiState(primary: AnalyzerTileSignalInfo, live: AnalyzerSignalUpdate | null): string {
    const baseState = (live?.state ?? primary.state ?? "DISCONNECTED").toString().toUpperCase();
    if (baseState !== "OK") return baseState;

    const expectedMs = getSignalPollIntervalMs(primary.signalId);
    const staleAfterMs = Math.max(1500, Math.round(expectedMs * 2.5));
    const lastTs = live?.tsMs ?? primary.lastUpdatedTsMs ?? null;
    if (lastTs == null) return "DISCONNECTED";

    const age = nowTsMs - lastTs;
    if (Number.isFinite(age) && age > staleAfterMs) return "STALE";
    return "OK";
  }

  function renderTileValue(tile: AnalyzerTile, isRunning: boolean): { label: string; state: string } {
    const links = tileSignals[tile.id] ?? [];
    const primary = links.find((s) => s.role === "primary") ?? links[0] ?? null;
    if (!primary) return { label: "No signal", state: "DISCONNECTED" };

    const live = isRunning ? (liveUpdates[primary.signalId] ?? null) : null;

    const uiState = deriveUiState(primary, live);
    const decoderState = (live?.state ?? primary.state ?? "DISCONNECTED").toString();

    const rawFromLive = {
      rawWords: live?.rawWords ?? undefined,
      rawBools: live?.rawBools ?? undefined,
    };

    const rawFromDb = parseAnalyzerRawSnapshotFromJson(primary.lastValueJson ?? null);

    const rawWords = rawFromLive.rawWords ?? rawFromDb?.rawWords ?? null;
    const rawBools = rawFromLive.rawBools ?? rawFromDb?.rawBools ?? null;

    const decoded = decodeAnalyzerSignal({
      state: decoderState,
      error: live?.error ?? null,
      errorJson: primary.errorJson ?? null,
      rawWords,
      rawBools,
      functionCode: primary.functionCode,
      dataType: primary.dataType,
      order: primary.order,
      displayFormat: primary.displayFormat,
      decoderJson: primary.decoderJson,
    });

    if (!decoded.ok) return { label: decoded.formatted, state: uiState };

    return { label: decoded.formatted, state: uiState };
  }

  function renderTrendTile(tile: AnalyzerTile, isRunning: boolean): { points: AnalyzerTrendPoint[]; state: string } {
    const links = tileSignals[tile.id] ?? [];
    const primary = links.find((s) => s.role === "primary") ?? links[0] ?? null;
    if (!primary) return { points: [], state: "DISCONNECTED" };

    const live = isRunning ? (liveUpdates[primary.signalId] ?? null) : null;
    const state = deriveUiState(primary, live);
    const points = historyByTileId[tile.id] ?? [];
    return { points, state };
  }

  function getTilePollingIntervalMs(tileId: number): number | null {
    const links = tileSignals[tileId] ?? [];
    const primary = links.find((s) => s.role === "primary") ?? links[0] ?? null;
    if (!primary) return null;
    const interval = getSignalPollIntervalMs(primary.signalId);
    return interval > 0 ? interval : null;
  }

  function getTilePrimarySignalId(tileId: number): string | null {
    const links = tileSignals[tileId] ?? [];
    const primary = links.find((s) => s.role === "primary") ?? links[0] ?? null;
    return primary?.signalId ?? null;
  }

  function formatRegisterType(functionCode: number | null | undefined): string {
    switch (functionCode) {
      case 1:
        return "Coils";
      case 2:
        return "Discrete";
      case 3:
        return "Holding";
      case 4:
        return "Input";
      default:
        return "Unknown";
    }
  }

  function getTileInfo(tileId: number): {
    tileType: string;
    tileName: string;
    signalId: string;
    connection: string;
    slaveId: number | null;
    unitId: number | null;
    registerAddress: number | null;
    registerAddressFormatted: string;
    registerType: string;
    pollIntervalMs: number | null;
  } | null {
    const tile = tiles.find((t) => t.id === tileId) ?? null;
    if (!tile) return null;

    const links = tileSignals[tileId] ?? [];
    const primary = links.find((s) => s.role === "primary") ?? links[0] ?? null;
    const signalId = primary?.signalId ?? "";
    if (!signalId) return null;

    const sig = signalsById.get(signalId) ?? null;
    const slaveId = sig?.slaveId ?? null;
    const slave = slaveId != null ? slaves.find((s) => s.id === slaveId) ?? null : null;
    const unitId = slave?.unitId ?? null;

    const tileKind = (tile.kind || "").toLowerCase();
    const chartKind = getChartKind(tile.configJson);
    const isTrend = tileKind === "trend" || (tileKind === "chart" && chartKind === "trend");
    const tileType = isTrend ? "Trend" : "Value";

    const connectionRaw = (sig?.connectionKind || "").trim().toLowerCase();
    const connection = connectionRaw ? connectionRaw.toUpperCase() : "—";

    const registerAddress = primary?.address ?? sig?.address ?? null;
    const registerAddressFormatted = formatAnalyzerAddress(registerAddress, addressFormat);
    const registerType = formatRegisterType(primary?.functionCode ?? null);

    const pollIntervalMs = getTilePollingIntervalMs(tileId);

    return {
      tileType,
      tileName: tile.title?.trim() ? tile.title.trim() : `Tile ${tile.id}`,
      signalId,
      connection,
      slaveId,
      unitId,
      registerAddress,
      registerAddressFormatted,
      registerType,
      pollIntervalMs,
    };
  }

  const gridReady = gridWidth > 0;
  const effectiveGridWidth = gridReady ? gridWidth : 1200;
  const derivedBreakpoint: "desktop" | "mobile" = effectiveGridWidth < 768 ? "mobile" : "desktop";

  const editingTilePrimary = useMemo(() => {
    const tile = tileModalEditingTile;
    if (!tile) return null;
    const links = tileSignals[tile.id] ?? [];
    return links.find((s) => s.role === "primary") ?? links[0] ?? null;
  }, [tileModalEditingTile, tileSignals]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <AnalyzerHeaderCard
        loading={loading}
        onRefresh={() => void refreshAll()}
        trendWindowMinutes={trendWindowMinutes}
        onChangeTrendWindowMinutes={setTrendWindowMinutes}
        addressFormat={addressFormat}
        onChangeAddressFormat={setAddressFormat}
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <AnalyzerTilesCard
        tiles={tiles}
        pollingWanted={pollingWanted}
        onStartPollingAll={() => void onStartPolling()}
        onStopPollingAll={() => void onStopPolling()}
        gridReady={gridReady}
        layoutEditMode={layoutEditMode}
        onToggleLayoutEditMode={() => setLayoutEditMode((prev) => !prev)}
        gridHostRef={gridHostRef}
        effectiveGridWidth={effectiveGridWidth}
        gridLayouts={gridLayouts}
        onGridLayoutsChange={setGridLayouts}
        derivedBreakpoint={derivedBreakpoint}
        schedulePersistLayouts={schedulePersistLayouts}
        renderTileValue={renderTileValue}
        renderTrendTile={renderTrendTile}
        nowTsMs={nowTsMs}
        trendWindowMs={trendWindowMs}
        getTilePollingIntervalMs={getTilePollingIntervalMs}
        getTilePrimarySignalId={getTilePrimarySignalId}
        getTileInfo={getTileInfo}
        onRefresh={() => void refreshAll()}
        onOpenConnectionSettings={() => void openConnectionModal()}
        onConfigureSignals={() => {
          setConfigureSignalsOpen(true);
        }}
        onAddTile={() => openAddTileModalDefault()}
        onToggleTilePolling={(t: AnalyzerTile) => void toggleTilePolling(t)}
        onEditTile={openEditTileModal}
        onDeleteTile={deleteTile}
      />

      <AnalyzerConfigureSignalsModal
        open={configureSignalsOpen}
        workspaceName={workspaceName}
        signals={signals}
        slaves={slaves}
        addressFormat={addressFormat}
        isPollingWanted={pollingWanted}
        nowTsMs={nowTsMs}
        getSignalPollIntervalMs={getSignalPollIntervalMs}
        onClose={() => setConfigureSignalsOpen(false)}
        onAfterMutation={async () => {
          await refreshSignals();
          await refreshTiles();
        }}
        onError={(message) => setError(message)}
        onToast={(message) => pushToast(message, "info")}
      />

      <AnalyzerAddEditTileModal
        open={tileModalOpen}
        mode={tileModalMode}
        signals={signals}
        slavesById={slavesById}
        editingTile={tileModalEditingTile}
        editingTilePrimary={editingTilePrimary}
        initialKind={tileModalInitialKind}
        busy={tileModalBusy}
        error={tileModalError}
        onClose={() => {
          if (tileModalBusy) return;
          setTileModalError(null);
          setTileModalOpen(false);
        }}
        onSubmit={(input) => {
          setTileModalBusy(true);
          setTileModalError(null);
          void (async () => {
            try {
              const kind = input.kind === "trend" ? "chart" : "widget";
              const configJson = input.kind === "trend" ? JSON.stringify({ chartKind: "trend" }) : "{}";

              if (tileModalMode === "add") {
                await createAnalyzerTile(workspaceName, {
                  kind,
                  title: input.title,
                  configJson,
                  pollingEnabled: true,
                  layouts: [],
                  signalLinks: [
                    {
                      signalId: input.signalId,
                      role: "primary",
                    },
                  ],
                });
                pushToast("Created", "info");
                logWorkspace("info", "Analyzer tile created", {
                  kind,
                  signalId: input.signalId,
                  title: input.title,
                });
              } else {
                const tile = tileModalEditingTile;
                if (!tile) throw new Error("No tile selected");
                await updateAnalyzerTile(workspaceName, tile.id, {
                  kind,
                  title: input.title,
                  configJson,
                  pollingEnabled: tile.pollingEnabled,
                  signalLinks: [
                    {
                      signalId: input.signalId,
                      role: "primary",
                    },
                  ],
                });
                pushToast("Saved", "info");
                logWorkspace("info", "Analyzer tile updated", {
                  tileId: tile.id,
                  kind,
                  signalId: input.signalId,
                  title: input.title,
                });
              }

              setTileModalOpen(false);
              await refreshTiles();
            } catch (e) {
              logWorkspace("error", "Analyzer tile save failed", {
                mode: tileModalMode,
                tileId: tileModalEditingTile?.id ?? null,
                error: String(e),
              });
              setTileModalError(String(e));
            } finally {
              setTileModalBusy(false);
            }
          })();
        }}
      />

      {connectionModalOpen && connectionFormValue ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Connection settings</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Configure serial/TCP parameters for this workspace. Changes apply to all slaves.
                </div>
              </div>
            </div>

            {connectionTestError ? (
              <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                {connectionTestError}
              </div>
            ) : null}

            {connectionTestMessage ? (
              <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                {connectionTestMessage}
              </div>
            ) : null}

            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <ConnectionSettingsForm
                value={connectionFormValue}
                onChange={setConnectionFormValue}
                serialPortOptions={connectionSerialPorts}
                onRefreshSerialPorts={async () => {
                  try {
                    const ports = await invoke<SerialPortItem[]>("list_serial_ports");
                    setConnectionSerialPorts(ports);
                  } catch {
                    setConnectionSerialPorts([]);
                  }
                }}
                loading={loading}
                saving={connectionSaving}
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => setConnectionModalOpen(false)}
                disabled={connectionSaving || connectionTesting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => void testConnectionFromModal()}
                disabled={connectionSaving || connectionTesting}
                title="Test current connection settings"
              >
                <FiActivity className="h-4 w-4" aria-hidden="true" />
                {connectionTesting ? "Testing..." : "Test Connection"}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                onClick={() => void saveConnectionFromModal()}
                disabled={connectionSaving || connectionTesting}
              >
                <FiSave className="h-4 w-4" aria-hidden="true" />
                {connectionSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDeleteTile != null}
        title="Delete tile"
        description={
          <>
            Delete <span className="font-semibold">{confirmDeleteTile?.title?.trim() || `Tile ${confirmDeleteTile?.id ?? ""}`}</span>?
            <div className="mt-2 text-slate-600 dark:text-slate-300">This action cannot be undone.</div>
          </>
        }
        confirmText={deletingTileId != null ? "Deleting..." : "Delete"}
        cancelText="Cancel"
        tone="danger"
        busy={deletingTileId != null}
        error={deleteTileError}
        onConfirm={() => {
          const tile = confirmDeleteTile;
          if (!tile) return;
          setDeletingTileId(tile.id);
          setDeleteTileError(null);
          void (async () => {
            try {
              await deleteAnalyzerTile(workspaceName, tile.id);
              pushToast("Tile deleted", "info");
              logWorkspace("info", "Analyzer tile deleted", { tileId: tile.id });
              setConfirmDeleteTile(null);
              await refreshTiles();
            } catch (e) {
              logWorkspace("error", "Analyzer tile delete failed", { tileId: tile.id, error: String(e) });
              setDeleteTileError(String(e));
            } finally {
              setDeletingTileId(null);
            }
          })();
        }}
        onClose={() => {
          if (deletingTileId != null) return;
          setDeleteTileError(null);
          setConfirmDeleteTile(null);
        }}
      />
    </div>
  );
}
