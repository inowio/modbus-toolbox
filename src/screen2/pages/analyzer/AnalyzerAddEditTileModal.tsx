import { useEffect, useMemo, useState } from "react";
import type { AnalyzerSignal, AnalyzerTile, AnalyzerTileSignalInfo } from "../../api/analyzer";

type TileKind = "trend" | "value";

type Props = {
  open: boolean;
  mode: "add" | "edit";
  signals: AnalyzerSignal[];
  slavesById: Map<number, { pollIntervalMs: number }>;
  editingTile: AnalyzerTile | null;
  editingTilePrimary: AnalyzerTileSignalInfo | null;
  initialKind?: TileKind;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: {
    kind: TileKind;
    title: string;
    signalId: string;
  }) => void;
};

function normalizeKind(raw: string | null | undefined): TileKind {
  const k = (raw || "").trim().toLowerCase();
  if (k === "trend" || k === "chart") return "trend";
  return "value";
}

export default function AnalyzerAddEditTileModal(props: Props) {
  const [kind, setKind] = useState<TileKind>(props.initialKind ?? "value");
  const [title, setTitle] = useState<string>("");
  const [signalId, setSignalId] = useState<string>("");

  const defaultSignalId = useMemo(() => {
    const first = props.signals[0]?.id ?? "";
    return first;
  }, [props.signals]);

  useEffect(() => {
    if (!props.open) return;

    if (props.mode === "edit" && props.editingTile) {
      setKind(normalizeKind(props.editingTile.kind));
      setTitle(props.editingTile.title ?? "");
      const primary = props.editingTilePrimary;
      setSignalId(primary?.signalId ?? defaultSignalId);
      return;
    }

    setKind(props.initialKind ?? "value");
    setTitle("");
    setSignalId(defaultSignalId);
  }, [defaultSignalId, props.editingTile, props.editingTilePrimary, props.initialKind, props.mode, props.open]);

  const pollIntervalMs = useMemo(() => {
    const sig = props.signals.find((s) => s.id === signalId) ?? null;
    if (!sig) return 1000;
    const slave = props.slavesById.get(sig.slaveId) ?? null;
    const fromSlave = slave?.pollIntervalMs ?? 0;
    return fromSlave > 0 ? fromSlave : 1000;
  }, [props.signals, props.slavesById, signalId]);

  if (!props.open) return null;

  const busy = !!props.busy;
  const hasSignals = props.signals.length > 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <div className="mb-4">
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {props.mode === "edit" ? "Edit tile" : "Add tile"}
          </div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">Configure tile type and signal.</div>
        </div>

        {props.error ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            {props.error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Tile type</div>
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
              value={kind}
              onChange={(e) => setKind(e.currentTarget.value === "trend" ? "trend" : "value")}
              disabled={busy}
              title="Tile type"
            >
              <option value="trend">Trend Chart</option>
              <option value="value">Value Tile</option>
            </select>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Primary signal</div>
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
              value={signalId}
              onChange={(e) => setSignalId(e.currentTarget.value)}
              disabled={busy || !hasSignals}
            >
              {props.signals.length === 0 ? <option value="">No signals</option> : null}
              {props.signals.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Title <span className="text-xs text-slate-500 dark:text-slate-400">(optional)</span></div>
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              placeholder={`${signalId ? `e.g. ${signalId}` : "e.g. the signal name"}`}
              disabled={busy}
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
            Poll interval: <span className="font-semibold text-slate-900 dark:text-slate-100">{pollIntervalMs} ms</span>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
            onClick={() => {
              const sid = signalId.trim();
              if (!sid) return;
              props.onSubmit({
                kind,
                title: title.trim(),
                signalId: sid,
              });
            }}
            disabled={busy || !hasSignals || !signalId.trim()}
          >
            {props.mode === "edit" ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
