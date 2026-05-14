import { FiDownload, FiTrash2, FiUpload } from "react-icons/fi";

export type RegisterRowDraft = {
  id?: number | null;
  key: string;
  address: string;
  alias: string;
  dataType: string;
  order: string;
  displayFormat: string;
  writeValue: string;
  runtimeValue: number | bigint | null;
  runtimeRawWords: number[] | null;
  runtimeStatus: "idle" | "ok" | "illegal" | "error";
  runtimeError: string | null;
  runtimeTs: number | null;
  occupiedByKey?: string | null;
  occupiedByAddress?: string | null;
};

export type RegisterRowsTableProps = {
  rows: RegisterRowDraft[];
  functionCode: number;
  canWrite: boolean;
  busy: boolean;
  addressBase: 10 | 16;
  formatValue: (row: RegisterRowDraft) => string;
  onChangeRow: (key: string, patch: Partial<RegisterRowDraft>) => void;
  onReadRow: (key: string) => void;
  onWriteRow: (key: string) => void;
  onDeleteRow: (key: string) => void;
  onOpenReadValueDetails: (key: string) => void;
};

export function RegisterRowsTable({
  rows,
  functionCode,
  canWrite,
  busy,
  addressBase,
  formatValue,
  onChangeRow,
  onReadRow,
  onWriteRow,
  onDeleteRow,
  onOpenReadValueDetails,
}: RegisterRowsTableProps) {
  const isBitFunction = functionCode === 1 || functionCode === 2 || functionCode === 5 || functionCode === 15;
  const isRegisterFunction = !isBitFunction;
  const isSingleRegisterWrite = functionCode === 6;

  const gridColsClass = canWrite
    ? "grid-cols-[repeat(7,minmax(0,1fr))_124px]"
    : "grid-cols-[repeat(6,minmax(0,1fr))_82px]";
  const gridMinWidthClass = "min-w-[1180px]";
  const gridPaddingClass = "px-4";
  const actionsWidthClass = canWrite ? "w-[124px]" : "w-[82px]";

  function wordCountForDataType(dataType: string): number {
    if (isBitFunction) return 1;
    switch (dataType) {
      case "u32":
      case "i32":
      case "f32":
        return 2;
      case "u64":
      case "i64":
      case "f64":
        return 4;
      default:
        return 1;
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/30">
      <div className="overflow-x-auto">
        <div
          className={`${gridMinWidthClass} grid gap-2 border-b border-slate-200 ${gridPaddingClass} py-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300 ${gridColsClass}`}
        >
          <div className="">Local Address</div>
          <div className="">Alias</div>
          <div className="">Data Type</div>
          <div className="" title="Ordering for multi-register values.">Byte Order</div>
          <div className="">Value Format</div>
          <div className="">Read Value</div>
          {canWrite ? <div className="">Value to Write</div> : null}
          <div className={`${actionsWidthClass} text-right`}>Actions</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-600 dark:text-slate-300">
            No saved rows yet. Click Add or use Scan &amp; Add.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {rows.map((r) => {
              const isOccupied = r.occupiedByKey != null;
              const wordCount = wordCountForDataType(r.dataType);
              const isMultiWord = wordCount > 1;
              const spanLabel = isRegisterFunction && wordCount > 1 ? `${wordCount} regs` : null;

              const rawLabel =
                r.runtimeRawWords && r.runtimeRawWords.length > 0
                  ? r.runtimeRawWords
                      .map((w) => `0x${(w & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`)
                      .join(" ")
                  : null;

              const readValueTitle = (() => {
                const parts: string[] = [];
                if (r.runtimeStatus === "error") parts.push(r.runtimeError ?? "Error");
                else if (r.runtimeStatus === "illegal") parts.push("Illegal data address");
                if (rawLabel) parts.push(`Raw: ${rawLabel}`);
                return parts.length > 0 ? parts.join("\n") : undefined;
              })();

              const valueLabel = (() => {
                return formatValue(r);
              })();

              return (
                <div
                  key={r.key}
                  className={`${gridMinWidthClass} grid items-center gap-2 ${gridPaddingClass} py-1 ${gridColsClass}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                      value={r.address}
                      onChange={(e) =>
                        onChangeRow(r.key, { address: e.currentTarget.value })
                      }
                      placeholder={addressBase === 16 ? "0x0" : "0"}
                      disabled={busy || isOccupied}
                    />
                    {spanLabel ? (
                      <span className="shrink-0 rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200" title={`This value spans ${wordCount} consecutive registers.`}>
                        {spanLabel}
                      </span>
                    ) : null}
                    {isOccupied ? (
                      <span
                        className="shrink-0 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-200"
                        title={`This row overlaps with another multi-register row starting at ${r.occupiedByAddress ?? "an earlier address"}. Delete or move this row.`}
                      >
                        Overlap
                      </span>
                    ) : null}
                  </div>

                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={r.alias}
                    onChange={(e) =>
                      onChangeRow(r.key, { alias: e.currentTarget.value })
                    }
                    placeholder="Alias"
                    disabled={busy || isOccupied}
                  />

                  <select
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                    value={r.dataType}
                    onChange={(e) => {
                      const next = e.currentTarget.value;
                      const normalized = isBitFunction ? "bool" : next;
                      const nextWordCount = wordCountForDataType(normalized);
                      const patch: Partial<RegisterRowDraft> = { dataType: normalized };
                      patch.order = (r.order || "ABCD").trim() || "ABCD";
                      if (nextWordCount <= 1) patch.order = "";
                      onChangeRow(r.key, patch);
                    }}
                    disabled={busy || isOccupied}
                  >
                    {isBitFunction ? (
                      <option value="bool">bool</option>
                    ) : isSingleRegisterWrite ? (
                      <>
                        <optgroup label="Integer · 16-bit">
                          <option value="u16">u16</option>
                          <option value="i16">i16</option>
                        </optgroup>
                      </>
                    ) : (
                      <>
                        <optgroup label="Integer · 16-bit">
                          <option value="u16">u16</option>
                          <option value="i16">i16</option>
                        </optgroup>
                        <optgroup label="Integer · 32-bit">
                          <option value="u32">u32</option>
                          <option value="i32">i32</option>
                        </optgroup>
                        <optgroup label="Integer · 64-bit">
                          <option value="u64">u64</option>
                          <option value="i64">i64</option>
                        </optgroup>
                        <optgroup label="Float">
                          <option value="f32">f32</option>
                          <option value="f64">f64</option>
                        </optgroup>
                      </>
                    )}
                  </select>

                  {isRegisterFunction && isMultiWord ? (
                    <div className="flex flex-col gap-1">
                      <select
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                        value={(r.order || "ABCD").trim() || "ABCD"}
                        onChange={(e) => onChangeRow(r.key, { order: e.currentTarget.value })}
                        disabled={busy || isOccupied}
                      >
                        <option value="ABCD">ABCD (Normal)</option>
                        <option value="BADC">BADC (Byte swap)</option>
                        {wordCount === 4 ? (
                          <>
                            <option value="CDAB">CDAB (Reverse words)</option>
                            <option value="DCBA">DCBA (Reverse words + byte swap)</option>
                            <option value="HALF_SWAP">Swap 32-bit halves</option>
                            <option value="HALF_SWAP_BS">Swap 32-bit halves + byte swap</option>
                            <option value="INTRA_HALF_SWAP">Swap words within 32-bit halves</option>
                            <option value="INTRA_HALF_SWAP_BS">Swap words within 32-bit halves + byte swap</option>
                          </>
                        ) : (
                          <>
                            <option value="CDAB">CDAB (Word swap)</option>
                            <option value="DCBA">DCBA (Word + byte swap)</option>
                          </>
                        )}
                      </select>
                    </div>
                  ) : (
                    <div
                      className="rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/20"
                      title="Not applicable for 16-bit / single-register values"
                    >
                      N/A
                    </div>
                  )}

                  <select
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                    value={r.displayFormat}
                    onChange={(e) =>
                      onChangeRow(r.key, { displayFormat: e.currentTarget.value })
                    }
                    disabled={busy || isOccupied}
                  >
                    <option value="dec">Dec</option>
                    <option value="hex">Hex</option>
                    <option value="bin">Binary</option>
                    <option value="ascii">ASCII</option>
                  </select>

                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-left text-sm font-mono transition hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/30 dark:hover:bg-slate-800/40"
                    title={readValueTitle}
                    onClick={() => onOpenReadValueDetails(r.key)}
                    disabled={busy || isOccupied}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        r.runtimeStatus === "ok"
                          ? "bg-emerald-400"
                          : r.runtimeStatus === "illegal"
                            ? "bg-amber-400"
                            : r.runtimeStatus === "error"
                              ? "bg-rose-400"
                              : "bg-slate-600"
                      }`}
                    />
                    <span
                      className={`min-w-0 truncate ${
                        r.runtimeStatus === "error"
                          ? "text-rose-700 dark:text-rose-200"
                          : r.runtimeStatus === "illegal"
                            ? "text-amber-700 dark:text-amber-200"
                            : "text-slate-900 dark:text-slate-100"
                      }`}
                    >
                      {valueLabel}
                    </span>
                  </button>

                  {canWrite ? (
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                      value={r.writeValue}
                      onChange={(e) =>
                        onChangeRow(r.key, { writeValue: e.currentTarget.value })
                      }
                      placeholder={isBitFunction ? "0/1" : "0"}
                      disabled={busy || isOccupied}
                    />
                  ) : null}

                  <div className={`${actionsWidthClass} flex items-center justify-end gap-2`}>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-slate-100 p-2 text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-600"
                      onClick={() => onReadRow(r.key)}
                      disabled={busy || isOccupied}
                      title="Read this row"
                    >
                      <FiDownload className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {canWrite ? (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-slate-100 p-2 text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-600"
                        onClick={() => onWriteRow(r.key)}
                        disabled={busy || isOccupied}
                        title="Write this row"
                      >
                        <FiUpload className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-xl border border-rose-500/40 bg-rose-500/10 px-2 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-500/60 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-200 dark:hover:border-rose-400/60 dark:hover:text-rose-100"
                      onClick={() => onDeleteRow(r.key)}
                      disabled={busy}
                      title="Delete row"
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
  );
}
