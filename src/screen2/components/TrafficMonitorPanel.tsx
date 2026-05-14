import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { PiMonitorPlay } from "react-icons/pi";
import { BiStopCircle } from "react-icons/bi";
import type { TrafficEventEntry } from "../api/traffic";
import { clearTrafficEvents, listTrafficEvents } from "../api/traffic";
import { formatLocalDateTime } from "../../datetime";
import { formatBytesAsAscii } from "../utils/modbusValueCodec";
import { RiCloseLine } from "react-icons/ri";
import { LuClipboardCopy } from "react-icons/lu";
import { useToast } from "../../components/ToastProvider";
import { FiRefreshCcw } from "react-icons/fi";

export type TrafficMonitorPanelProps = {
  workspaceName: string;
  slaveId?: number | null;
  monitoring?: boolean;
  onMonitoringChange?: (value: boolean) => void;
};

type TrafficEventPushedPayload = {
  workspace: string;
  entry: TrafficEventEntry;
};

type SlaveItem = {
  id: number;
  addressOffset?: number | null;
};

const MAX_EVENTS = 500;

const TrafficMonitorPanel: FC<TrafficMonitorPanelProps> = ({ workspaceName, slaveId, monitoring: monitoringProp, onMonitoringChange }) => {

  const [events, setEvents] = useState<TrafficEventEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [internalMonitoring, setInternalMonitoring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [detailsEvent, setDetailsEvent] = useState<TrafficEventEntry | null>(null);
  const [detailsDataFormat, setDetailsDataFormat] = useState<
    "hex" | "binary" | "decimal" | "ascii" | "rawPacket"
  >("hex");
  const [addressOffset, setAddressOffset] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const monitoringRef = useRef(false);

  const lastId = useMemo(() => (events.length > 0 ? events[events.length - 1].id : 0), [events]);

  const monitoring = monitoringProp ?? internalMonitoring;
  const setMonitoring = onMonitoringChange ?? setInternalMonitoring;

  const { pushToast } = useToast();

  function formatHex(value: number, width: number): string {
    if (!Number.isFinite(value)) return "";
    const v = Math.trunc(value);
    if (v < 0) return String(v);
    return `0x${v.toString(16).toUpperCase().padStart(width, "0")}`;
  }

  function modbusFunctionLabel(functionCode: number | null | undefined): string {
    const fc = functionCode ?? null;
    if (fc == null) return "";
    switch (fc) {
      case 1:
        return "Read Coils (0x01)";
      case 2:
        return "Read Discrete Inputs (0x02)";
      case 3:
        return "Read Holding (0x03)";
      case 4:
        return "Read Input (0x04)";
      case 5:
        return "Write Single Coil (0x05)";
      case 6:
        return "Write Single Register (0x06)";
      case 15:
        return "Write Multiple Coils (0x0F)";
      case 16:
        return "Write Multiple Registers (0x10)";
      default:
        return `Function ${formatHex(fc, 2)}`;
    }
  }

  function modbusTableBase(functionCode: number | null | undefined): number | null {
    const fc = functionCode ?? null;
    if (fc == null) return null;
    if (fc === 1 || fc === 5 || fc === 15) return 0x00000;
    if (fc === 2) return 0x10000;
    if (fc === 4) return 0x30000;
    if (fc === 3 || fc === 6 || fc === 16) return 0x40000;
    return null;
  }

  function crc16Modbus(bytes: number[]): number {
    let crc = 0xffff;
    for (const b of bytes) {
      crc ^= b & 0xff;
      for (let i = 0; i < 8; i += 1) {
        const lsb = crc & 0x0001;
        crc >>= 1;
        if (lsb) {
          crc ^= 0xa001;
        }
      }
    }
    return crc & 0xffff;
  }

  function parseHexTokens(hex: string | null | undefined): string[] {
    const raw = (hex ?? "").trim();
    if (!raw) return [];
    return raw
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function parseRegisterWordsToBytes(hex: string | null | undefined): number[] {
    const tokens = parseHexTokens(hex);
    const out: number[] = [];
    for (const token of tokens) {
      const cleaned = token.replace(/^0x/i, "");
      if (!/^[0-9a-f]+$/i.test(cleaned)) continue;
      const padded = cleaned.padStart(4, "0");
      const v = Number.parseInt(padded, 16);
      if (!Number.isFinite(v)) continue;
      out.push((v >> 8) & 0xff);
      out.push(v & 0xff);
    }
    return out;
  }

  function parseByteTokensToBytes(hex: string | null | undefined): number[] {
    const tokens = parseHexTokens(hex);
    const out: number[] = [];
    for (const token of tokens) {
      const cleaned = token.replace(/^0x/i, "");
      if (!/^[0-9a-f]+$/i.test(cleaned)) continue;
      const padded = cleaned.padStart(2, "0");
      const v = Number.parseInt(padded, 16);
      if (!Number.isFinite(v)) continue;
      out.push(v & 0xff);
    }
    return out;
  }

  function formatHexDump(bytes: number[], bytesPerLine = 16): string {
    if (bytes.length === 0) return "";
    const parts = bytes.map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0"));
    const lines: string[] = [];
    for (let i = 0; i < parts.length; i += bytesPerLine) {
      lines.push(parts.slice(i, i + bytesPerLine).join(" "));
    }
    return lines.join("\n");
  }

  function buildRawPacketBytes(entry: TrafficEventEntry): number[] | null {
    const unitId = entry.unitId;
    const functionCode = entry.functionCode;
    if (unitId == null || functionCode == null) return null;

    const unit = Math.trunc(unitId);
    const fc = Math.trunc(functionCode);
    if (!(unit >= 0 && unit <= 255)) return null;
    if (!(fc >= 0 && fc <= 255)) return null;

    const packetType = entry.packetType;
    const proto = (entry.proto ?? "").toLowerCase();
    const address = entry.address != null ? Math.trunc(entry.address) : null;
    const quantity = entry.quantity != null ? Math.trunc(entry.quantity) : null;

    let pdu: number[] | null = null;

    // Read functions
    if (fc === 1 || fc === 2 || fc === 3 || fc === 4) {
      if (packetType === "request") {
        if (address == null || quantity == null) return null;
        if (!(address >= 0 && address <= 0xffff)) return null;
        if (!(quantity > 0 && quantity <= 0xffff)) return null;
        pdu = [
          fc,
          (address >> 8) & 0xff,
          address & 0xff,
          (quantity >> 8) & 0xff,
          quantity & 0xff,
        ];
      } else if (packetType === "response") {
        const dataBytes =
          fc === 3 || fc === 4
            ? parseRegisterWordsToBytes(entry.dataHex)
            : parseByteTokensToBytes(entry.dataHex);
        if (dataBytes.length === 0) return null;
        const byteCount = dataBytes.length;
        if (byteCount > 255) return null;
        pdu = [fc, byteCount & 0xff, ...dataBytes];
      } else {
        return null;
      }
    }

    // Write single register
    if (pdu == null && fc === 6) {
      if (address == null) return null;
      if (!(address >= 0 && address <= 0xffff)) return null;
      const valueBytes = parseRegisterWordsToBytes(entry.dataHex);
      if (valueBytes.length < 2) return null;
      pdu = [
        fc,
        (address >> 8) & 0xff,
        address & 0xff,
        valueBytes[0] ?? 0,
        valueBytes[1] ?? 0,
      ];
    }

    if (pdu == null) return null;

    if (proto === "rtu") {
      const adu = [unit & 0xff, ...pdu];
      const crc = crc16Modbus(adu);
      // CRC is little-endian
      adu.push(crc & 0xff, (crc >> 8) & 0xff);
      return adu;
    }

    if (proto === "tcp") {
      // MBAP header: TransactionId(2), ProtocolId(2), Length(2), UnitId(1)
      // We don't capture the true transaction-id today; use 0x0000.
      const txIdHi = 0x00;
      const txIdLo = 0x00;
      const protoHi = 0x00;
      const protoLo = 0x00;
      const length = 1 + pdu.length;
      const lenHi = (length >> 8) & 0xff;
      const lenLo = length & 0xff;
      return [txIdHi, txIdLo, protoHi, protoLo, lenHi, lenLo, unit & 0xff, ...pdu];
    }

    return null;
  }

  useEffect(() => {
    monitoringRef.current = monitoring;
  }, [monitoring]);

  useEffect(() => {
    let disposed = false;

    async function loadSlaveOffset() {
      try {
        const slaves = await invoke<SlaveItem[]>("list_slaves", {
          name: workspaceName,
        });
        if (disposed) return;

        const sid = slaveId ?? null;
        const match = sid == null ? null : slaves.find((s) => s.id === sid) ?? null;
        const nextOffset = match?.addressOffset ?? 0;
        setAddressOffset(Number.isFinite(nextOffset) ? Math.trunc(nextOffset) : 0);
      } catch {
        if (!disposed) {
          setAddressOffset(0);
        }
      }
    }

    void loadSlaveOffset();
    return () => {
      disposed = true;
    };
  }, [workspaceName, slaveId]);

  useEffect(() => {
    let disposed = false;

    async function loadInitial() {
      setLoading(true);
      setError(null);
      try {
        const rows = await listTrafficEvents(workspaceName, {
          limit: MAX_EVENTS,
        });
        if (disposed) return;
        setEvents(rows);
      } catch (e) {
        if (!disposed) {
          setError(String(e));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void loadInitial();

    return () => {
      disposed = true;
    };
  }, [workspaceName]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    (async () => {
      try {
        const ul = await listen<TrafficEventPushedPayload>("traffic_event_appended", (event) => {
          const payload = event.payload;
          if (!payload || payload.workspace !== workspaceName) return;
          if (!monitoringRef.current) return;

          const entry = payload.entry;

          setEvents((prev) => {
            if (prev.some((e) => e.id === entry.id)) {
              return prev;
            }

            const next = [...prev, entry];
            if (next.length > MAX_EVENTS) {
              return next.slice(next.length - MAX_EVENTS);
            }
            return next;
          });
        });
        if (disposed) { void ul(); } else { unlisten = ul; }
      } catch {
      }
    })();

    return () => {
      disposed = true;
      if (unlisten) {
        void unlisten();
      }
    };
  }, [workspaceName]);

  useEffect(() => {
    if (!autoFollow) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [autoFollow, events, lastId]);

  function handleScroll(e: { currentTarget: HTMLDivElement }) {
    const target = e.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    const atBottom = distanceFromBottom < 16;
    setAutoFollow(atBottom);
  }

  const hasEvents = events.length > 0;
  const selectedEvent =
    selectedIndex != null && selectedIndex >= 0 && selectedIndex < events.length
      ? events[selectedIndex]
      : null;

  function getFormattedDataItems(
    entry: TrafficEventEntry,
    format: "hex" | "binary" | "decimal" | "ascii",
  ): { address: number; value: string }[] {
    const rawHex = entry.dataHex ?? "";
    if (!rawHex.trim()) {
      return [];
    }

    const tokens = rawHex
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (tokens.length === 0) {
      return [];
    }

    const values = tokens.map((token) => {
      const v = Number.parseInt(token.replace(/^0x/i, ""), 16);
      return Number.isNaN(v) ? null : v;
    });

    const baseAddress = entry.address ?? 0;

    switch (format) {
      case "hex": {
        return tokens.map((token, index) => {
          const addr = baseAddress + index;
          const cleaned = token.replace(/^0x/i, "").toUpperCase();
          return { address: addr, value: `0x${cleaned}` };
        });
      }
      case "binary": {
        return values.map((v, index) => {
          const addr = baseAddress + index;
          const display =
            v == null ? tokens[index] : v.toString(2).padStart(16, "0");
          return { address: addr, value: display };
        });
      }
      case "decimal": {
        return values.map((v, index) => {
          const addr = baseAddress + index;
          const display = v == null ? tokens[index] : String(v);
          return { address: addr, value: display };
        });
      }
      case "ascii": {
        return tokens.map((token, index) => {
          const addr = baseAddress + index;

          const cleaned = token.replace(/^0x/i, "");
          if (!cleaned || !/^[0-9a-f]+$/i.test(cleaned)) {
            return { address: addr, value: "." };
          }

          const hex = cleaned.length % 2 === 1 ? `0${cleaned}` : cleaned;
          const bytes: number[] = [];
          for (let i = 0; i < hex.length; i += 2) {
            const byteHex = hex.slice(i, i + 2);
            const b = Number.parseInt(byteHex, 16);
            if (!Number.isFinite(b)) continue;
            bytes.push(b & 0xff);
          }

          if (bytes.length === 0) {
            return { address: addr, value: "." };
          }

          const ascii = formatBytesAsAscii(bytes);
          return { address: addr, value: ascii };
        });
      }
      default:
        return [];
    }
  }

  async function handleExport() {
    if (!hasEvents || exporting) return;
    setExportError(null);
    setExporting(true);
    try {
      const blocks = events.map((ev, index) => {
        const lines: string[] = [];

        // Numbered Time: use raw ISO from backend so it is stable and sortable
        lines.push(`[${index + 1}]\nTime: ${ev.tsIso}`);

        // Protocol
        lines.push(`Protocol: ${ev.proto.toUpperCase()}`);

        // Function line with optional FC
        const fnKind = ev.functionKind ?? "";
        const fnLine =
          ev.functionCode != null ? `${fnKind} (FC ${ev.functionCode})` : fnKind;
        lines.push(`Function: ${fnLine}`);

        // Packet type
        lines.push(`Packet type: ${ev.packetType}`);

        // Result
        const resultLabel = ev.ok
          ? "OK"
          : `Error${ev.error ? ` (${ev.error})` : ""}`;
        lines.push(`Result: ${resultLabel}`);

        // Unit line (unitId, destAddr)
        const suParts: string[] = [];
        if (ev.unitId != null) suParts.push(`unitId=${ev.unitId}`);
        if (ev.destAddr) suParts.push(`dest=${ev.destAddr}`);
        lines.push(`Unit: ${suParts.join(", ")}`);

        // Address range
        const addrParts: string[] = [];
        if (ev.address != null) addrParts.push(`addr=${ev.address}`);
        if (ev.quantity != null) addrParts.push(`qty=${ev.quantity}`);
        lines.push(`Address range: ${addrParts.join(", ")}`);

        // Duration
        lines.push(
          `Duration: ${ev.durationMs != null ? `${ev.durationMs} ms` : ""}`,
        );

        // Checksum
        lines.push(`Checksum: ${ev.checksum ?? ""}`);

        // Data size
        lines.push(
          `Data size: ${ev.dataSize != null ? `${ev.dataSize} B` : ""}`,
        );

        // Payload sections
        lines.push("Data (hex):");
        lines.push(ev.dataHex ?? "");
        lines.push("Decoded data:");
        lines.push(ev.decodedData ?? "");

        lines.push("Raw packet (hex):");
        const rawBytes = buildRawPacketBytes(ev);
        lines.push(rawBytes ? formatHexDump(rawBytes) : "");

        return lines.join("\n");
      });

      const content = blocks
        .join("\n-----------------------------------------------------------------\n")
        .concat("\n");
      const defaultName = `traffic-${workspaceName}-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.txt`;

      const filePath = await save({
        defaultPath: defaultName,
      });

      if (!filePath) {
        // user cancelled save dialog
        return;
      }

      await writeTextFile(filePath, content);
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleClear() {
    if (clearBusy) return;
    setClearError(null);
    setClearBusy(true);
    try {
      await clearTrafficEvents(workspaceName);
      setEvents([]);
    } catch (e) {
      setClearError(String(e));
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1 min-w-0 truncate font-semibold text-slate-900 dark:text-slate-200">
          {monitoring ? 
          <FiRefreshCcw className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
          Traffic monitor
          <span className="text-slate-500 dark:text-slate-400">
            {" "}
            ({monitoring ? "Monitoring" : "Stopped"}) · {hasEvents ? `${events.length} events` : "0 events"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
              monitoring
                ? "border-rose-600/60 bg-rose-500/10 text-rose-800 hover:border-rose-500 dark:border-rose-500/70 dark:bg-rose-600/20 dark:text-rose-200"
                : "border-emerald-600/60 bg-emerald-500/10 text-emerald-800 hover:border-emerald-500 dark:border-emerald-500/70 dark:bg-emerald-500/10 dark:text-emerald-200"
            }`}
            onClick={() => setMonitoring(!monitoring)}
          >
            {monitoring ? (
              <span className="inline-flex items-center gap-1">
                <BiStopCircle className="h-3 w-3" aria-hidden="true" />
                <span>Stop monitor</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <PiMonitorPlay className="h-3 w-3" aria-hidden="true" />
                <span>Start monitor</span>
              </span>
            )}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-500"
            onClick={() => void handleClear()}
            disabled={clearBusy}
            title="Clear captured traffic from the database"
          >
            {clearBusy ? "Clearing…" : "Clear"}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-500"
            onClick={() => void handleExport()}
            disabled={!hasEvents || exporting}
            title={hasEvents ? "Export captured traffic to a text file" : "No events to export"}
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
          {loading ? <span>Loading…</span> : null}
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-500"
            disabled={!selectedEvent}
            onClick={() => {
              if (selectedIndex == null) return;
              const ev = events[selectedIndex];
              if (ev) {
                setDetailsEvent(ev);
                setDetailsDataFormat("hex");
              }
            }}
            title={selectedEvent ? "Show packet details" : "Select a row to view details"}
          >
            Details
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}
      {clearError ? (
        <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-800 dark:text-rose-200">
          {clearError}
        </div>
      ) : null}
      {exportError ? (
        <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">
          {exportError}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/60"
        onScroll={handleScroll}
      >
        {!hasEvents && !loading && !error ? (
          <div className="flex flex-1 items-center justify-center px-3 py-4 text-xs text-slate-600 dark:text-slate-400">
            <div className="text-center">
              <div className="font-semibold text-slate-900 dark:text-slate-300">No traffic captured yet</div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                Modbus read / write / poll operations will appear here as traffic events.
              </div>
            </div>
          </div>
        ) : null}

        {hasEvents ? (
          <table className="min-w-full border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr className="bg-slate-100 text-slate-600 dark:bg-slate-900/80 dark:text-slate-300">
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Time</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Function</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Type</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Mode</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Protocol</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Unit</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Result</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Size</th>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-800 dark:bg-slate-900">Data / Value</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, index) => {
                const ts = new Date(ev.tsIso);
                const timeLabel = Number.isNaN(ts.getTime())
                  ? ev.tsIso
                  : ts.toLocaleTimeString(undefined, { hour12: false });

                const fnLabel =
                  ev.functionKind === "read"
                    ? "Read"
                    : ev.functionKind === "write"
                      ? "Write"
                      : ev.functionKind ?? "";
                const typeLabel =
                  ev.functionCode != null
                    ? `0x${ev.functionCode.toString(16).toUpperCase().padStart(2, "0")}`
                    : "";

                const modeLabel =
                  ev.packetType === "request"
                    ? "Request"
                    : ev.packetType === "response"
                      ? "Response"
                      : ev.packetType ?? "";

                const resultLabel = ev.ok ? "OK" : "Error";
                const resultClass = ev.ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300";

                const dataSummarySource = ev.dataHex ?? ev.decodedData ?? "";
                const dataSummary =
                  dataSummarySource.length > 80
                    ? `${dataSummarySource.slice(0, 80)}...`
                    : dataSummarySource;

                const addrSummaryParts: string[] = [];
                if (ev.address != null) {
                  addrSummaryParts.push(`start-addr=${ev.address}`);
                }
                if (ev.quantity != null) {
                  addrSummaryParts.push(`qty=${ev.quantity}`);
                }
                const addrSummary = addrSummaryParts.join(" | ");

                const isSelected = index === selectedIndex;

                return (
                  <tr
                    key={ev.id}
                    className={`border-b border-slate-200/80 hover:bg-slate-100 cursor-pointer dark:border-slate-800/60 dark:hover:bg-slate-900/60 ${
                      isSelected ? "bg-slate-100 ring-1 ring-emerald-600/30 dark:bg-slate-900/80 dark:ring-emerald-400" : ""
                    }`}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={() => setDetailsEvent(ev)}
                  >
                    <td className="px-2 py-1 align-top text-slate-600 dark:text-slate-300">{timeLabel}</td>
                    <td className="px-2 py-1 align-top text-slate-900 dark:text-slate-200">{fnLabel}</td>
                    <td className="px-2 py-1 align-top text-slate-600 dark:text-slate-300">{typeLabel}</td>
                    <td className="px-2 py-1 align-top text-slate-600 dark:text-slate-300">{modeLabel}</td>
                    <td className="px-2 py-1 align-top text-slate-600 dark:text-slate-300">{ev.proto.toUpperCase()}</td>
                    <td className="px-2 py-1 align-top text-slate-600 dark:text-slate-300">
                      {ev.destAddr ?? (ev.unitId != null ? `unit:${ev.unitId}` : "")}
                    </td>
                    <td className={`px-2 py-1 align-top font-semibold ${resultClass}`}>
                      {resultLabel}
                      {!ev.ok && ev.error ? <span className="ml-1 text-slate-500 dark:text-slate-400">({ev.error})</span> : null}
                    </td>
                    <td className="px-2 py-1 align-top text-slate-600 dark:text-slate-300">
                      {ev.dataSize != null ? `${ev.dataSize} B` : ""}
                    </td>
                    <td className="px-2 py-1 align-top text-slate-600 dark:text-slate-300">
                      {dataSummary || addrSummary}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
      {detailsEvent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-full w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-900 shadow-2xl sm:text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-400">Traffic packet details</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {modbusFunctionLabel(detailsEvent.functionCode) || detailsEvent.functionKind}
                </div>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-slate-100 px-2 py-2 text-[11px] font-semibold text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-500"
                onClick={() => setDetailsEvent(null)}
                title="Close details"
              >
                <RiCloseLine className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">General</div>
                <div className="mt-1 space-y-1 text-xs text-slate-900 dark:text-slate-200">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Time:</span> {formatLocalDateTime(detailsEvent.tsIso)}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Protocol:</span> {detailsEvent.proto.toUpperCase()}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Packet type:</span> {detailsEvent.packetType}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Result:</span> {detailsEvent.ok ? "OK" : "Error"}
                    {!detailsEvent.ok && detailsEvent.error ? ` (${detailsEvent.error})` : ""}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Duration:</span>{" "}
                    {detailsEvent.durationMs != null ? `${detailsEvent.durationMs} ms` : "-"}
                  </div>
                </div>
              </div>

              <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Destination</div>
                <div className="mt-1 space-y-1 text-xs text-slate-900 dark:text-slate-200">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Unit ID:</span>{" "}
                    {detailsEvent.unitId != null
                      ? `${detailsEvent.unitId} (${formatHex(detailsEvent.unitId, 2)})`
                      : ""}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Start Address:</span>{" "}
                    {(() => {
                      const effectiveStart = detailsEvent.address != null ? Math.trunc(detailsEvent.address) : null;
                      const qty = detailsEvent.quantity != null ? Math.trunc(detailsEvent.quantity) : null;
                      if (effectiveStart == null && qty == null) return "";

                      const start = effectiveStart == null
                        ? null
                        : effectiveStart - addressOffset;

                      const parts: string[] = [];
                      if (start != null) {
                        parts.push(`${start}`);
                      }
                      return start;
                    })()}
                    {" "}<span className="text-slate-500 dark:text-slate-400">({(() => {
                      const effectiveStart = detailsEvent.address != null ? Math.trunc(detailsEvent.address) : null;
                      const qty = detailsEvent.quantity != null ? Math.trunc(detailsEvent.quantity) : null;
                      if (effectiveStart == null && qty == null) return "";

                      const start = effectiveStart == null
                        ? null
                        : effectiveStart - addressOffset;
                      const base = modbusTableBase(detailsEvent.functionCode);
                      const tableAddress = start != null && base != null ? base + start : null;

                      const parts: string[] = [];
                      if (start != null) {
                        parts.push(`Hex: ${formatHex(start, 4)}`);
                      }
                      if (tableAddress != null) {
                        parts.push(`Absolute: ${formatHex(tableAddress, 5)}`);
                      }
                      return parts.join(" | ");
                    })()}
                    )</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Quantity:</span>{" "}
                    {(() => {
                      const effectiveStart = detailsEvent.address != null ? Math.trunc(detailsEvent.address) : null;
                      const qty = detailsEvent.quantity != null ? Math.trunc(detailsEvent.quantity) : null;
                      if (effectiveStart == null && qty == null) return "";
                      const parts: string[] = [];
                      if (qty != null) {
                        parts.push(`${qty}`);
                      }
                      return parts.join(" | ");
                    })()}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Checksum:</span> {detailsEvent.checksum ?? "-"}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Data size:</span> {detailsEvent.dataSize != null ? `${detailsEvent.dataSize} Bytes` : "-"}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex min-h-30 max-h-[50vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Data / Value
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="text-slate-500 dark:text-slate-400">Type:</span>
                  <select
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 focus:border-emerald-600 focus:outline-hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-emerald-500"
                    value={detailsDataFormat}
                    onChange={(e) => setDetailsDataFormat(e.target.value as typeof detailsDataFormat)}
                  >
                    <option value="hex">Hex</option>
                    <option value="binary">Binary</option>
                    <option value="decimal">Decimal</option>
                    <option value="ascii">ASCII string</option>
                    <option value="rawPacket">Raw packet</option>
                  </select>
                </div>
              </div>
              <div className="mt-1 flex-1 overflow-auto text-[11px] text-slate-900 dark:text-slate-200">
                {(() => {
                  if (detailsDataFormat === "rawPacket") {
                    const bytes = buildRawPacketBytes(detailsEvent);
                    if (!bytes || bytes.length === 0) {
                      return (
                        <div className="text-slate-500">
                          Raw packet not available for this event
                        </div>
                      );
                    }

                    const dump = formatHexDump(bytes);
                    return (
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-[11px] text-slate-600 dark:text-slate-400">
                            {detailsEvent.proto.toUpperCase() === "TCP" ? "MBAP TxId=0x0000" : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500"
                              onClick={() => {
                                const text = dump;
                                void (async () => {
                                  try {
                                    await navigator.clipboard.writeText(text);
                                    pushToast("Raw packet copied to clipboard");
                                  } catch {
                                    pushToast("Copy raw packet to clipboard failed");
                                  }
                                })();
                              }}
                              title="Copy raw packet to clipboard"
                            >
                              <LuClipboardCopy className="h-3 w-3" aria-hidden="true" />
                              Copy
                            </button>
                          </div>
                        </div>
                        <pre className="whitespace-pre-wrap wrap-break-word rounded-lg border border-slate-200 bg-white/60 p-2 font-mono text-[11px] text-slate-900 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-200">
                          {dump}
                        </pre>
                      </div>
                    );
                  }

                  const items = getFormattedDataItems(detailsEvent, detailsDataFormat);
                  if (items.length === 0) {
                    return <div className="text-slate-500">No data</div>;
                  }
                  return (
                    <div>
                      {items.map((item, index) => (
                        <div key={`${item.address}-${index}`} className="py-1">
                          <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                            Address {item.address}:
                          </div>
                          <div className="break-all text-slate-900 dark:text-slate-200">{item.value}</div>
                          {index < items.length - 1 ? (
                            <div className="my-2 border-b border-slate-200 dark:border-slate-800" />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default TrafficMonitorPanel;
