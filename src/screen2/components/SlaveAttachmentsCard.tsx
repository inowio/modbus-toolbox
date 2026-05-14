import { useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { AttachmentItem, AttachmentPreview } from "../api/attachments";
import { addSlaveAttachment, deleteSlaveAttachment, exportSlaveAttachment, listSlaveAttachments, readSlaveAttachment } from "../api/attachments";
import { FiTrash2, FiUpload, FiX } from "react-icons/fi";
import { FaRegFileArchive } from "react-icons/fa";
import { FaRegFilePdf } from "react-icons/fa6";
import {
  BsFile,
  BsFileBinary,
  BsFileCode,
  BsFileImage,
  BsFileText,
  BsFiletypeCsv,
  BsFiletypeDoc,
  BsFiletypeDocx,
  BsFiletypePpt,
  BsFiletypePptx,
  BsFiletypeXls,
  BsFiletypeXlsx,
} from "react-icons/bs";
import { LuFileVideo } from "react-icons/lu";
import { useToast } from "../../components/ToastProvider";
import { RiCloseLine } from "react-icons/ri";
import ConfirmDialog from "../../components/ConfirmDialog";
import { logEvent } from "../api/logs";

type Props = {
  workspaceName: string;
  slaveId: number | null;
};

function formatSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let idx = 0;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx += 1;
  }
  return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function iconForAttachment(ext: string) {
  const lower = ext.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(lower)) {
    return <BsFileImage className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower === "pdf") {
    return <FaRegFilePdf className="h-4 w-4" aria-hidden="true" />;
  }
  if (["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"].includes(lower)) {
    return <FaRegFileArchive className="h-4 w-4" aria-hidden="true" />;
  }
  if (["mp4", "mkv", "avi", "mov", "webm", "m4v"].includes(lower)) {
    return <LuFileVideo className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower === "csv") {
    return <BsFiletypeCsv className="h-4 w-4" aria-hidden="true" />;
  }
  if (["doc", "docm", "dotx", "dotm"].includes(lower)) {
    return <BsFiletypeDoc className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower === "docx") {
    return <BsFiletypeDocx className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower === "xlsx") {
    return <BsFiletypeXlsx className="h-4 w-4" aria-hidden="true" />;
  }
  if (["xls", "xlsm"].includes(lower)) {
    return <BsFiletypeXls className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower === "ppt") {
    return <BsFiletypePpt className="h-4 w-4" aria-hidden="true" />;
  }
  if (["pptx", "ppsx"].includes(lower)) {
    return <BsFiletypePptx className="h-4 w-4" aria-hidden="true" />;
  }
  if (
    [
      "c",
      "cpp",
      "cc",
      "h",
      "hpp",
      "rs",
      "py",
      "cs",
      "java",
      "kt",
      "kts",
      "swift",
      "go",
      "rb",
      "php",
      "js",
      "jsx",
      "ts",
      "tsx",
      "sh",
      "bash",
      "ps1",
      "sql",
    ].includes(lower)
  ) {
    return <BsFileCode className="h-4 w-4" aria-hidden="true" />;
  }
  if (
    [
      "txt",
      "md",
      "log",
      "ini",
      "cfg",
      "conf",
      "yaml",
      "yml",
      "toml",
    ].includes(lower)
  ) {
    return <BsFileText className="h-4 w-4" aria-hidden="true" />;
  }
  if (["bin", "dat", "exe", "dll", "so", "img", "iso"].includes(lower)) {
    return <BsFileBinary className="h-4 w-4" aria-hidden="true" />;
  }
  return <BsFile className="h-4 w-4" aria-hidden="true" />;
}

export default function SlaveAttachmentsCard({ workspaceName, slaveId }: Props) {
  const { pushToast } = useToast();
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewItem, setPreviewItem] = useState<AttachmentItem | null>(null);
  const [previewData, setPreviewData] = useState<AttachmentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<AttachmentItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isCompactPreview = previewData?.kind === "binary";

  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems: AttachmentItem[] = normalizedSearch
    ? items.filter((item) => {
        const name = (item.displayName || item.fileName || "").toLowerCase();
        return name.includes(normalizedSearch);
      })
    : items;

  useEffect(() => {
    if (!workspaceName || slaveId == null) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const out = await listSlaveAttachments(workspaceName, slaveId);
        if (!cancelled) setItems(out);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceName, slaveId]);

  async function handleBrowse() {
    if (!workspaceName || slaveId == null) return;
    try {
      setUploading(true);
      setError(null);
      const selection = await openDialog({ multiple: true });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      const next: AttachmentItem[] = [];
      for (const p of paths) {
        if (typeof p !== "string" || !p) continue;
        const created = await addSlaveAttachment(workspaceName, slaveId, p);
        next.push(created);
      }
      if (next.length > 0) {
        setItems((prev) => {
          const merged = [...next, ...prev];
          const seen = new Set<string>();
          return merged.filter((it) => {
            if (seen.has(it.path)) return false;
            seen.add(it.path);
            return true;
          });
        });
        setUploadModalOpen(false);

        void logEvent({
          scope: "workspace",
          level: "info",
          workspaceName,
          source: "attachments/add",
          message: `Added ${next.length} attachment(s)` ,
          detailsJson: next.map((it) => ({ fileName: it.fileName, sizeBytes: it.sizeBytes })),
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handlePreview(item: AttachmentItem) {
    if (!workspaceName || slaveId == null) return;
    try {
      setPreviewItem(item);
      setPreviewData(null);
      setPreviewing(true);
      setPreviewLoading(true);
      const data = await readSlaveAttachment(workspaceName, slaveId, item.fileName);
      setPreviewData(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDownloadCurrent() {
    if (!workspaceName || slaveId == null || !previewItem) return;
    try {
      const suggested = previewItem.displayName || previewItem.fileName;
      const target = await saveDialog({ defaultPath: suggested });
      if (!target) return;
      setPreviewLoading(true);
      await exportSlaveAttachment(workspaceName, slaveId, previewItem.fileName, target);
      setPreviewing(false);
      setPreviewItem(null);
      setPreviewData(null);
      pushToast(`Saved attachment to ${target}`);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      pushToast("Failed to save attachment", "error");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDelete(item: AttachmentItem) {
    if (!workspaceName || slaveId == null) return;
    try {
      setDeleting(true);
      await deleteSlaveAttachment(workspaceName, slaveId, item.fileName);
      setItems((prev) => prev.filter((it) => it.fileName !== item.fileName));
      setDeleteConfirmItem(null);
      pushToast("Attachment deleted");

      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName,
        source: "attachments/delete",
        message: `Deleted attachment ${item.displayName || item.fileName}`,
        detailsJson: { fileName: item.fileName, sizeBytes: item.sizeBytes },
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">Attachments: {items.length}</div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Store datasheets, wiring diagrams, code snippets and notes alongside this slave.
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 sm:mt-0">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
            onClick={() => {
              setUploadModalOpen(true);
            }}
            disabled={uploading || !workspaceName || slaveId == null}
          >
            <FiUpload className="h-4 w-4" aria-hidden="true" />
            {uploading ? "Uploading..." : "Add files"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 flex justify-end">
          <div className="relative w-full">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search attachments"
              className="w-full rounded-full border border-slate-300 bg-white px-3 py-1.5 pr-7 text-xs text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/70 focus:ring-1 focus:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/70"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-500 transition hover:text-slate-700 dark:hover:text-slate-300"
                aria-label="Clear search"
              >
                <FiX className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="text-xs text-slate-600 dark:text-slate-300">Loading attachments...</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-slate-600 dark:text-slate-300">No attachments yet. Add datasheets or notes for this slave.</div>
        ) : visibleItems.length === 0 ? (
          <div className="text-xs text-slate-600 dark:text-slate-300">No attachments match your search.</div>
        ) : (
          <div className="max-h-80 overflow-y-auto pr-1">
            <div className="flex flex-col gap-2">
              {visibleItems.map((item) => (
                <div
                  key={item.path}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      {iconForAttachment(item.ext)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{item.displayName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700 dark:bg-slate-800/80 dark:text-slate-200">
                          {item.ext || "file"}
                        </span>
                        <span>{formatSize(item.sizeBytes)}</span>
                        <span className="text-slate-400 dark:text-slate-600">•</span>
                        <span>{item.modifiedAtIso}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-emerald-600/60 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-emerald-500/60 dark:hover:text-emerald-100"
                      onClick={() => {
                        void handlePreview(item);
                      }}
                      disabled={!item.fileName}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-full border border-rose-500/60 bg-rose-500/10 p-1 text-rose-800 transition hover:border-rose-500/70 hover:text-rose-900 dark:text-rose-100 dark:hover:border-rose-400 dark:hover:text-rose-50"
                      onClick={() => {
                        setDeleteConfirmItem(item);
                      }}
                      title="Delete attachment"
                    >
                      <FiTrash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {uploadModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">Add attachments</div>
                <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  Drag files into the box below or browse from disk.
                </div>
              </div>
              <button
                type="button"
                className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
                onClick={() => {
                  if (!uploading) setUploadModalOpen(false);
                }}
                disabled={uploading}
                title="Close"
              >
                <RiCloseLine className="h-4 w-3" aria-hidden="true" />
              </button>
            </div>

            <div
              className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-center text-xs text-slate-700 transition hover:border-emerald-600/60 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:border-emerald-500/60"
              onClick={() => {
                void handleBrowse();
              }}
            >
              <FiUpload className="h-6 w-6 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
              <div className="mt-1 font-semibold text-slate-900 dark:text-slate-200">Drop files here or click to browse</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                PDF, images, and text files are best viewed via Preview in this app.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmItem ? (
        <ConfirmDialog
          open={deleteConfirmItem != null}
          tone="danger"
          title="Delete attachment"
          description={
            deleteConfirmItem ? (
              <>
                <p className="mb-2">
                  Are you sure you want to delete{" "}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">{deleteConfirmItem.displayName}</span> from this
                  workspace?
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">This action cannot be undone from this app.</p>
              </>
            ) : null
          }
          error={deleteConfirmItem ? error : null}
          confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
          confirmText={deleting ? "Deleting..." : "Delete"}
          cancelText="Cancel"
          busy={deleting}
          onClose={() => {
            if (deleting) return;
            setDeleteConfirmItem(null);
          }}
          onConfirm={() => {
            if (deleteConfirmItem) {
              void handleDelete(deleteConfirmItem);
            }
          }}
        />
      ) : null}

      {previewing && previewItem ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-2 sm:p-4">
          <div
            className={`flex w-full h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 ${
              isCompactPreview ? "max-w-xl max-h-[60vh]" : "h-[92vh] w-full"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{previewItem.displayName}</div>
                {previewData ? (
                  <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {previewData.kind === "image" && "Image preview"}
                    {previewData.kind === "pdf" && "PDF preview"}
                    {previewData.kind === "text" && "Text preview"}
                    {previewData.kind === "binary" && "Binary content"}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
                onClick={() => {
                  setPreviewing(false);
                  setPreviewItem(null);
                  setPreviewData(null);
                }}
                title="Close"
              >
                <RiCloseLine className="h-4 w-3" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-2 flex-1 overflow-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              {previewLoading || !previewData ? (
                <div className="text-xs text-slate-600 dark:text-slate-300">Loading preview...</div>
              ) : previewData.kind === "image" ? (
                <div className="flex h-full flex-col gap-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        void handleDownloadCurrent();
                      }}
                      className="inline-flex items-center rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                      disabled={previewLoading}
                    >
                      Download file
                    </button>
                  </div>
                  <img
                    src={`data:${previewData.mimeType};base64,${previewData.data}`}
                    alt={previewItem.displayName}
                    className="max-h-full w-full rounded-lg object-contain"
                  />
                </div>
              ) : previewData.kind === "pdf" ? (
                <div className="flex h-full flex-col gap-2">
                  <iframe
                    title={previewItem.displayName}
                    src={`data:${previewData.mimeType};base64,${previewData.data}`}
                    className="h-full w-full rounded-lg border-0 bg-white dark:bg-slate-950"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                    <span>
                      If the PDF appears blank, the file might not be compatible for preview. Use the button to open it in a dedicated viewer.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void handleDownloadCurrent();
                      }}
                      className="inline-flex items-center rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                      disabled={previewLoading}
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              ) : previewData.kind === "text" ? (
                <div className="flex h-full flex-col gap-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        void handleDownloadCurrent();
                      }}
                      className="inline-flex items-center rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                      disabled={previewLoading}
                    >
                      Download file
                    </button>
                  </div>
                  <pre className="max-h-full w-full overflow-auto whitespace-pre-wrap wrap-break-word text-xs text-slate-900 dark:text-slate-100">
                    {previewData.data}
                  </pre>
                </div>
              ) : (
                <div className="flex h-full flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                    <span>Preview is not available for this file type. Use Download to open it in a native app.</span>
                    <button
                      type="button"
                      onClick={() => {
                        void handleDownloadCurrent();
                      }}
                      className="inline-flex items-center rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                      disabled={previewLoading}
                    >
                      Download file
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
