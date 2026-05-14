import { useEffect, useMemo, useRef, useState } from "react";
import { FiEdit2, FiPlus, FiSave, FiTrash2, FiX } from "react-icons/fi";
import ConfirmDialog from "../../../components/ConfirmDialog";
import {
  deleteAnalyzerSignal,
  upsertAnalyzerSignal,
  type AnalyzerSignal,
} from "../../api/analyzer";
import { listSlaveRegisterRows, type SlaveItem, type SlaveRegisterRow } from "../../api/slaves";
import { parseAnalyzerDecoderConfig } from "../../utils/analyzerSignalDecoder";
import { formatAnalyzerAddress, type AnalyzerAddressFormat } from "../../utils/analyzerAddressFormat";

type Props = {
  open: boolean;
  workspaceName: string;
  signals: AnalyzerSignal[];
  slaves: SlaveItem[];
  addressFormat: AnalyzerAddressFormat;
  isPollingWanted: boolean;
  nowTsMs: number;
  getSignalPollIntervalMs: (signalId: string) => number;
  onClose: () => void;
  onAfterMutation: () => Promise<void>;
  onError: (message: string) => void;
  onToast: (message: string) => void;
};

function functionCodeFromFunctionKind(kind: string | null | undefined): number {
  const k = (kind || "").trim().toLowerCase();
  if (k === "coils") return 1;
  if (k === "discrete") return 2;
  if (k === "holding") return 3;
  if (k === "input") return 4;
  return 3;
}

function functionKindFromFunctionCode(fc: number): string | null {
  switch (fc) {
    case 1:
      return "coils";
    case 2:
      return "discrete";
    case 3:
      return "holding";
    case 4:
      return "input";
    default:
      return null;
  }
}

function functionCodeLetter(fc: number): string | null {
  switch (fc) {
    case 1:
      return "CO";
    case 2:
      return "DI";
    case 3:
      return "HO";
    case 4:
      return "IN";
    default:
      return null;
  }
}

function sanitizeSignalIdPart(value: string): string {
  return (value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

function validateOptionalNumberInput(value: string): { parsed: number | null; error?: string } {
  const t = (value || "").trim();
  if (!t) return { parsed: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { parsed: null, error: "Invalid number" };
  return { parsed: n };
}

function validateOptionalNonNegativeInt(value: string, max: number | null): { parsed: number | null; error?: string } {
  const out = validateOptionalNumberInput(value);
  if (out.error) return out;
  if (out.parsed == null) return out;
  if (!Number.isInteger(out.parsed)) return { parsed: null, error: "Must be an integer" };
  if (out.parsed < 0) return { parsed: null, error: "Must be ≥ 0" };
  if (max != null && out.parsed > max) return { parsed: null, error: `Must be ≤ ${max}` };
  return { parsed: out.parsed };
}

export default function AnalyzerConfigureSignalsModal(props: Props) {
  const [mode, setMode] = useState<"view" | "add" | "edit">("view");
  const [selectedSignalId, setSelectedSignalId] = useState<string>("");

  const selectedSignal = useMemo(() => {
    const sid = selectedSignalId.trim();
    if (!sid) return null;
    return props.signals.find((s) => s.id === sid) ?? null;
  }, [props.signals, selectedSignalId]);

  const [saving, setSaving] = useState(false);
  const [registerRows, setRegisterRows] = useState<SlaveRegisterRow[]>([]);

  const [signalId, setSignalId] = useState<string>("");
  const [slaveId, setSlaveId] = useState<number | null>(null);
  const [functionCode, setFunctionCode] = useState<number>(4);
  const [registerRowId, setRegisterRowId] = useState<number | null>(null);

  const [decoderBit, setDecoderBit] = useState<string>("");
  const [decoderScale, setDecoderScale] = useState<string>("");
  const [decoderOffset, setDecoderOffset] = useState<string>("");
  const [decoderClampMin, setDecoderClampMin] = useState<string>("");
  const [decoderClampMax, setDecoderClampMax] = useState<string>("");
  const [decoderDecimals, setDecoderDecimals] = useState<string>("");
  const [decoderUnit, setDecoderUnit] = useState<string>("");

  const [signalIdToDelete, setSignalIdToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const signalIdManuallyEditedRef = useRef(false);

  const editPrefillRef = useRef<
    {
      signalId: string;
      slaveId: number;
      functionCode: number;
      registerRowId: number;
    } | null
  >(null);

  const signalToDelete = useMemo(() => {
    const sid = signalIdToDelete?.trim() ?? "";
    if (!sid) return null;
    return props.signals.find((s) => s.id === sid) ?? null;
  }, [props.signals, signalIdToDelete]);

  const slave = useMemo(() => {
    if (slaveId == null) return null;
    return props.slaves.find((s) => s.id === slaveId) ?? null;
  }, [props.slaves, slaveId]);

  const slaveById = useMemo(() => {
    const out = new Map<number, SlaveItem>();
    for (const s of props.slaves) out.set(s.id, s);
    return out;
  }, [props.slaves]);

  function deriveSignalUiState(signal: AnalyzerSignal): string {
    const baseState = String(signal.state ?? "DISCONNECTED").toUpperCase();
    if (baseState !== "OK") return baseState;

    if (!props.isPollingWanted) return baseState;

    const expectedMs = props.getSignalPollIntervalMs(signal.id);
    const staleAfterMs = Math.max(1500, Math.round(expectedMs * 2.5));
    const lastTs = signal.lastUpdatedTsMs ?? null;
    if (lastTs == null) return "DISCONNECTED";

    const age = props.nowTsMs - lastTs;
    if (Number.isFinite(age) && age > staleAfterMs) return "STALE";
    return "OK";
  }

  function normalizeSignalId(value: string): string {
    return (value || "").replace(/\s+/g, "-").trim();
  }

  const signalIdValidation = useMemo(() => {
    if (mode === "edit") return { normalized: signalId.trim(), error: null as string | null };

    const normalized = normalizeSignalId(signalId);
    if (!normalized) return { normalized, error: "Signal ID is required" };

    const exists = props.signals.some((s) => s.id.trim().toLowerCase() === normalized.toLowerCase());
    if (exists) return { normalized, error: "Signal ID already exists" };

    return { normalized, error: null as string | null };
  }, [mode, props.signals, signalId]);

  useEffect(() => {
    if (!props.open) return;
    setMode("view");
    setSelectedSignalId("");
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;

    if (mode === "add") {
      editPrefillRef.current = null;
      signalIdManuallyEditedRef.current = false;
      const firstSlaveId = props.slaves[0]?.id ?? null;
      setSlaveId(firstSlaveId);
      setFunctionCode(4);
      setRegisterRowId(null);
      setRegisterRows([]);

      setSignalId("");

      setDecoderBit("");
      setDecoderScale("");
      setDecoderOffset("");
      setDecoderClampMin("");
      setDecoderClampMax("");
      setDecoderDecimals("");
      setDecoderUnit("");

      return;
    }

    if (mode === "edit" && selectedSignal) {
      const cfg = parseAnalyzerDecoderConfig(selectedSignal.decoderJson);

      editPrefillRef.current = {
        signalId: selectedSignal.id,
        slaveId: selectedSignal.slaveId,
        functionCode: functionCodeFromFunctionKind(selectedSignal.functionKind),
        registerRowId: selectedSignal.registerRowId,
      };

      setSlaveId(selectedSignal.slaveId);
      setFunctionCode(functionCodeFromFunctionKind(selectedSignal.functionKind));
      setRegisterRowId(selectedSignal.registerRowId);

      setSignalId(selectedSignal.id);

      setDecoderBit(cfg.bit != null ? String(cfg.bit) : "");
      setDecoderScale(cfg.scale != null ? String(cfg.scale) : "");
      setDecoderOffset(cfg.offset != null ? String(cfg.offset) : "");
      setDecoderClampMin(cfg.clampMin != null ? String(cfg.clampMin) : "");
      setDecoderClampMax(cfg.clampMax != null ? String(cfg.clampMax) : "");
      setDecoderDecimals(cfg.decimals != null ? String(cfg.decimals) : "");
      setDecoderUnit(cfg.unit ?? "");

      return;
    }

    setRegisterRows([]);
    setRegisterRowId(null);
    setSlaveId(null);
    setFunctionCode(4);
  }, [mode, props.open, props.signals, props.slaves, selectedSignal]);

  const suggestedSignalId = useMemo(() => {
    if (!props.open) return null;
    if (mode !== "add") return null;
    if (slaveId == null || registerRowId == null) return null;

    const slv = props.slaves.find((s) => s.id === slaveId) ?? null;
    const unitId = slv?.unitId ?? null;
    if (unitId == null) return null;

    const row = registerRows.find((r) => r.id === registerRowId) ?? null;
    const alias = row?.alias?.trim() ?? "";
    if (!row || !alias) return null;

    const letter = functionCodeLetter(functionCode);
    if (!letter) return null;

    const aliasPart = sanitizeSignalIdPart(alias);
    if (!aliasPart) return null;

    return `${aliasPart}_${unitId}_${letter}_${row.address}`;
  }, [functionCode, mode, props.open, props.slaves, registerRowId, registerRows, slaveId]);

  const signalIdPlaceholder = useMemo(() => {
    if (!props.open) return "";
    if (mode !== "add") return "";

    const letter = functionCodeLetter(functionCode) ?? "IN";
    const slv = slaveId != null ? props.slaves.find((s) => s.id === slaveId) ?? null : null;
    const sid = slv?.unitId != null ? String(slv.unitId) : "X";
    const row = registerRowId != null ? registerRows.find((r) => r.id === registerRowId) ?? null : null;
    const addr = row ? String(row.address) : "0";

    return `e.g. name_${sid}_${letter}_${addr}`;
  }, [functionCode, mode, props.open, props.slaves, registerRowId, registerRows, slaveId]);

  useEffect(() => {
    if (!props.open) return;
    if (mode !== "add") return;
    if (signalIdManuallyEditedRef.current) return;
    if (!suggestedSignalId) {
      setSignalId("");
      return;
    }
    setSignalId(suggestedSignalId);
  }, [mode, props.open, suggestedSignalId]);

  useEffect(() => {
    if (!props.open) return;
    const sid = slaveId;
    if (sid == null) {
      setRegisterRows([]);
      setRegisterRowId(null);
      return;
    }

    const prefill = editPrefillRef.current;
    if (mode === "edit" && prefill) {
      if (sid !== prefill.slaveId || functionCode !== prefill.functionCode) {
        return;
      }
    }

    let cancelled = false;
    (async () => {
      try {
        const rows = await listSlaveRegisterRows(props.workspaceName, sid, functionCode);
        if (cancelled) return;
        setRegisterRows(rows);

        const prefillAfterLoad = editPrefillRef.current;
        setRegisterRowId((current) => {
          const first = rows[0]?.id ?? null;

          if (
            mode === "edit" &&
            prefillAfterLoad &&
            prefillAfterLoad.slaveId === sid &&
            prefillAfterLoad.functionCode === functionCode
          ) {
            const desired = prefillAfterLoad.registerRowId;
            if (rows.some((r) => r.id === desired)) {
              editPrefillRef.current = null;
              return desired;
            }
          }

          if (mode === "add") {
            if (current == null) return first;
            if (!rows.some((r) => r.id === current)) return first;
            return current;
          }

          if (mode === "edit") {
            if (current == null) return first;
            if (!rows.some((r) => r.id === current)) return first;
            if (
              prefillAfterLoad &&
              prefillAfterLoad.slaveId === sid &&
              prefillAfterLoad.functionCode === functionCode
            ) {
              editPrefillRef.current = null;
            }
            return current;
          }

          return current;
        });
      } catch (e) {
        props.onError(String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [functionCode, mode, props.onError, props.open, props.workspaceName, slaveId]);

  const decoderValidation = useMemo(() => {
    const errors: Record<string, string> = {};

    const bitV = validateOptionalNonNegativeInt(decoderBit, 63);
    if (bitV.error) errors.bit = bitV.error;

    const scaleV = validateOptionalNumberInput(decoderScale);
    if (scaleV.error) errors.scale = scaleV.error;

    const offsetV = validateOptionalNumberInput(decoderOffset);
    if (offsetV.error) errors.offset = offsetV.error;

    const clampMinV = validateOptionalNumberInput(decoderClampMin);
    if (clampMinV.error) errors.clampMin = clampMinV.error;

    const clampMaxV = validateOptionalNumberInput(decoderClampMax);
    if (clampMaxV.error) errors.clampMax = clampMaxV.error;

    const decimalsV = validateOptionalNonNegativeInt(decoderDecimals, 12);
    if (decimalsV.error) errors.decimals = decimalsV.error;

    const unit = decoderUnit.trim() ? decoderUnit.trim() : null;

    if (!errors.clampMin && !errors.clampMax && clampMinV.parsed != null && clampMaxV.parsed != null) {
      if (clampMinV.parsed > clampMaxV.parsed) {
        errors.clampMin = "Must be ≤ clamp max";
        errors.clampMax = "Must be ≥ clamp min";
      }
    }

    const ok = Object.keys(errors).length === 0;

    return {
      ok,
      errors,
      parsed: {
        bit: bitV.parsed ?? null,
        scale: scaleV.parsed ?? null,
        offset: offsetV.parsed ?? null,
        clampMin: clampMinV.parsed ?? null,
        clampMax: clampMaxV.parsed ?? null,
        decimals: decimalsV.parsed ?? null,
        unit,
      },
    };
  }, [decoderBit, decoderClampMax, decoderClampMin, decoderDecimals, decoderOffset, decoderScale, decoderUnit]);

  const registerValidation = useMemo(() => {
    const slvId = slaveId;
    const rowId = registerRowId;
    if (slvId == null || rowId == null) return { error: null as string | null };

    const row = registerRows.find((r) => r.id === rowId) ?? null;
    if (!row) return { error: null as string | null };

    const functionKind = functionKindFromFunctionCode(functionCode);
    if (!functionKind) return { error: null as string | null };

    const functionKindLc = functionKind.trim().toLowerCase();
    const addr = row.address;

    const existing =
      props.signals.find((s) => {
        if (mode === "edit" && selectedSignal && s.id === selectedSignal.id) return false;
        return (
          s.slaveId === slvId &&
          String(s.functionKind ?? "").trim().toLowerCase() === functionKindLc &&
          s.address === addr
        );
      }) ?? null;

    if (existing) {
      const unit = slaveById.get(slvId)?.unitId ?? null;
      const slaveLabel = unit != null ? `Unit ${unit}` : `Slave #${slvId}`;
      return {
        error: `Signal for "${slaveLabel} | ${functionKind} | Address ${formatAnalyzerAddress(addr, props.addressFormat)}" already exists as "${existing.id}"`,
      };
    }

    return { error: null as string | null };
  }, [functionCode, mode, props.signals, registerRowId, registerRows, selectedSignal, slaveId]);

  const canEdit = mode === "add" || mode === "edit";
  const canSave =
    canEdit &&
    !saving &&
    slaveId != null &&
    registerRowId != null &&
    Boolean(signalIdValidation.normalized) &&
    !signalIdValidation.error &&
    decoderValidation.ok &&
    !registerValidation.error;

  if (!props.open) return null;

  async function save() {
    const sid = mode === "edit" ? selectedSignal?.id ?? signalId.trim() : signalIdValidation.normalized;
    const slvId = slaveId;
    const rowId = registerRowId;
    if (!sid || slvId == null || rowId == null) return;

    const functionKind = functionKindFromFunctionCode(functionCode);
    if (!functionKind) {
      props.onError("Unsupported function code for Analyzer signals");
      return;
    }

    const hasSlave = props.slaves.some((s) => s.id === slvId);
    if (!hasSlave) {
      props.onError("Slave not found");
      return;
    }

    const { bit, scale, offset, clampMin, clampMax, decimals, unit } = decoderValidation.parsed;

    const nextCfg: Record<string, unknown> = {};
    if (bit != null) nextCfg.bit = bit;
    if (scale != null) nextCfg.scale = scale;
    if (offset != null) nextCfg.offset = offset;
    if (clampMin != null) nextCfg.clampMin = clampMin;
    if (clampMax != null) nextCfg.clampMax = clampMax;
    if (decimals != null) nextCfg.decimals = decimals;
    if (unit != null) nextCfg.unit = unit;

    setSaving(true);
    try {
      await upsertAnalyzerSignal(props.workspaceName, {
        id: sid,
        slaveId: slvId,
        functionKind,
        registerRowId: rowId,
        decoderJson: JSON.stringify(nextCfg),
      });
      await props.onAfterMutation();
      props.onToast(mode === "add" ? "Signal created" : "Signal saved");
      setMode("view");
      setSelectedSignalId(sid);
    } catch (e) {
      props.onError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!signalToDelete) return;

    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteAnalyzerSignal(props.workspaceName, signalToDelete.id);
      await props.onAfterMutation();
      props.onToast("Signal deleted");
      setSignalIdToDelete(null);

      const remaining = props.signals.filter((s) => s.id !== signalToDelete.id);
      setSelectedSignalId(remaining[0]?.id ?? "");
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  function resetEditorForm() {
    if (mode === "add") {
      const firstSlaveId = props.slaves[0]?.id ?? null;
      setSlaveId(firstSlaveId);
      setFunctionCode(4);
      setRegisterRowId(null);
      setRegisterRows([]);

      setSignalId("");

      setDecoderBit("");
      setDecoderScale("");
      setDecoderOffset("");
      setDecoderClampMin("");
      setDecoderClampMax("");
      setDecoderDecimals("");
      setDecoderUnit("");
      return;
    }

    if (mode === "edit" && selectedSignal) {
      const cfg = parseAnalyzerDecoderConfig(selectedSignal.decoderJson);

      setSlaveId(selectedSignal.slaveId);
      setFunctionCode(functionCodeFromFunctionKind(selectedSignal.functionKind));
      setRegisterRowId(selectedSignal.registerRowId);

      setSignalId(selectedSignal.id);

      setDecoderBit(cfg.bit != null ? String(cfg.bit) : "");
      setDecoderScale(cfg.scale != null ? String(cfg.scale) : "");
      setDecoderOffset(cfg.offset != null ? String(cfg.offset) : "");
      setDecoderClampMin(cfg.clampMin != null ? String(cfg.clampMin) : "");
      setDecoderClampMax(cfg.clampMax != null ? String(cfg.clampMax) : "");
      setDecoderDecimals(cfg.decimals != null ? String(cfg.decimals) : "");
      setDecoderUnit(cfg.unit ?? "");
    }
  }

  if (mode === "view") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
        <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800/70 dark:bg-slate-900/60 dark:text-slate-100">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                Signals: <span className="text-slate-900 dark:text-slate-100">{props.signals.length}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">Manage analyzer signals</div>
            </div>
            <div className="inline-flex gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:opacity-60 dark:border-emerald-500/60 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:text-slate-100"
                onClick={() => {
                  setSelectedSignalId("");
                  setMode("add");
                }}
                disabled={saving || deleting}
                title="Add signal"
              >
                <FiPlus className="h-4 w-4" aria-hidden="true" />
                Add Signal
              </button>

              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={props.onClose}
                title="Close"
                disabled={saving || deleting}
              >
                <FiX className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="max-h-[75vh] overflow-auto p-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800/70 dark:bg-slate-900">
              {props.signals.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">Add a Signal to fetch data from registers</div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {props.signals.map((s) => {
                    const stateUpper = deriveSignalUiState(s);
                    const stateDotClass =
                      stateUpper === "OK"
                        ? "bg-emerald-400"
                        : stateUpper === "ERROR"
                          ? "bg-rose-400"
                          : stateUpper === "DISCONNECTED"
                            ? "bg-slate-500"
                            : stateUpper === "STALE"
                              ? "bg-amber-400"
                              : "bg-amber-400";

                    const unit = slaveById.get(s.slaveId)?.unitId ?? null;
                    const slaveLabel = unit != null ? `Unit ${unit}` : `Slave #${s.slaveId}`;
                    const addrLabel = formatAnalyzerAddress(s.address, props.addressFormat);

                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1" title={s.id}>
                          <div className="inline-flex gap-1.5">
                            <span
                              className={`shrink-0 inline-block h-2 w-2 mt-1.5 rounded-full border border-white/10 ${stateDotClass}`}
                              title={stateUpper || "UNKNOWN"}
                              aria-label={stateUpper || "UNKNOWN"}
                            />
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{s.id}</div>
                            </div>
                          </div>
                          <div className="ml-3 flex items-center gap-1 truncate text-[11px] text-slate-600 dark:text-slate-400">
                            {slaveLabel} | {String(s.functionKind ?? "").toUpperCase() || "UNKNOWN"} | Addr {addrLabel}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                            onClick={() => {
                              setSelectedSignalId(s.id);
                              setMode("edit");
                            }}
                            disabled={saving || deleting}
                            title="Edit"
                          >
                            <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-lg border border-rose-500/60 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-800 transition hover:border-rose-500/70 hover:text-rose-900 disabled:opacity-60 dark:text-rose-100 dark:hover:border-rose-400 dark:hover:text-rose-50"
                            onClick={() => {
                              setSignalIdToDelete(s.id);
                            }}
                            disabled={saving || deleting}
                            title="Delete"
                          >
                            <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={signalIdToDelete != null}
          title="Delete signal"
          description={
            <div className="text-xs">
              Delete <span className="font-semibold text-slate-900 dark:text-slate-100">{signalToDelete?.id}</span>?
              <div className="mt-2 text-slate-600 dark:text-slate-300">This will also unlink it from any tiles that reference it.</div>
            </div>
          }
          confirmText={deleting ? "Deleting..." : "Delete"}
          cancelText="Cancel"
          tone="danger"
          busy={deleting}
          error={deleteError}
          onClose={() => {
            if (deleting) return;
            setDeleteError(null);
            setSignalIdToDelete(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800/70 dark:bg-slate-900/60 dark:text-slate-100">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">

          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {mode === "add" ? "New signal" : "Edit signal"}
            </div>
            <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">Signal definition + decoder configuration</div>
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
            onClick={() => setMode("view")}
            disabled={saving || deleting}
            title="Close"
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto p-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60">
            <div className="mt-1 grid grid-cols-1 gap-3">
              {registerValidation.error ? (
                <div className="text-xs text-rose-800 dark:text-rose-200">{registerValidation.error}</div>
              ) : null}
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Slave</div>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                    value={slaveId ?? ""}
                    onChange={(e) => setSlaveId(Number(e.currentTarget.value))}
                    disabled={!canEdit || saving || deleting || props.slaves.length === 0}
                  >
                    {props.slaves.length === 0 ? (
                      <option value="">No slaves yet</option>
                    ) : (
                      props.slaves.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (Unit {s.unitId})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Register type</div>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                    value={functionCode}
                    onChange={(e) => setFunctionCode(Number(e.currentTarget.value))}
                    disabled={!canEdit || saving || deleting || slaveId == null}
                  >
                    <option value={1}>Read Coils (0x01)</option>
                    <option value={2}>Read Discrete Inputs (0x02)</option>
                    <option value={3}>Read Holding Registers (0x03)</option>
                    <option value={4}>Read Input Registers (0x04)</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Register address</div>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                    value={registerRowId ?? ""}
                    onChange={(e) => setRegisterRowId(Number(e.currentTarget.value))}
                    disabled={!canEdit || saving || deleting || slaveId == null || registerRows.length === 0}
                  >
                    {registerRows.length === 0 ? (
                      <option value="">No register rows for this function</option>
                    ) : (
                      registerRows.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.alias?.trim() ? r.alias : `Address ${formatAnalyzerAddress(r.address, props.addressFormat)}`} · {r.dataType} [{formatAnalyzerAddress(r.address, props.addressFormat)}]
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Signal ID</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                  value={signalId}
                  onChange={(e) => {
                    const next = e.currentTarget.value;
                    if (mode === "add") signalIdManuallyEditedRef.current = true;
                    setSignalId(next);
                  }}
                  disabled={!canEdit || saving || deleting || mode === "edit"}
                  placeholder={mode === "add" ? signalIdPlaceholder : ""}
                />
                {mode === "edit" ? (
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Signal IDs are immutable (rename not supported)</div>
                ) : signalIdValidation.error ? (
                  <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">{signalIdValidation.error}</div>
                ) : null}
              </div>

              <div className="mt-2 border-t border-slate-200 dark:border-slate-700" />

              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Signal Decoder Config:</div>

              <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3">
                <div className="lg:col-span-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Unit</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={decoderUnit}
                    onChange={(e) => setDecoderUnit(e.currentTarget.value)}
                    placeholder="e.g. °C, bar, V"
                    disabled={!canEdit || saving || deleting}
                  />
                </div>

                <div className="lg:col-span-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Scale</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={decoderScale}
                    onChange={(e) => setDecoderScale(e.currentTarget.value)}
                    placeholder="e.g. 0.1"
                    disabled={!canEdit || saving || deleting}
                  />
                  {decoderValidation.errors.scale ? (
                    <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">{decoderValidation.errors.scale}</div>
                  ) : null}
                </div>

                <div className="lg:col-span-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Decimals (0-12)</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={decoderDecimals}
                    onChange={(e) => setDecoderDecimals(e.currentTarget.value)}
                    placeholder="e.g. 2"
                    disabled={!canEdit || saving || deleting}
                  />
                  {decoderValidation.errors.decimals ? (
                    <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">{decoderValidation.errors.decimals}</div>
                  ) : null}
                </div>

                <div className="lg:col-span-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Offset</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={decoderOffset}
                    onChange={(e) => setDecoderOffset(e.currentTarget.value)}
                    placeholder="Optional"
                    disabled={!canEdit || saving || deleting}
                  />
                  {decoderValidation.errors.offset ? (
                    <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">{decoderValidation.errors.offset}</div>
                  ) : null}
                </div>

                <div className="lg:col-span-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Clamp min</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={decoderClampMin}
                    onChange={(e) => setDecoderClampMin(e.currentTarget.value)}
                    placeholder="Optional"
                    disabled={!canEdit || saving || deleting}
                  />
                  {decoderValidation.errors.clampMin ? (
                    <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">{decoderValidation.errors.clampMin}</div>
                  ) : null}
                </div>

                <div className="lg:col-span-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Clamp max</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={decoderClampMax}
                    onChange={(e) => setDecoderClampMax(e.currentTarget.value)}
                    placeholder="Optional"
                    disabled={!canEdit || saving || deleting}
                  />
                  {decoderValidation.errors.clampMax ? (
                    <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">{decoderValidation.errors.clampMax}</div>
                  ) : null}
                </div>

                <div className="lg:col-span-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Bit (0-63)</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={decoderBit}
                    onChange={(e) => setDecoderBit(e.currentTarget.value)}
                    placeholder="Optional"
                    disabled={!canEdit || saving || deleting}
                  />
                  {decoderValidation.errors.bit ? (
                    <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">{decoderValidation.errors.bit}</div>
                  ) : null}
                </div>

                <div className="lg:col-span-2" />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                Poll interval: <span className="font-semibold text-slate-900 dark:text-slate-100">{slave?.pollIntervalMs ?? "—"} ms</span>
              </div>

              <div className="mt-2 flex flex-col justify-end gap-2 sm:flex-row">

                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                  onClick={() => void save()}
                  disabled={!canSave}
                  title="Save"
                >
                  <FiSave className="h-4 w-4" aria-hidden="true" />
                  {saving ? "Saving..." : "Save"}
                </button>

                <button
                  type="button"
                  className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                  onClick={() => resetEditorForm()}
                  disabled={saving || deleting || !canEdit}
                  title="Reset"
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                  onClick={() => setMode("view")}
                  disabled={saving || deleting}
                  title="Close"
                >
                  Cancel
                </button>
              </div>

              {!decoderValidation.ok ? (
                <div className="text-xs text-slate-600 dark:text-slate-400">Fix decoder validation errors to enable save.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
