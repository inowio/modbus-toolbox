import type { ReactNode } from "react";
import { RiCloseLine } from "react-icons/ri";

type Tone = "danger" | "default";

type Props = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmText: string;
  cancelText?: string;
  confirmIcon?: ReactNode;
  tone?: Tone;
  busy?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText = "Cancel",
  confirmIcon,
  tone = "default",
  busy = false,
  error,
  onConfirm,
  onClose,
}: Props) {
  if (!open) return null;

  const confirmClass =
    tone === "danger"
      ? "inline-flex items-center gap-2 rounded-full border border-rose-600/60 bg-rose-500/10 px-4 py-2 font-semibold text-rose-800 transition hover:border-rose-500 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-400 dark:bg-rose-500/20 dark:text-rose-200 dark:hover:border-rose-300 dark:hover:text-rose-100"
      : "inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-100 dark:hover:border-emerald-300 dark:hover:text-emerald-50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-200">{title}</div>
          </div>
          <button
            type="button"
            className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
            onClick={() => {
              if (busy) return;
              onClose();
            }}
            title="Close"
            disabled={busy}
          >
            <RiCloseLine className="h-4 w-3" aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <div className="mt-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200">
          {description}
        </div>

        <div className="mt-4 flex justify-end gap-2 text-xs">
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
            onClick={() => {
              if (busy) return;
              onClose();
            }}
            disabled={busy}
          >
            {cancelText}
          </button>
          <button type="button" className={confirmClass} onClick={() => onConfirm()} disabled={busy}>
            {confirmIcon}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
