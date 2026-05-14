export type PollConfigCardProps = {
  slaveAddress: string;
  hasSlaveAddressUnsavedChanges: boolean;
  pollIntervalMs: string;
  hasPollUnsavedChanges: boolean;
  baseAddress: "0" | "1";
  hasBaseAddressUnsavedChanges: boolean;
  busy: boolean;
  onChangeSlaveAddress: (value: string) => void;
  onChangePollInterval: (value: string) => void;
  onChangeBaseAddress: (value: "0" | "1") => void;
};

export function PollConfigCard({
  slaveAddress,
  hasSlaveAddressUnsavedChanges,
  pollIntervalMs,
  hasPollUnsavedChanges,
  baseAddress,
  hasBaseAddressUnsavedChanges,
  busy,
  onChangeSlaveAddress,
  onChangePollInterval,
  onChangeBaseAddress,
}: PollConfigCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="slave-address">
              Slave Address (Unit ID)
            </label>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id="slave-address"
                type="number"
                className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                value={slaveAddress}
                onChange={(e) => onChangeSlaveAddress(e.currentTarget.value)}
                min={0}
                max={255}
                disabled={busy}
              />
              {hasSlaveAddressUnsavedChanges ? (
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Unsaved
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="base-address">
              Base Address
            </label>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                id="base-address"
                className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                value={baseAddress}
                onChange={(e) => {
                  const v = (e.currentTarget.value === "1" ? "1" : "0") as "0" | "1";
                  onChangeBaseAddress(v);
                }}
                disabled={busy}
              >
                <option value="0">0-based</option>
                <option value="1">1-based</option>
              </select>
              {hasBaseAddressUnsavedChanges ? (
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Unsaved
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 sm:col-span-2">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="poll-interval">
              Poll interval (ms)
            </label>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id="poll-interval"
                type="number"
                className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                value={pollIntervalMs}
                onChange={(e) => onChangePollInterval(e.currentTarget.value)}
                min={1}
                disabled={busy}
              />
              {hasPollUnsavedChanges ? (
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Unsaved
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
