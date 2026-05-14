import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiRefreshCcw, FiSave, FiTrash2 } from "react-icons/fi";
import type { Screen2OutletContext } from "../Screen2Layout";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useErrorToast, useToast } from "../../components/ToastProvider";
import { logEvent } from "../api/logs";
import { CTRL_S } from "../../components/ShortcutKeys";

type ClientSettings = {
  responseTimeoutMs?: number | null;
  connectTimeoutMs?: number | null;
  retries?: number | null;
  retryDelayMs?: number | null;
  loggingMinLevel?: "debug" | "info" | "warn" | "error" | null;
  logsPaneOpen?: boolean | null;
};

function normalize(settings: ClientSettings): Required<ClientSettings> {
  return {
    responseTimeoutMs: settings.responseTimeoutMs ?? 1000,
    connectTimeoutMs: settings.connectTimeoutMs ?? 2000,
    retries: settings.retries ?? 1,
    retryDelayMs: settings.retryDelayMs ?? 200,
    loggingMinLevel: settings.loggingMinLevel ?? "info",
    logsPaneOpen: settings.logsPaneOpen ?? false,
  };
}

function parseNumberOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return v;
}

export default function ClientPage() {
  const { workspace } = useOutletContext<Screen2OutletContext>();

  const { pushToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Required<ClientSettings>>(() =>
    normalize({}),
  );
  const [initial, setInitial] = useState<Required<ClientSettings> | null>(null);

  const [clearLogsRange, setClearLogsRange] = useState<"365d" | "180d" | "90d" | "30d" | "all">("180d");
  const [clearLogsConfirmOpen, setClearLogsConfirmOpen] = useState(false);
  const [clearLogsBusy, setClearLogsBusy] = useState(false);
  const [clearLogsCount, setClearLogsCount] = useState<number | null>(null);
  const [clearLogsError, setClearLogsError] = useState<string | null>(null);
  const [clearLogsPreviewCount, setClearLogsPreviewCount] = useState<number | null>(null);

  const prevSettingsRef = useRef<Required<ClientSettings> | null>(null);
  const saveRef = useRef<() => void>(() => {});

  useErrorToast(error);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const loaded = await invoke<ClientSettings>("get_client_settings", {
          name: workspace.name,
        });
        const normalized = normalize(loaded);
        setSettings(normalized);
        setInitial(normalized);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }

    }

    void load();
  }, [workspace.name]);

  function clearRangeLabel(range: typeof clearLogsRange): string {
    switch (range) {
      case "365d":
        return "Older than 1 year";
      case "180d":
        return "Older than 6 months";
      case "90d":
        return "Older than 90 days";
      case "30d":
        return "Older than 30 days";
      case "all":
        return "Clear all";
      default:
        return range;
    }
  }

  function cutoffIsoForRange(range: typeof clearLogsRange): string | null {
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoffMs =
      range === "365d"
        ? nowMs - 365 * dayMs
        : range === "180d"
          ? nowMs - 180 * dayMs
          : range === "90d"
            ? nowMs - 90 * dayMs
            : range === "30d"
              ? nowMs - 30 * dayMs
              : null;
    return cutoffMs == null ? null : new Date(cutoffMs).toISOString();
  }

  async function refreshClearLogsPreviewCount() {
    try {
      const olderThanIso = cutoffIsoForRange(clearLogsRange);
      const filter = olderThanIso ? { olderThanIso } : null;
      const count = await invoke<number>("count_workspace_logs_to_delete", {
        name: workspace.name,
        filter,
      });
      setClearLogsPreviewCount(count);
    } catch {
      setClearLogsPreviewCount(null);
    }
  }

  useEffect(() => {
    void refreshClearLogsPreviewCount();
  }, [workspace.name, clearLogsRange]);

  async function openClearLogsConfirm() {
    setClearLogsError(null);
    setClearLogsCount(null);

    try {
      const olderThanIso = cutoffIsoForRange(clearLogsRange);
      const filter = olderThanIso ? { olderThanIso } : null;
      const count = await invoke<number>("count_workspace_logs_to_delete", {
        name: workspace.name,
        filter,
      });
      if (count <= 0) {
        pushToast("Nothing to clear", "info");
        return;
      }

      setClearLogsCount(count);
      setClearLogsConfirmOpen(true);
    } catch (e) {
      setClearLogsError(String(e));
      setClearLogsConfirmOpen(true);
    }
  }

  async function confirmClearLogs() {
    setClearLogsBusy(true);
    setClearLogsError(null);
    try {
      const olderThanIso = cutoffIsoForRange(clearLogsRange);
      const filter = olderThanIso ? { olderThanIso } : null;
      const deletedCount = await invoke<number>("delete_workspace_logs", {
        name: workspace.name,
        filter,
      });

      if (deletedCount <= 0) {
        pushToast("Nothing to clear", "info");
        setClearLogsConfirmOpen(false);
        return;
      }

      pushToast(`Cleared ${deletedCount} logs`, "info");

      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "settings",
        message: "Workspace logs cleared",
        detailsJson: {
          range: clearLogsRange,
          olderThanIso,
          deletedCount,
        },
      });

      setClearLogsConfirmOpen(false);
    } catch (e) {
      const message = String(e);
      setClearLogsError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "settings",
        message: "Failed to clear workspace logs",
        detailsJson: {
          range: clearLogsRange,
          error: message,
        },
      });
    } finally {
      setClearLogsBusy(false);
      void refreshClearLogsPreviewCount();
    }
  }

  const isDirty = useMemo(() => {
    if (!initial) return false;
    return JSON.stringify(initial) !== JSON.stringify(settings);
  }, [initial, settings]);

  saveRef.current = save;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "s" && e.key !== "S") return;

      if (!isDirty || loading || saving || clearLogsBusy || clearLogsConfirmOpen) return;

      e.preventDefault();
      void saveRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDirty, loading, saving, clearLogsBusy, clearLogsConfirmOpen]);

  useEffect(() => {
    const prev = prevSettingsRef.current;
    if (!prev) {
      prevSettingsRef.current = settings;
      return;
    }

    const changedFields: string[] = [];
    if (prev.responseTimeoutMs !== settings.responseTimeoutMs)
      changedFields.push("responseTimeoutMs");
    if (prev.connectTimeoutMs !== settings.connectTimeoutMs)
      changedFields.push("connectTimeoutMs");
    if (prev.retries !== settings.retries) changedFields.push("retries");
    if (prev.retryDelayMs !== settings.retryDelayMs) changedFields.push("retryDelayMs");
    if (prev.loggingMinLevel !== settings.loggingMinLevel)
      changedFields.push("loggingMinLevel");

    if (changedFields.length > 0) {
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "settings",
        message: "Settings changed",
        detailsJson: {
          fields: changedFields,
        },
      });
    }

    prevSettingsRef.current = settings;
  }, [settings, workspace.name]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      await invoke<void>("set_client_settings", {
        name: workspace.name,
        settings,
        nowIso,
      });
      setInitial(settings);
      pushToast("Saved", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "settings",
        message: "Settings saved",
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "settings",
        message: "Failed to save settings",
        detailsJson: {
          error: message,
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-inner shadow-black/5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-black/30">
        <div>
          <p className="text-sm uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">Settings</p>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Configure settings for this workspace.</div>
        </div>
      </div>
      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? <div className="flex items-center gap-2 p-2 text-sm text-slate-600 dark:text-slate-300 animate-pulse">
        <FiRefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading...
      </div> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">Logging</div>
          <div className="mt-3 grid gap-4 grid-cols-1">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-900 dark:text-slate-200" htmlFor="logging-min-level">
                Minimum log level
              </label>
              <select
                id="logging-min-level"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-600/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/10 dark:disabled:bg-white/5"
                value={settings.loggingMinLevel ?? "info"}
                onChange={(e) => {
                  const v = e.currentTarget.value as "debug" | "info" | "warn" | "error";
                  setSettings((prev) => ({ ...prev, loggingMinLevel: v }));
                }}
                disabled={loading || saving}
              >
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
              <div className="ml-1 text-sm text-slate-600 dark:text-slate-300">
                Logs below this level will be ignored for this workspace.
              </div>
            </div>
          </div>
        </div>

        <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">
            Delete logs
          </div>
          <div className="mt-3 grid gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-900 dark:text-slate-200" htmlFor="clear-logs-range">
                Range
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  id="clear-logs-range"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-600/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/10 dark:disabled:bg-white/5"
                  value={clearLogsRange}
                  onChange={(e) => {
                    setClearLogsRange(e.currentTarget.value as typeof clearLogsRange);
                  }}
                  disabled={loading || saving || clearLogsBusy}
                >
                  <option value="365d">Older than 1 year</option>
                  <option value="180d">Older than 6 months</option>
                  <option value="90d">Older than 90 days</option>
                  <option value="30d">Older than 30 days</option>
                  <option value="all">Clear all</option>
                </select>

                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-600/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-500 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:border-rose-400 dark:bg-rose-500/20 dark:text-rose-200 dark:hover:border-rose-300 dark:hover:text-rose-100"
                  onClick={() => {
                    void openClearLogsConfirm();
                  }}
                  disabled={loading || saving || clearLogsBusy}
                >
                  <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                  Delete
                </button>
              </div>
              <div className="ml-1 text-sm text-slate-600 dark:text-slate-300">
                This will permanently delete
                {clearLogsPreviewCount != null && (
                  <>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">{` ${clearLogsPreviewCount}`}</span>
                    {` log ${clearLogsPreviewCount === 1 ? "entry" : "entries"} `}
                  </>
                )}
                for the selected range in this workspace.
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">Timing</div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-900 dark:text-slate-200" htmlFor="response-timeout-ms">
              Response Timeout (ms)
            </label>
            <input
              id="response-timeout-ms"
              type="number"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-600/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/10 dark:disabled:bg-white/5"
              value={settings.responseTimeoutMs ?? ""}
              onChange={(e) => {
                const v = parseNumberOrNull(e.currentTarget.value);
                setSettings((prev) => ({ ...prev, responseTimeoutMs: v }));
              }}
              disabled={loading || saving}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-900 dark:text-slate-200" htmlFor="connect-timeout-ms">
              Connect Timeout (ms)
            </label>
            <input
              id="connect-timeout-ms"
              type="number"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-600/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/10 dark:disabled:bg-white/5"
              value={settings.connectTimeoutMs ?? ""}
              onChange={(e) => {
                const v = parseNumberOrNull(e.currentTarget.value);
                setSettings((prev) => ({ ...prev, connectTimeoutMs: v }));
              }}
              disabled={loading || saving}
            />
          </div>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">Retry</div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-900 dark:text-slate-200" htmlFor="retries">
              Retries
            </label>
            <input
              id="retries"
              type="number"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-600/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/10 dark:disabled:bg-white/5"
              value={settings.retries ?? ""}
              onChange={(e) => {
                const v = parseNumberOrNull(e.currentTarget.value);
                setSettings((prev) => ({ ...prev, retries: v }));
              }}
              disabled={loading || saving}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-900 dark:text-slate-200" htmlFor="retry-delay-ms">
              Retry Delay (ms)
            </label>
            <input
              id="retry-delay-ms"
              type="number"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-600/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/10 dark:disabled:bg-white/5"
              value={settings.retryDelayMs ?? ""}
              onChange={(e) => {
                const v = parseNumberOrNull(e.currentTarget.value);
                setSettings((prev) => ({ ...prev, retryDelayMs: v }));
              }}
              disabled={loading || saving}
            />
          </div>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-100 dark:hover:border-emerald-300 dark:hover:text-emerald-50"
            onClick={() => save()}
            disabled={!isDirty || loading || saving}
            title={`Save settings ${CTRL_S}`}
          >
            <FiSave className="h-4 w-4" aria-hidden="true" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={clearLogsConfirmOpen}
        title="Clear workspace logs"
        description={
          clearLogsCount == null
            ? "Checking how many logs will be deleted..."
            : (
              <div className="text-slate-700 dark:text-slate-200">
                <span className="font-semibold text-rose-800 dark:text-rose-200">{clearLogsCount}</span>
                {` log ${clearLogsCount === 1 ? "entry" : "entries"} will be permanently deleted (${clearRangeLabel(clearLogsRange)}). `}
                <span className="font-semibold">This action cannot be undone.</span>
              </div>
            )
        }
        confirmText="Delete logs"
        confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
        tone="danger"
        busy={clearLogsBusy}
        error={clearLogsError}
        onConfirm={() => {
          void confirmClearLogs();
        }}
        onClose={() => {
          if (clearLogsBusy) return;
          setClearLogsConfirmOpen(false);
        }}
      />
    </div>
  );
}
