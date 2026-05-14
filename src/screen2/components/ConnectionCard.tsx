import { FiLink, FiTool, FiX } from "react-icons/fi";

export type ConnectionCardProps = {
  conn: {
    kind: string;
    tcpHost?: string | null;
    tcpPort?: number | null;
    serialPort?: string | null;
    serialBaud?: number | null;
  } | null;
  slave: { unitId: number; connectionKind?: "serial" | "tcp" | string | null } | null;
  busy: boolean;
  connected: boolean;
  onChangeConnectionKind?: (kind: "serial" | "tcp") => void;
  onOpenConfigure?: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

export function ConnectionCard({
  conn,
  slave,
  busy,
  connected,
  onChangeConnectionKind,
  onOpenConfigure,
  onConnect,
  onDisconnect,
}: ConnectionCardProps) {
  const currentKind =
    (slave?.connectionKind as "serial" | "tcp" | undefined) ??
    (conn?.kind as "serial" | "tcp" | undefined) ??
    "serial";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-col gap-4">
        {/* Header row: title + connect / status */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-200">
            Connection
            <span
              className={`inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-sm font-semibold dark:bg-slate-800/70 ${connected
                ? "text-emerald-700 dark:text-emerald-200"
                : "text-rose-700 dark:text-red-400"
                }`}
            >
              {connected ? <FiLink className="h-4 w-4" aria-hidden="true" /> : <FiX className="h-4 w-4" aria-hidden="true" />}
              {connected ? "Connected" : "Disconnected"}
            </span>

          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!connected ? (
              <button
                type="button"
                className="inline-flex min-w-30 items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                onClick={onConnect}
                disabled={busy || !slave || (conn?.kind !== "tcp" && conn?.kind !== "serial")}
              >
                <FiLink className="h-4 w-4" aria-hidden="true" />
                Connect
              </button>
            ) : null}

            {connected ? (
              <button
                type="button"
                className="inline-flex min-w-30 items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-500/60 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-200 dark:hover:border-rose-400/60 dark:hover:text-rose-100"
                onClick={onDisconnect}
                disabled={busy || !slave}
              >
                <FiX className="h-4 w-4" aria-hidden="true" />
                Disconnect
              </button>
            ) : null}
          </div>
        </div>

        {/* Second row: type + details + configure */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
          <div className="min-w-0 md:flex-1">
            <div className="w-full flex flex-col gap-2 text-sm text-slate-900 dark:text-slate-100">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Type</span>
                <select
                  id="connection-kind"
                  className="flex-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:focus:border-emerald-500/60"
                  value={currentKind}
                  onChange={(e) => {
                    const v = e.currentTarget.value as "serial" | "tcp";
                    if (!onChangeConnectionKind) return;
                    onChangeConnectionKind(v);
                  }}
                  disabled={busy || connected || !onChangeConnectionKind}
                >
                  <option value="serial">Serial (RTU)</option>
                  <option value="tcp">TCP</option>
                </select>

                <div className="flex items-start justify-end">
                  {onOpenConfigure ? (
                    <button
                      type="button"
                      className="inline-flex min-w-30 items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                      onClick={onOpenConfigure}
                      disabled={busy || connected}
                    >
                      <FiTool className="h-4 w-4" aria-hidden="true" />
                      Configure
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {currentKind === "tcp" ? (
              <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                <div>
                  Endpoint: <span className="font-semibold text-emerald-700 dark:text-emerald-400">{conn?.tcpHost ?? "-"}</span>
                  <span className="text-slate-400 dark:text-slate-500"> | </span>
                  Port: <span className="font-semibold text-emerald-700 dark:text-emerald-400">{conn?.tcpPort ?? "-"}</span>
                </div>
              </div>
            ) : null}

            {currentKind === "serial" ? (
              <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                <div>
                  Port:{" "}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {conn?.serialPort && conn.serialPort.trim() !== "" ? conn.serialPort : "-"}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500"> | </span>
                  Baud Rate:{" "}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">{conn?.serialBaud != null ? conn.serialBaud : "-"}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
