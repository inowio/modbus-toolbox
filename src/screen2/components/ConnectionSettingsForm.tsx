import { FiRefreshCw } from "react-icons/fi";

export type ConnectionKind = "serial" | "tcp";

export type ConnectionSettings = {
  kind: ConnectionKind;

  serialPort?: string | null;
  serialBaud?: number | null;
  serialParity?: "none" | "even" | "odd" | string | null;
  serialDataBits?: number | null;
  serialStopBits?: number | null;
  serialFlowControl?: "none" | "hardware" | "software" | string | null;

  tcpHost?: string | null;
  tcpPort?: number | null;
};

export type PortItem = {
  port: string;
  label: string;
};

const BAUD_RATE_OPTIONS = ["9600", "19200", "38400", "57600", "115200", "230400", "460800", "921600"];
const DATA_BITS_OPTIONS = ["5", "6", "7", "8"];
const STOP_BITS_OPTIONS = ["1", "2"];

export function normalizeConnectionSettings(settings: Partial<ConnectionSettings> & { kind?: ConnectionKind }): ConnectionSettings {
  const kind: ConnectionKind = settings.kind ?? "serial";
  return {
    kind,
    serialPort: settings.serialPort ?? null,
    serialBaud: settings.serialBaud ?? 9600,
    serialParity: (settings.serialParity ?? "none") as ConnectionSettings["serialParity"],
    serialDataBits: settings.serialDataBits ?? 8,
    serialStopBits: settings.serialStopBits ?? 1,
    serialFlowControl: (settings.serialFlowControl ?? "none") as ConnectionSettings["serialFlowControl"],
    tcpHost: settings.tcpHost ?? "127.0.0.1",
    tcpPort: settings.tcpPort ?? 502,
  };
}

export type ConnectionSettingsFormProps = {
  value: ConnectionSettings;
  onChange: (value: ConnectionSettings) => void;
  serialPortOptions: PortItem[];
  onRefreshSerialPorts: () => void;
  loading?: boolean;
  saving?: boolean;
};

export function ConnectionSettingsForm({
  value,
  onChange,
  serialPortOptions,
  onRefreshSerialPorts,
  loading,
  saving,
}: ConnectionSettingsFormProps) {
  const kind = value.kind;
  const disabled = !!loading || !!saving;

  const setKind = (next: ConnectionKind) => {
    if (disabled) return;
    onChange({ ...value, kind: next });
  };

  const update = <K extends keyof ConnectionSettings>(key: K, v: ConnectionSettings[K]) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex gap-1 rounded-full border border-slate-300 bg-slate-100 p-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
        {(
          [
            { id: "serial" as ConnectionKind, label: "Serial (RTU)" },
            { id: "tcp" as ConnectionKind, label: "TCP" },
          ] as const
        ).map((tab) => {
          const active = kind === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`inline-flex items-center justify-center rounded-full px-4 py-1.5 transition ${
                active
                  ? "bg-emerald-500/15 text-emerald-800 w-full dark:bg-emerald-500/20 dark:text-emerald-200"
                  : "text-slate-600 hover:bg-slate-200/80 w-full dark:text-slate-300 dark:hover:bg-slate-800/80"
              }`}
              onClick={() => setKind(tab.id)}
              disabled={disabled}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {kind === "serial" ? (
        <div className="p-4">
          <div className="flex flex-col gap-4">
            <div className="grid gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="serial-port">
                  Serial Port
                </label>
                <div className="flex items-center gap-2">
                  <select
                    id="serial-port"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                    value={value.serialPort ?? ""}
                    onChange={(e) => update("serialPort", e.currentTarget.value)}
                    disabled={disabled}
                  >
                    <option value="">Select a port</option>
                    {serialPortOptions.map((p) => (
                      <option key={p.port} value={p.port}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                    onClick={onRefreshSerialPorts}
                    disabled={disabled}
                    aria-label="Refresh serial ports"
                    title="Refresh serial ports"
                  >
                    <FiRefreshCw className="h-4 w-4" aria-hidden="true" />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="serial-baud">
                  Baud Rate
                </label>
                <select
                  id="serial-baud"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                  value={String(value.serialBaud ?? 9600)}
                  onChange={(e) => update("serialBaud", Number(e.currentTarget.value) || 9600)}
                  disabled={disabled}
                >
                  {BAUD_RATE_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="serial-parity">
                  Parity
                </label>
                <select
                  id="serial-parity"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                  value={value.serialParity ?? "none"}
                  onChange={(e) => update("serialParity", e.currentTarget.value)}
                  disabled={disabled}
                >
                  <option value="none">None</option>
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="serial-data-bits">
                  Data Bits
                </label>
                <select
                  id="serial-data-bits"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                  value={String(value.serialDataBits ?? 8)}
                  onChange={(e) => update("serialDataBits", Number(e.currentTarget.value) || 8)}
                  disabled={disabled}
                >
                  {DATA_BITS_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="serial-stop-bits">
                  Stop Bits
                </label>
                <select
                  id="serial-stop-bits"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                  value={String(value.serialStopBits ?? 1)}
                  onChange={(e) => update("serialStopBits", Number(e.currentTarget.value) || 1)}
                  disabled={disabled}
                >
                  {STOP_BITS_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="serial-flow-control">
                  Flow Control
                </label>
                <select
                  id="serial-flow-control"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                  value={value.serialFlowControl ?? "none"}
                  onChange={(e) => update("serialFlowControl", e.currentTarget.value)}
                  disabled={disabled}
                >
                  <option value="none">None</option>
                  <option value="hardware">Hardware (RTS/CTS)</option>
                  <option value="software">Software (XON/XOFF)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {kind === "tcp" ? (
        <div className="p-3">
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="tcp-host">
                Host
              </label>
              <input
                id="tcp-host"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                value={value.tcpHost ?? ""}
                onChange={(e) => update("tcpHost", e.currentTarget.value)}
                disabled={disabled}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="tcp-port">
                Port
              </label>
              <input
                id="tcp-port"
                type="number"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                value={value.tcpPort ?? ""}
                onChange={(e) => {
                  const raw = e.currentTarget.value;
                  if (raw.trim() === "") {
                    update("tcpPort", null);
                    return;
                  }
                  const parsed = Number(raw);
                  if (!Number.isFinite(parsed)) return;
                  update("tcpPort", parsed);
                }}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
