import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { Screen2OutletContext } from "../Screen2Layout";
import { FiEdit2, FiPlus, FiRefreshCcw, FiRefreshCw, FiSave, FiTrash2, FiX } from "react-icons/fi";
import { formatLocalDateTime } from "../../datetime";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useErrorToast, useToast } from "../../components/ToastProvider";
import { logEvent } from "../api/logs";
import { MdOpenInNew } from "react-icons/md";

type SlaveItem = {
  id: number;
  name: string;
  unitId: number;
  createdAt: string;
  updatedAt: string;
};

type SlaveCreate = {
  name: string;
  unitId: number;
};

function humanizeSlaveError(err: unknown): string {
  const msg = String(err);
  if (/UNIQUE constraint failed:\s*slaves\.unit_id/i.test(msg)) {
    return "A slave with this Unit ID already exists in this workspace. Each slave must have a unique Unit ID.";
  }

  if (
    /cannot delete slave because it is used by the Analyzer dashboard/i.test(msg) ||
    /foreign key constraint failed/i.test(msg)
  ) {
    return "Cannot delete this slave because it is used by the Analyzer dashboard. Remove dependent signals/tiles first.";
  }

  return msg;
}

function parseIntOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return Math.trunc(v);
}

export default function SlavesPage() {
  const { workspace } = useOutletContext<Screen2OutletContext>();
  const navigate = useNavigate();

  const { pushToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<SlaveItem[]>([]);
  const [query, setQuery] = useState("");

  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [modalSlaveId, setModalSlaveId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formUnitId, setFormUnitId] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<SlaveItem | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useErrorToast(error);
  useErrorToast(formError);
  useErrorToast(deleteError);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await invoke<SlaveItem[]>("list_slaves", { name: workspace.name });
      setItems(rows);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [workspace.name]);

  const filtered = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return items;
    return items.filter((s) => {
      if (s.name.toLowerCase().includes(t)) return true;
      if (String(s.unitId).includes(t)) return true;
      return false;
    });
  }, [items, query]);

  function openAdd() {
    setFormError(null);
    setModalMode("add");
    setModalSlaveId(null);
    setFormName("");
    setFormUnitId("");
  }

  function openEdit(s: SlaveItem) {
    setFormError(null);
    setModalMode("edit");
    setModalSlaveId(s.id);
    setFormName(s.name);
    setFormUnitId(String(s.unitId));
  }

  function closeModal(force = false) {
    if (!force && saving) return;
    setFormError(null);
    setModalMode(null);
    setModalSlaveId(null);
  }

  async function submitModal() {
    if (!modalMode) return;
    setSaving(true);
    setFormError(null);
    try {
      const name = formName.trim();
      const unitId = parseIntOrNull(formUnitId);
      if (!name) {
        setFormError("Name is required");
        return;
      }
      if (unitId == null) {
        setFormError("Unit ID is required");
        return;
      }
      if (unitId <= 0) {
        setFormError("Slave Address (Unit ID) must be a positive number");
        return;
      }

      const nowIso = new Date().toISOString();

      if (modalMode === "add") {
        const slave: SlaveCreate = { name, unitId };
        const created = await invoke<SlaveItem>("create_slave", {
          name: workspace.name,
          slave,
          nowIso,
        });
        setItems((prev) => {
          const next = [created, ...prev.filter((x) => x.id !== created.id)];
          next.sort((a, b) => a.unitId - b.unitId);
          return next;
        });
        void logEvent({
          scope: "workspace",
          level: "info",
          workspaceName: workspace.name,
          source: "slaves",
          message: "Slave created",
          detailsJson: {
            id: created.id,
            unitId: created.unitId,
            name: created.name,
          },
        });
        pushToast(`Slave "${created.name}" added`, "info");
        closeModal(true);
        return;
      }

      if (modalSlaveId == null) {
        setFormError("No slave selected");
        return;
      }

      const updated = await invoke<SlaveItem>("update_slave", {
        name: workspace.name,
        id: modalSlaveId,
        patch: { name, unitId },
        nowIso,
      });

      setItems((prev) => {
        const next = prev.map((x) => (x.id === modalSlaveId ? updated : x));
        next.sort((a, b) => a.unitId - b.unitId);
        return next;
      });
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slaves",
        message: "Slave updated",
        detailsJson: {
          id: updated.id,
          unitId: updated.unitId,
          name: updated.name,
        },
      });
      pushToast(`Slave "${updated.name}" updated`, "info");
      closeModal(true);
    } catch (e) {
      const human = humanizeSlaveError(e);
      setFormError(human);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slaves",
        message: modalMode === "add" ? "Failed to create slave" : "Failed to update slave",
        detailsJson: {
          error: String(e),
          humanMessage: human,
          mode: modalMode,
          slaveId: modalSlaveId,
        },
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number): Promise<boolean> {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await invoke<void>("delete_slave", { name: workspace.name, id });
      setItems((prev) => prev.filter((x) => x.id !== id));
      pushToast("Slave deleted", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slaves",
        message: "Slave deleted",
        detailsJson: {
          id,
        },
      });
      return true;
    } catch (e) {
      const human = humanizeSlaveError(e);
      setDeleteError(human);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slaves",
        message: "Failed to delete slave",
        detailsJson: {
          error: String(e),
          humanMessage: human,
          id,
        },
      });
      return false;
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-inner dark:shadow-black/30">
        <div>
          <p className="text-sm uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">Slaves</p>
          <div className="text-sm mt-2 text-slate-600 dark:text-slate-300">Manage slave devices in this workspace.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
            onClick={() => openAdd()}
            disabled={loading || saving || deletingId != null}
            title="Add slave"
          >
            <FiPlus className="h-4 w-4" aria-hidden="true" />
            Add
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-2 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
            onClick={() => refresh()}
            disabled={loading || saving || deletingId != null}
            title="Refresh"
          >
            <FiRefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? <div className="flex items-center gap-2 p-2 text-sm text-slate-600 dark:text-slate-300 animate-pulse">
        <FiRefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading...
      </div> : null}

      <div className="w-full rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-sm">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="slave-search">
            Search
          </label>
          <div className="relative w-full">
            <input
              id="slave-search"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Name or Unit Address"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute inset-y-0 right-2 flex items-center text-xs text-slate-500 transition hover:text-slate-700 dark:hover:text-slate-300"
                aria-label="Clear search"
              >
                <FiX className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Slaves: {items.length}</div>
          {
            items.length !== filtered.length ? (
              <div className="text-sm text-slate-600 dark:text-slate-300">Search result: {filtered.length}</div>
            ) : null
          }
        </div>

        {deleteError ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {deleteError}
          </div>
        ) : null}

        <ul className="mt-4 flex flex-col gap-3">
          {filtered.map((s) => {
            const busy = saving || deletingId === s.id || loading;
            return (
              <li key={s.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="min-w-0 truncate text-left text-md font-semibold text-slate-900 hover:underline disabled:opacity-60 dark:text-slate-100"
                      onClick={() => navigate(String(s.id))}
                      disabled={busy}
                      title={"Open " + s.name}
                    >
                      <span className="text-sm uppercase font-semibold  dark:font-normal tracking-[0.15em] text-emerald-700 dark:text-emerald-300">Unit-ID {s.unitId}:</span> {s.name}
                    </button>
                    <div className="mt-1 grid gap-1 text-xs text-slate-500 sm:grid-cols-2 dark:text-slate-500">
                      <div>Created: {formatLocalDateTime(s.createdAt)}</div>
                      <div>Updated: {formatLocalDateTime(s.updatedAt)}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3" />
                  </div>
                  

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 justify-center rounded-full border border-emerald-600/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500/60 hover:text-emerald-900 dark:border-emerald-500/30 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                      onClick={() => navigate(String(s.id))}
                      title={"Open " + s.name}
                    >
                      <MdOpenInNew className="h-4 w-4" aria-hidden="true" />
                      Open
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                      onClick={() => openEdit(s)}
                      disabled={busy || deletingId != null}
                      title="Edit slave"
                    >
                      <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                      Edit
                    </button>

                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-rose-600/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-500 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/60 dark:text-rose-200 dark:hover:border-rose-400/80 dark:hover:text-rose-100"
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmDelete(s);
                      }}
                      disabled={busy || deletingId != null}
                      title="Delete slave"
                    >
                      <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {filtered.length === 0 ? <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">No slaves found.</div> : null}
      </div>

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/60"
            onClick={() => closeModal()}
            aria-label="Close"
          />

          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  {modalMode === "add" ? "Add Slave" : "Edit Slave"}
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Name and Slave Address (Unit ID).</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-slate-100 p-2 text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => closeModal()}
                disabled={saving}
                title="Close"
              >
                <FiX className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {formError ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
                {formError}
              </div>
            ) : null}

            <div className="mt-4 grid gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="slave-form-name">
                  Name
                </label>
                <input
                  id="slave-form-name"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                  value={formName}
                  onChange={(e) => setFormName(e.currentTarget.value)}
                  placeholder="e.g. Pressure-Sensor-1"
                  disabled={saving}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="slave-form-unitid">
                  Slave Address (Unit ID)
                </label>
                <input
                  id="slave-form-unitid"
                  type="number"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                  min={1}
                  value={formUnitId}
                  onChange={(e) => setFormUnitId(e.currentTarget.value)}
                  placeholder="1"
                  disabled={saving}
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => closeModal()}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                onClick={() => submitModal()}
                disabled={saving}
              >
                {modalMode === "add" ? (
                  <FiPlus className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <FiSave className="h-4 w-4" aria-hidden="true" />
                )}
                {saving ? "Saving..." : modalMode === "add" ? "Add" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete != null}
        tone="danger"
        title="Delete slave?"
        description={
          confirmDelete ? (
            <>
              This will remove <span className="font-semibold text-emerald-700 dark:text-emerald-300">{confirmDelete.name}</span>
              <div>Unit ID: <span className="font-semibold text-emerald-700 dark:text-emerald-300">{confirmDelete.unitId}</span></div>
            </>
          ) : null
        }
        error={deleteError}
        confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
        confirmText={deletingId != null ? "Deleting..." : "Delete"}
        busy={deletingId != null}
        onClose={() => {
          if (deletingId != null) return;
          setConfirmDelete(null);
          setDeleteError(null);
        }}
        onConfirm={async () => {
          if (!confirmDelete) return;
          const ok = await remove(confirmDelete.id);
          if (ok) {
            setConfirmDelete(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}
