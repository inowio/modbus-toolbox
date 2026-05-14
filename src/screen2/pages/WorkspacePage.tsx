import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { Screen2OutletContext, Workspace } from "../Screen2Layout";
import { FiDownload, FiSave, FiTrash2 } from "react-icons/fi";
import { formatLocalDateTime } from "../../datetime";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useErrorToast, useToast } from "../../components/ToastProvider";
import { logEvent } from "../api/logs";

export default function WorkspacePage() {
  const { workspace, refreshWorkspace } = useOutletContext<Screen2OutletContext>();
  const navigate = useNavigate();

  const { pushToast } = useToast();

  const [description, setDescription] = useState(workspace.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useErrorToast(error);
  useErrorToast(deleteError);

  useEffect(() => {
    setDescription(workspace.description ?? "");
  }, [workspace.name, workspace.updated_at]);

  const isDirty = useMemo(() => {
    return (workspace.description ?? "") !== description;
  }, [workspace.description, description]);

  const saveRef = useRef<() => void>(() => {});

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      await invoke<Workspace>("update_workspace_description", {
        name: workspace.name,
        description,
        nowIso,
      });
      await refreshWorkspace();
      pushToast("Saved", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "workspace",
        message: "Workspace description saved",
        detailsJson: {
          hadDescription: description.trim() !== "",
          length: description.length,
        },
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "workspace",
        message: "Failed to save workspace description",
        detailsJson: {
          error: message,
        },
      });
    } finally {
      setSaving(false);
    }
  }

  async function exportWorkspace() {
    setExporting(true);
    try {
      const exported = await invoke<boolean>("export_workspace_package", {
        name: workspace.name,
        fileName: `${workspace.name}.zip`,
      });
      if (exported) {
        pushToast("Workspace exported", "info");
      }
    } catch (e) {
      pushToast(String(e), "error");
    } finally {
      setExporting(false);
    }
  }

  saveRef.current = save;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "s" && e.key !== "S") return;

      if (!isDirty || saving || deleting) return;

      e.preventDefault();
      void saveRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDirty, saving, deleting]);

  async function deleteWorkspace() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke<void>("delete_workspace", { name: workspace.name });
      navigate("/");
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-inner dark:shadow-black/30">
        <div>
          <p className="text-sm uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">Workspace</p>
        </div>
      </div>
      <div className="w-full rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-sm">
        {error ? (
          <div className="mt-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="mt-4 space-y-6">
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Information
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-1">
              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Workspace Name
                </div>
                <div
                  className="mt-2 truncate text-sm text-slate-900 dark:text-slate-100"
                  title={workspace.name}
                >
                  {workspace.name}
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 md:col-span-2 dark:border-slate-800 dark:bg-slate-950/40">
                <label
                  className="text-sm font-semibold text-slate-700 dark:text-slate-300"
                  htmlFor="ws-desc"
                >
                  Short Description
                </label>
                <input
                  id="ws-desc"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                  value={description}
                  onChange={(e) => setDescription(e.currentTarget.value)}
                  placeholder="Optional"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Created At
                </div>
                <div className="mt-2 text-sm text-slate-700 dark:text-slate-100">
                  {formatLocalDateTime(workspace.created_at)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Updated At
                </div>
                <div className="mt-2 text-sm text-slate-700 dark:text-slate-100">
                  {formatLocalDateTime(workspace.updated_at)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-sm">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void exportWorkspace()}
            disabled={saving || exporting || deleting}
            className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <FiDownload size={15} />
            {exporting ? "Exporting..." : "Export Workspace"}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-rose-600/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-500 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/60 dark:text-rose-200 dark:hover:border-rose-400/80 dark:hover:text-rose-100"
            onClick={() => {
              setDeleteError(null);
              setIsDeleteOpen(true);
            }}
            title="Delete this workspace"
            disabled={saving}
          >
            <FiTrash2 className="h-4 w-4" aria-hidden="true" />
            Delete
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
            onClick={() => save()}
            disabled={!isDirty || saving}
            title="Save workspace information"
          >
            <FiSave className="h-4 w-4" aria-hidden="true" />
            {saving ? "Saving..." : "Save Info"}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={isDeleteOpen}
        tone="danger"
        title="Delete Workspace?"
        description={
          <>
            This will permanently delete <span className="font-semibold text-emerald-700 dark:text-emerald-300">{workspace.name}</span> including all stored settings and data.
          </>
        }
        error={deleteError}
        confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
        confirmText={deleting ? "Deleting..." : "Delete"}
        busy={deleting}
        onClose={() => {
          if (deleting) return;
          setIsDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => deleteWorkspace()}
      />
    </div>
  );
}
