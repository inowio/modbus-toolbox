import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { FiActivity, FiBookOpen, FiGrid, FiInfo, FiLink, FiList, FiMaximize2, FiMinimize2, FiMenu, FiX, FiRefreshCcw } from "react-icons/fi";
import { PiNetwork } from "react-icons/pi";
import ThemeToggleButton from "../components/ThemeToggleButton";
import { useErrorToast } from "../components/ToastProvider";
import { formatLocalDateTime } from "../datetime";
import { listAppLogs, listWorkspaceLogs, type AppLogEntry, type WorkspaceLogEntry, type LogLevel } from "./api/logs";
import { clearTrafficEvents, setTrafficCaptureEnabled } from "./api/traffic";
import { LuPanelLeftOpen, LuPanelRightOpen, LuSettings } from "react-icons/lu";
import TrafficMonitorPanel from "./components/TrafficMonitorPanel";
import { useHelp } from "../help/HelpProvider";

export type Workspace = {
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
};

export type Screen2OutletContext = {
  workspace: Workspace;
  refreshWorkspace: () => Promise<void>;
  setHasUnsavedChanges?: (hasUnsaved: boolean) => void;
  setInspectorContext?: (ctx: {
    trafficAvailable: boolean;
    trafficContext?: { slaveId?: number | null };
  }) => void;
};

export default function Screen2Layout() {
  const navigate = useNavigate();
  const params = useParams();
  const workspaceName = params.workspaceName ?? "";
  const { openHelp } = useHelp();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [navGuardOpen, setNavGuardOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [logViewerFullscreen, setLogViewerFullscreen] = useState(false);
  const [logPaneHeight, setLogPaneHeight] = useState(288);
  const [logTab, setLogTab] = useState<"workspace" | "app">("workspace");
  const [logMinLevel, setLogMinLevel] = useState<LogLevel>("info");
  const [logSearch, setLogSearch] = useState("");
  const [appLogs, setAppLogs] = useState<AppLogEntry[]>([]);
  const [workspaceLogs, setWorkspaceLogs] = useState<WorkspaceLogEntry[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logAutoFollow, setLogAutoFollow] = useState(true);
  const logsScrollRef = useRef<HTMLDivElement | null>(null);

  const [inspectorTab, setInspectorTab] = useState<"logs" | "traffic">("logs");
  const [trafficAvailable, setTrafficAvailable] = useState(false);
  const [trafficContext, setTrafficContext] = useState<{
    slaveId?: number | null;
  } | null>(null);
  const [trafficMonitoring, setTrafficMonitoring] = useState(false);

  useErrorToast(error);

  async function refreshWorkspace() {
    setLoading(true);
    setError(null);
    try {
      const ws = await invoke<Workspace>("get_workspace", { name: workspaceName });
      setWorkspace(ws);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshWorkspace();
  }, [workspaceName]);

  // Prune global app logs when a workspace is opened to keep the app log database bounded.
  useEffect(() => {
    if (!workspaceName) return;
    void invoke("prune_app_logs", { maxRows: 10_000 }).catch(() => {
      // Best-effort only; ignore cleanup errors so UI remains responsive.
    });
  }, [workspaceName]);

  useEffect(() => {
    if (!workspaceName) return;
    setTrafficMonitoring(false);
    void setTrafficCaptureEnabled(workspaceName, false).catch(() => { });
    void clearTrafficEvents(workspaceName).catch(() => { });
  }, [workspaceName]);

  useEffect(() => {
    if (!workspaceName) return;
    if (trafficAvailable) return;
    if (!trafficMonitoring) return;
    setTrafficMonitoring(false);
  }, [workspaceName, trafficAvailable, trafficMonitoring]);

  useEffect(() => {
    if (!workspaceName) return;
    void setTrafficCaptureEnabled(workspaceName, trafficMonitoring).catch(() => { });
  }, [workspaceName, trafficMonitoring]);

  useEffect(() => {
    const title = workspaceName
      ? `Inowio - Modbus Toolbox v${__APP_VERSION__} - ${workspaceName}`
      : `Inowio - Modbus Toolbox v${__APP_VERSION__}`;
    void getCurrentWebviewWindow().setTitle(title);
  }, [workspaceName]);

  async function disconnectAll(name: string) {
    if (!name.trim()) return;
    try {
      await invoke<void>("modbus_tcp_disconnect", { name });
    } catch {
      // ignore
    }
    try {
      await invoke<void>("modbus_rtu_disconnect", { name });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const name = workspaceName;
    return () => {
      void disconnectAll(name);
    };
  }, [workspaceName]);

  async function persistLogsPaneOpen(nextOpen: boolean) {
    if (!workspaceName) return;
    try {
      const nowIso = new Date().toISOString();
      await invoke<void>("set_client_settings", {
        name: workspaceName,
        settings: {
          logsPaneOpen: nextOpen,
        },
        nowIso,
      });
    } catch {
      // Best-effort only; ignore persistence errors so UI remains responsive.
    }
  }

  useEffect(() => {
    if (!workspaceName) return;

    let cancelled = false;

    (async () => {
      try {
        const loaded = await invoke<{ logsPaneOpen?: boolean | null }>("get_client_settings", {
          name: workspaceName,
        });
        if (cancelled) return;
        const open = loaded.logsPaneOpen ?? false;
        setLogViewerOpen(open);
      } catch {
        if (!cancelled) {
          setLogViewerOpen(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceName]);

  const ctx = useMemo<Screen2OutletContext | null>(() => {
    if (!workspace) return null;
    return {
      workspace,
      refreshWorkspace,
      setHasUnsavedChanges,
      setInspectorContext: (value) => {
        setTrafficAvailable(value.trafficAvailable);
        setTrafficContext(value.trafficContext ?? null);
      },
    };
  }, [workspace]);

  function levelToSeverityClient(level: LogLevel): number {
    switch (level) {
      case "error":
        return 40;
      case "warn":
        return 30;
      case "info":
        return 20;
      case "debug":
      default:
        return 10;
    }
  }

  const activeLogs = (logTab === "workspace" ? workspaceLogs : appLogs).filter((log) => {
    const minSeverity = levelToSeverityClient(logMinLevel);
    if (log.severity < minSeverity) return false;

    const term = logSearch.trim().toLowerCase();
    if (!term) return true;

    return (
      log.message.toLowerCase().includes(term) ||
      log.source.toLowerCase().includes(term)
    );
  });

  // Ensure logs are shown oldest-first so that the most recent entries appear at the bottom.
  const orderedLogs = [...activeLogs].sort((a, b) => a.id - b.id);

  function handleLogsScroll(e: { currentTarget: HTMLDivElement }) {
    const target = e.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    const atBottom = distanceFromBottom < 16;
    setLogAutoFollow(atBottom);
  }

  function handleLogPaneResizeMouseDown(e: { clientY: number; preventDefault: () => void }) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = logPaneHeight;

    function handleMove(ev: MouseEvent) {
      const delta = startY - ev.clientY;
      let next = startHeight + delta;
      if (next < 230) next = 230;
      if (next > 600) next = 600;
      setLogPaneHeight(next);
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  const logsMain = (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="inline-flex gap-1 rounded-full border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900/80">
          <button
            type="button"
            className={`rounded-md px-3 py-1 font-semibold transition ${logTab === "workspace"
              ? "bg-emerald-500/10 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
              }`}
            onClick={() => setLogTab("workspace")}
          >
            Workspace logs
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1 font-semibold transition ${logTab === "app"
              ? "bg-emerald-500/10 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
              }`}
            onClick={() => setLogTab("app")}
          >
            App logs
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <label htmlFor="logs-min-level" className="text-[11px] text-slate-600 dark:text-slate-300">
              Min level
            </label>
            <select
              id="logs-min-level"
              className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-1 focus:ring-emerald-600/20 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/30"
              value={logMinLevel}
              onChange={(e) => {
                const v = e.currentTarget.value as LogLevel;
                setLogMinLevel(v);
                void refreshLogs(v);
              }}
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="relative w-40 sm:w-56">
            <input
              type="text"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="Search message or source"
              className="w-full rounded-full border border-slate-300 bg-white px-3 py-1.5 pr-6 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-emerald-600/60 focus:outline-hidden focus:ring-1 focus:ring-emerald-600/20 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60 dark:focus:ring-emerald-500/40"
            />
            {logSearch ? (
              <button
                type="button"
                onClick={() => setLogSearch("")}
                className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                <FiX className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {logsError ? (
        <div className="mb-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-800 dark:text-rose-200">
          {logsError}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40">
        {orderedLogs.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">No logs to display.</div>
        ) : (
          <div
            ref={logsScrollRef}
            onScroll={handleLogsScroll}
            className="h-full overflow-y-auto text-xs"
          >
            <table className="min-w-full border-collapse text-left">
              <thead className="sticky top-0 bg-slate-100 text-[11px] uppercase tracking-wide text-slate-600 dark:bg-slate-900/90 dark:text-slate-400">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2 w-70 dark:border-slate-800">Time</th>
                  <th className="border-b border-slate-200 px-3 py-2 w-25 dark:border-slate-800">Level</th>
                  <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">Message</th>
                  <th className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">Source</th>
                </tr>
              </thead>
              <tbody>
                {orderedLogs.map((log) => (
                  <tr key={`${log.id}-${log.tsIso}`} className="border-b border-slate-200/80 last:border-b-0 dark:border-slate-800/80">
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600 dark:text-slate-300">
                      {formatLocalDateTime(log.tsIso)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${log.level === "error"
                          ? "bg-rose-500/10 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200"
                          : log.level === "warn"
                            ? "bg-amber-500/10 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
                            : log.level === "debug"
                              ? "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200"
                              : "bg-emerald-500/10 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                          }`}
                      >
                        {log.level}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-900 dark:text-slate-200">{log.message}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600 dark:text-slate-300">{log.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  async function refreshLogs(minLevel?: LogLevel, scope?: "workspace" | "app") {
    const level = minLevel ?? logMinLevel;
    if (!workspaceName) return;
    const targetScope = scope ?? logTab;

    setLogsError(null);
    try {
      if (targetScope === "app") {
        const appOut = await listAppLogs({ minLevel: level, limit: 200 });
        setAppLogs(appOut);
      } else {
        const wsOut = await listWorkspaceLogs(workspaceName, { minLevel: level, limit: 200 });
        setWorkspaceLogs(wsOut);
      }
    } catch (e) {
      setLogsError(String(e));
    }
  }

  useEffect(() => {
    if (!logViewerOpen || !workspaceName) return;

    setLogAutoFollow(true);
    setLogsError(null);

    let disposed = false;
    const unlisten: UnlistenFn[] = [];

    (async () => {
      try {
        // Best-effort prune when logs pane opens so the app log database stays within bounds.
        void invoke("prune_app_logs", { maxRows: 10_000 }).catch(() => { });

        // Initial load for both scopes so tabs are ready.
        await refreshLogs(logMinLevel, "workspace");
        await refreshLogs(logMinLevel, "app");

        const appUn = await listen<AppLogEntry>("app_log_appended", (event) => {
          if (disposed) return;
          setAppLogs((prev) => {
            const next = [...prev, event.payload];
            return next.length > 500 ? next.slice(next.length - 500) : next;
          });
        });
        unlisten.push(appUn);

        type WorkspaceLogPushedPayload = { workspace: string; entry: WorkspaceLogEntry };
        type WorkspaceLogsDeletedPayload = {
          workspace: string;
          deletedCount: number;
          olderThanIso: string | null;
        };

        const wsUn = await listen<WorkspaceLogPushedPayload>(
          "workspace_log_appended",
          (event) => {
            if (disposed) return;
            if (event.payload.workspace !== workspaceName) return;
            const entry = event.payload.entry;
            setWorkspaceLogs((prev) => {
              const next = [...prev, entry];
              return next.length > 500 ? next.slice(next.length - 500) : next;
            });
          },
        );
        unlisten.push(wsUn);

        const wsDeletedUn = await listen<WorkspaceLogsDeletedPayload>(
          "workspace_logs_deleted",
          (event) => {
            if (disposed) return;
            if (event.payload.workspace !== workspaceName) return;

            // Best-effort immediate UX: refresh the workspace log list so the viewer doesn't
            // keep showing logs that were deleted.
            void refreshLogs(logMinLevel, "workspace");
          },
        );
        unlisten.push(wsDeletedUn);
      } catch (e) {
        if (!disposed) {
          setLogsError(String(e));
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten.forEach((fn) => {
        void fn();
      });
    };
  }, [logViewerOpen, workspaceName, logMinLevel]);

  useEffect(() => {
    if (!logViewerOpen || !logAutoFollow) return;
    const container = logsScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [logViewerOpen, logAutoFollow, activeLogs, logTab]);

  useEffect(() => {
    if (!logViewerOpen) {
      setLogsError(null);
    }
  }, [logViewerOpen]);

  useEffect(() => {
    if (!trafficAvailable && inspectorTab === "traffic") {
      setInspectorTab("logs");
    }
  }, [trafficAvailable, inspectorTab]);

  const sidebarWidthClass = sidebarCollapsed ? "lg:w-18" : "lg:w-64";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-1">
              <img
                className="h-10 w-10 dark:hidden"
                src="/logo-dark.svg"
                alt="INOWIO"
                width={256}
                height={256}
              />
              <img
                className="hidden h-10 w-10 dark:block"
                src="/logo.svg"
                alt="INOWIO"
                width={256}
                height={256}
              />
              <div className="ml-1 md:ml-2">
                <p className="text-xs uppercase font-semibold  dark:font-normal tracking-[0.45em] text-emerald-700 dark:text-emerald-400">
                  <span className="brand-name">INOWIO</span>
                </p>
                <div className="truncate tracking-widest text-lg">Modbus Toolbox</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggleButton />
            <button
              type="button"
              className="hidden items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-500/60 hover:text-emerald-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:text-emerald-100 sm:inline-flex"
              onClick={() => {
                setLogViewerFullscreen(false);
                setInspectorTab("logs");
                setLogViewerOpen((prev) => {
                  const next = !prev || inspectorTab !== "logs";
                  void persistLogsPaneOpen(next);
                  return next;
                });
              }}
              title="Toggle logs"
            >
              <FiList className="h-3 w-3" aria-hidden="true" />
              <span className="truncate">Logs</span>
            </button>
            {trafficAvailable ? (
              <button
                type="button"
                className="hidden items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-500/60 hover:text-emerald-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:text-emerald-100 sm:inline-flex"
                onClick={() => {
                  setLogViewerFullscreen(false);
                  setInspectorTab("traffic");
                  setLogViewerOpen((prev) => {
                    const next = !prev || inspectorTab !== "traffic";
                    void persistLogsPaneOpen(next);
                    return next;
                  });
                }}
                title="Traffic monitor"
              >
                <FiActivity className="h-3 w-3" aria-hidden="true" />
                <span className="truncate">Traffic Monitor</span>
              </button>
            ) : null}
            <button
              type="button"
              className="hidden items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-500/60 hover:text-emerald-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:text-emerald-100 sm:inline-flex"
              onClick={() => openHelp({ section: "overview" })}
              title="Open help"
            >
              <FiBookOpen className="h-3 w-3" aria-hidden="true" />
              <span className="truncate">Help</span>
            </button>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600 lg:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle menu"
              title="Menu"
            >
              <FiMenu className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        <aside
          className={`fixed left-0 right-0 top-16 z-20 border-b border-slate-200 bg-white/80 p-4 backdrop-blur-sm transition-transform duration-150 lg:static lg:top-auto lg:z-auto ${sidebarWidthClass} lg:flex-none lg:translate-y-0 lg:border-b-0 lg:border-r lg:bg-white/60 lg:backdrop-blur-0 dark:border-slate-800 dark:bg-slate-900/80 dark:lg:bg-slate-900/50 ${menuOpen ? "translate-y-0" : "-translate-y-full"
            }`}
        >
          <nav className="flex flex-col gap-2 mt-8 lg:mt-0">
            <div className="mb-2 hidden justify-end lg:flex">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-900 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-700"
                onClick={() => setSidebarCollapsed((v) => !v)}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? (
                  <LuPanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <LuPanelRightOpen className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <div className="hidden border-t border-slate-200 pt-2 lg:block dark:border-slate-800" />
            <NavLink
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-semibold no-underline transition ${isActive
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
                }`
              }
              title={`${sidebarCollapsed ? "Workspace" : ""}`}
              to={`/app/${encodeURIComponent(workspaceName)}/workspace`}
              onClick={(e) => {
                e.preventDefault();
                const target = `/app/${encodeURIComponent(workspaceName)}/workspace`;
                if (!hasUnsavedChanges) {
                  setMenuOpen(false);
                  navigate(target);
                } else {
                  setMenuOpen(false);
                  setPendingPath(target);
                  setNavGuardOpen(true);
                }
              }}
            >
              <FiGrid className="h-4 w-4" aria-hidden="true" />
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : "inline"}`}>Workspace</span>
            </NavLink>

            <NavLink
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-semibold no-underline transition ${isActive
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
                }`
              }
              to={`/app/${encodeURIComponent(workspaceName)}/connection`}
              title={`${sidebarCollapsed ? "Connection" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                const target = `/app/${encodeURIComponent(workspaceName)}/connection`;
                if (!hasUnsavedChanges) {
                  setMenuOpen(false);
                  navigate(target);
                } else {
                  setMenuOpen(false);
                  setPendingPath(target);
                  setNavGuardOpen(true);
                }
              }}
            >
              <FiLink className="h-4 w-4" aria-hidden="true" />
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : "inline"}`}>Connection</span>
            </NavLink>

            <NavLink
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-semibold no-underline transition ${isActive
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
                }`
              }
              to={`/app/${encodeURIComponent(workspaceName)}/slaves`}
              title={`${sidebarCollapsed ? "Slaves" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                const target = `/app/${encodeURIComponent(workspaceName)}/slaves`;
                if (!hasUnsavedChanges) {
                  setMenuOpen(false);
                  navigate(target);
                } else {
                  setMenuOpen(false);
                  setPendingPath(target);
                  setNavGuardOpen(true);
                }
              }}
            >
              <PiNetwork className="h-4 w-4" aria-hidden="true" />
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : "inline"}`}>Slaves</span>
            </NavLink>

            <NavLink
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-semibold no-underline transition ${isActive
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
                }`
              }
              to={`/app/${encodeURIComponent(workspaceName)}/analyzer`}
              title={`${sidebarCollapsed ? "Analyzer" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                const target = `/app/${encodeURIComponent(workspaceName)}/analyzer`;
                if (!hasUnsavedChanges) {
                  setMenuOpen(false);
                  navigate(target);
                } else {
                  setMenuOpen(false);
                  setPendingPath(target);
                  setNavGuardOpen(true);
                }
              }}
            >
              <FiActivity className="h-4 w-4" aria-hidden="true" />
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : "inline"}`}>Analyzer</span>
            </NavLink>

            <NavLink
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-semibold no-underline transition ${isActive
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
                }`
              }
              to={`/app/${encodeURIComponent(workspaceName)}/client`}
              title={`${sidebarCollapsed ? "Settings" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                const target = `/app/${encodeURIComponent(workspaceName)}/client`;
                if (!hasUnsavedChanges) {
                  setMenuOpen(false);
                  navigate(target);
                } else {
                  setMenuOpen(false);
                  setPendingPath(target);
                  setNavGuardOpen(true);
                }
              }}
            >
              <LuSettings className="h-4 w-4" aria-hidden="true" />
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : "inline"}`}>Settings</span>
            </NavLink>
            <button
              type="button"
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 lg:hidden dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
              onClick={() => {
                setMenuOpen(false);
                setLogViewerFullscreen(false);
                setInspectorTab("logs");
                setLogViewerOpen((prev) => {
                  const next = !prev || inspectorTab !== "logs";
                  void persistLogsPaneOpen(next);
                  return next;
                });
              }}
              title="Toggle logs"
            >
              <FiList className="h-4 w-4" aria-hidden="true" />
              Logs
            </button>
            {trafficAvailable ? (
              <button
                type="button"
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 lg:hidden dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
                onClick={() => {
                  setMenuOpen(false);
                  setLogViewerFullscreen(false);
                  setInspectorTab("traffic");
                  setLogViewerOpen(true);
                  void persistLogsPaneOpen(true);
                }}
                title="Traffic monitor"
              >
                <FiActivity className="h-4 w-4" aria-hidden="true" />
                Traffic Monitor
              </button>
            ) : null}
            <NavLink
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-semibold no-underline transition ${isActive
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
                }`
              }
              to={`/app/${encodeURIComponent(workspaceName)}/about`}
              title={`${sidebarCollapsed ? "About" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                const target = `/app/${encodeURIComponent(workspaceName)}/about`;
                if (!hasUnsavedChanges) {
                  setMenuOpen(false);
                  navigate(target);
                } else {
                  setMenuOpen(false);
                  setPendingPath(target);
                  setNavGuardOpen(true);
                }
              }}
            >
              <FiInfo className="h-4 w-4" aria-hidden="true" />
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : "inline"}`}>About</span>
            </NavLink>
            <div className="mt-2 hidden border-t border-slate-200 pt-2 lg:block dark:border-slate-800" />
            <button
              type="button"
              className="hidden items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 lg:flex dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
              onClick={() => {
                setMenuOpen(false);
                void disconnectAll(workspaceName);
                navigate("/");
              }}
              title={`${sidebarCollapsed ? "Exit Workspace" : ""}`}
            >
              <FiX className="h-4 w-4" aria-hidden="true" />
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : "inline"}`}>Exit Workspace</span>
            </button>

            <div className="mt-2 border-t border-slate-200 pt-2 lg:hidden dark:border-slate-800" />

            <button
              type="button"
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 lg:hidden dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
              onClick={() => {
                setMenuOpen(false);
                openHelp();
              }}
              title="Open help"
            >
              <FiBookOpen className="h-4 w-4" aria-hidden="true" />
              Help
            </button>
            <button
              type="button"
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 lg:hidden dark:border-slate-800 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-700"
              onClick={() => {
                setMenuOpen(false);
                void disconnectAll(workspaceName);
                navigate("/");
              }}
              title="Close workspace"
            >
              <FiX className="h-4 w-4" aria-hidden="true" />
              Exit Workspace
            </button>
          </nav>
        </aside>

        <div className="flex min-w-0 w-full flex-1 flex-col">
          <main className={logViewerOpen && logViewerFullscreen ? "hidden" : "min-w-0 w-full flex-1 overflow-y-auto py-4 sm:px-4"}>
            {error ? (
              <div className="max-w-5xl rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            ) : null}
            {loading && !workspace ? <div className="flex items-center gap-2 p-2 text-sm text-slate-600 dark:text-slate-300 animate-pulse">
              <FiRefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading...
            </div> : null}

            {workspace && ctx ? <Outlet context={ctx} /> : null}
          </main>

          {logViewerOpen ? (
            <div className="bg-slate-50/95 dark:bg-slate-950/95">
              <div
                className="flex flex-col border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
                style={logViewerFullscreen ? { height: "calc(100vh - 64px)" } : { height: logPaneHeight }}
              >
                <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex gap-1 rounded-full border border-slate-200 bg-slate-100 p-1 text-xs dark:border-slate-800 dark:bg-slate-900/80">
                      <button
                        type="button"
                        className={`px-3 py-1 font-semibold transition rounded-md ${inspectorTab === "logs"
                          ? "bg-emerald-500/10 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                          }`}
                        onClick={() => setInspectorTab("logs")}
                      >
                        Logs
                      </button>
                      {trafficAvailable ? (
                        <button
                          type="button"
                          className={`px-3 py-1 font-semibold transition rounded-md ${inspectorTab === "traffic"
                            ? "bg-emerald-500/10 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                            : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                            }`}
                          onClick={() => setInspectorTab("traffic")}
                        >
                          Traffic Monitor
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div
                    className="mb-2 flex cursor-row-resize items-center justify-center text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300"
                    onMouseDown={handleLogPaneResizeMouseDown}
                  >
                    <div className="h-0.5 w-10 sm:w-20 lg:w-30 rounded-full bg-slate-300 dark:bg-slate-700" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
                      onClick={() => setLogViewerFullscreen((prev) => !prev)}
                      title={
                        logViewerFullscreen ? "Expand" : "Collapse"
                      }
                    >
                      {logViewerFullscreen ? (
                        <>
                          <FiMinimize2 className="h-3 w-3" aria-hidden="true" />
                          Collapse
                        </>
                      ) : (
                        <>
                          <FiMaximize2 className="h-3 w-3" aria-hidden="true" />
                          Expand
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
                      onClick={() => {
                        setTrafficMonitoring(false);
                        setLogViewerOpen(false);
                        void persistLogsPaneOpen(false);
                      }}
                      title="Hide this panel"
                    >
                      <FiX className="h-4 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {inspectorTab === "logs" ? logsMain : null}
                {inspectorTab === "traffic" && trafficAvailable && trafficContext ? (
                  <TrafficMonitorPanel
                    workspaceName={workspaceName}
                    slaveId={trafficContext.slaveId}
                    monitoring={trafficMonitoring}
                    onMonitoringChange={setTrafficMonitoring}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {navGuardOpen && pendingPath ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
            <div className="mb-4">
              <div className="text-sm font-semibold text-emerald-400">Unsaved changes</div>
            </div>

            <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200">
              There are unsaved changes on this screen. If you leave now, those changes will be lost.
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-700 bg-white/5 px-4 py-1 text-sm font-semibold text-slate-100 transition hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                onClick={() => {
                  setNavGuardOpen(false);
                  setPendingPath(null);
                }}
              >
                Stay on this screen
              </button>
              <button
                type="button"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-rose-500/60 bg-rose-500/10 px-4 py-1 text-sm font-semibold text-rose-200 transition hover:border-rose-400 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                onClick={() => {
                  const target = pendingPath;
                  setNavGuardOpen(false);
                  setPendingPath(null);
                  if (target) {
                    navigate(target);
                  }
                }}
              >
                Leave without saving
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
