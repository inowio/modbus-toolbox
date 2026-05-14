import { FiX } from "react-icons/fi";

interface ImportConflictModalProps {
  open: boolean;
  workspaceName: string;
  busy?: boolean;
  activeAction?: "overwrite" | "new" | null;
  onOverwrite: () => void;
  onImportAsNew: () => void;
  onClose: () => void;
}

export default function ImportConflictModal({
  open,
  workspaceName,
  busy = false,
  activeAction = null,
  onOverwrite,
  onImportAsNew,
  onClose,
}: ImportConflictModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            Workspace Already Exists
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <FiX size={18} />
          </button>
        </div>

        {/* Body */}
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">
          A workspace named <strong className="text-slate-800 dark:text-slate-100">{workspaceName}</strong> already exists. What would you like to do?
        </p>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onImportAsNew}
            disabled={busy}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
          >
            {activeAction === "new" ? "Importing..." : "Import as New"}
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            disabled={busy}
            className="rounded-full border border-rose-600/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-400 dark:hover:bg-rose-500/20"
          >
            {activeAction === "overwrite" ? "Overwriting..." : "Overwrite"}
          </button>
        </div>
      </div>
    </div>
  );
}
