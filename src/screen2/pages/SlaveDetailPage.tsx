import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  FiActivity,
  FiArrowLeft,
  FiDownload,
  FiPlay,
  FiPlus,
  FiRefreshCw,
  FiSave,
  FiSearch,
  FiTool,
} from "react-icons/fi";
import type { Screen2OutletContext } from "../Screen2Layout";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useErrorToast, useToast } from "../../components/ToastProvider";
import { ConnectionCard } from "../components/ConnectionCard";
import { PollConfigCard } from "../components/PollConfigCard";
import { RegisterRowsTable, type RegisterRowDraft } from "../components/RegisterRowsTable";
import SlaveAttachmentsCard from "../components/SlaveAttachmentsCard";
import {
  ConnectionSettings as GlobalConnectionSettings,
  ConnectionSettingsForm,
  PortItem as SerialPortItem,
  normalizeConnectionSettings,
} from "../components/ConnectionSettingsForm";
import { logEvent } from "../api/logs";
import { CTRL_S } from "../../components/ShortcutKeys";
import { RiCloseLine } from "react-icons/ri";

type SlaveItem = {
  id: number;
  name: string;
  unitId: number;
  connectionKind: "serial" | "tcp" | string;
  pollIntervalMs: number;
  addressOffset: number;
  createdAt: string;
  updatedAt: string;
};

type ConnectionSettings = {
  kind: string;
  tcpHost?: string | null;
  tcpPort?: number | null;
  serialPort?: string | null;
  serialBaud?: number | null;
  serialParity?: string | null;
  serialDataBits?: number | null;
  serialStopBits?: number | null;
  unitId?: number | null;
};

type SlaveRegisterRow = {
  id: number;
  slaveId: number;
  functionCode: number;
  address: number;
  alias: string;
  dataType: string;
  order: string;
  displayFormat: string;
  writeValue?: number | null;
  updatedAt: string;
};

type SlaveRegisterRowUpsert = {
  address: number;
  alias: string;
  dataType: string;
  order: string;
  displayFormat: string;
  writeValue?: number | null;
};

type RowRuntimeStatus = "idle" | "ok" | "illegal" | "error";

type SlaveRegisterRowDraft = {
  id: number | null;
  key: string;
  address: string;
  alias: string;
  dataType: string;
  order: string;
  displayFormat: string;
  writeValue: string;
  runtimeValue: number | bigint | null;
  runtimeRawWords: number[] | null;
  runtimeStatus: RowRuntimeStatus;
  runtimeError: string | null;
  runtimeTs: number | null;
};

function humanizeSlaveError(err: unknown): string {
  const msg = String(err);
  if (/UNIQUE constraint failed:\s*slaves\.unit_id/i.test(msg)) {
    return "A slave with this Unit ID already exists in this workspace. Each slave must have a unique Unit ID.";
  }
  return msg;
}

function parseIntOrNull(raw: string, base: 10 | 16): number | null {
  if (raw.trim() === "") return null;
  const t = raw.trim();
  const negative = t.startsWith("-");
  const body = negative ? t.slice(1) : t;
  let inferredBase: 2 | 10 | 16 = base;
  let digits = body;
  if (/^0x/i.test(body)) {
    inferredBase = 16;
    digits = body.replace(/^0x/i, "");
  } else if (/^0b/i.test(body)) {
    inferredBase = 2;
    digits = body.replace(/^0b/i, "");
  }
  if (digits.trim() === "") return null;

  if (inferredBase === 16 && !/^[0-9a-f]+$/i.test(digits)) return null;
  if (inferredBase === 10 && !/^[0-9]+$/.test(digits)) return null;
  if (inferredBase === 2 && !/^[01]+$/.test(digits)) return null;

  const v = Number.parseInt(negative ? `-${digits}` : digits, inferredBase);
  if (!Number.isFinite(v)) return null;
  return Math.trunc(v);
}

function parseBigIntOrNull(raw: string, base: 10 | 16): bigint | null {
  if (raw.trim() === "") return null;
  const t = raw.trim();
  const negative = t.startsWith("-");
  const body = negative ? t.slice(1) : t;
  const inferredBase: 2 | 10 | 16 = /^0x/i.test(body)
    ? 16
    : /^0b/i.test(body)
      ? 2
      : base;
  const digits = body.replace(/^0x/i, "").replace(/^0b/i, "");
  if (digits.trim() === "") return null;
  if (inferredBase === 16 && !/^[0-9a-f]+$/i.test(digits)) return null;
  if (inferredBase === 2 && !/^[01]+$/.test(digits)) return null;
  if (inferredBase === 10 && !/^[0-9]+$/.test(digits)) return null;
  const val = BigInt(inferredBase === 16 ? `0x${digits}` : inferredBase === 2 ? `0b${digits}` : digits);
  return negative ? -val : val;
}

function parseWriteValueWithFormat(raw: string, format: string): number | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  const f = (format || "dec").toLowerCase();

  if (f === "dec") {
    return parseIntOrNull(trimmed, 10);
  }

  if (f === "hex") {
    return parseIntOrNull(trimmed, 16);
  }

  if (f === "bin") {
    let t = trimmed;
    if (/^0b/i.test(t)) t = t.slice(2);
    if (!/^[01]+$/.test(t)) return null;
    const n = Number.parseInt(t, 2);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  }

  if (f === "ascii") {
    // Support up to 2 ASCII characters packed into one 16-bit register.
    if (trimmed.length === 0 || trimmed.length > 2) return null;
    const codes = Array.from(trimmed).map((c) => c.charCodeAt(0));
    if (codes.some((c) => c < 0x20 || c > 0x7e)) return null;
    if (codes.length === 1) {
      return codes[0] & 0xffff;
    }
    return (((codes[0] ?? 0) & 0xff) << 8) | ((codes[1] ?? 0) & 0xff);
  }

  // Fallback to decimal semantics.
  return parseIntOrNull(trimmed, 10);
}

function bitCountForIntegerDataType(dataType: string): 16 | 32 | 64 | null {
  const dt = (dataType || "").trim().toLowerCase();
  if (dt === "u16" || dt === "i16") return 16;
  if (dt === "u32" || dt === "i32") return 32;
  if (dt === "u64" || dt === "i64") return 64;
  return null;
}

function bytesFromUnsignedBigIntBE(value: bigint, byteCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < byteCount; i++) {
    const shift = BigInt((byteCount - 1 - i) * 8);
    out.push(Number((value >> shift) & 0xffn));
  }
  return out;
}

function formatBytesAsAsciiCompact(bytes: number[]): string {
  return bytes
    .map((b) => {
      const v = b & 0xff;
      if (v >= 0x20 && v <= 0x7e) return String.fromCharCode(v);
      return "";
    })
    .join("");
}

function parseUnsignedBigIntFromWriteValue(
  raw: string,
  format: string,
  dataType: string,
): bigint | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  const bitCount = bitCountForIntegerDataType(dataType);
  if (bitCount == null) return null;
  const byteCount = bitCount / 8;
  const mask = (1n << BigInt(bitCount)) - 1n;
  const f = (format || "dec").toLowerCase();
  const dt = (dataType || "").trim().toLowerCase();
  const isSigned = dt.startsWith("i");
  const isUnsigned = dt.startsWith("u");

  if (f === "ascii") {
    if (trimmed.length === 0 || trimmed.length > byteCount) return null;
    const codes = Array.from(trimmed).map((c) => c.charCodeAt(0));
    if (codes.some((c) => c < 0x20 || c > 0x7e)) return null;
    const bytes = new Array<number>(byteCount).fill(0);
    const start = byteCount - codes.length;
    for (let i = 0; i < codes.length; i++) {
      bytes[start + i] = (codes[i] ?? 0) & 0xff;
    }
    return bigintFromBytesBE(bytes) & mask;
  }

  if (f === "hex") {
    const bi = parseBigIntOrNull(trimmed, 16);
    if (bi == null) return null;
    if (bi < 0n) return null;
    if (bi > mask) return null;
    return bi;
  }

  if (f === "bin") {
    let t = trimmed;
    if (/^0b/i.test(t)) t = t.slice(2);
    if (!/^[01]+$/.test(t)) return null;
    const bi = BigInt(`0b${t}`);
    if (bi > mask) return null;
    return bi;
  }

  if (f === "dec") {
    const bi = parseBigIntOrNull(trimmed, 10);
    if (bi == null) return null;

    if (isUnsigned && (bi < 0n || bi > mask)) return null;
    if (isSigned) {
      const min = -(1n << BigInt(bitCount - 1));
      const max = (1n << BigInt(bitCount - 1)) - 1n;
      const okSigned = bi >= min && bi <= max;
      const okTwoComp = bi >= 0n && bi <= mask;
      if (!okSigned && !okTwoComp) return null;
    }

    return bi & mask;
  }

  return null;
}

function formatWriteValueIntegerWithFormat(
  value: number,
  dataType: string,
  format: string,
): string {
  const bitCount = bitCountForIntegerDataType(dataType);
  if (bitCount == null) return String(value);
  const mask = (1n << BigInt(bitCount)) - 1n;
  const dt = (dataType || "").trim().toLowerCase();
  const isSigned = dt.startsWith("i");
  const f = (format || "dec").toLowerCase();

  const unsigned = (BigInt(Math.trunc(value)) & mask) & mask;

  if (f === "hex") {
    return `0x${unsigned.toString(16).toUpperCase()}`;
  }

  if (f === "bin") {
    return `0b${unsigned.toString(2).padStart(bitCount, "0")}`;
  }

  if (f === "ascii") {
    const bytes = bytesFromUnsignedBigIntBE(unsigned, bitCount / 8);
    return formatBytesAsAsciiCompact(bytes);
  }

  if (!isSigned) return unsigned.toString(10);
  const signBit = 1n << BigInt(bitCount - 1);
  const signed = (unsigned & signBit) !== 0n ? unsigned - (1n << BigInt(bitCount)) : unsigned;
  return signed.toString(10);
}

function formatWriteValueWithFormat(value: number, format: string): string {
  const v16 = Number(value) & 0xffff;
  const f = (format || "dec").toLowerCase();

  if (f === "hex") {
    return `0x${v16.toString(16).toUpperCase()}`;
  }

  if (f === "bin") {
    return `0b${v16.toString(2).padStart(16, "0")}`;
  }

  if (f === "ascii") {
    const hi = (v16 >> 8) & 0xff;
    const lo = v16 & 0xff;
    const chars: string[] = [];
    if (hi >= 0x20 && hi <= 0x7e) chars.push(String.fromCharCode(hi));
    if (lo >= 0x20 && lo <= 0x7e) chars.push(String.fromCharCode(lo));
    return chars.join("");
  }

  return String(v16);
}

function isIllegalDataAddressError(err: unknown): boolean {
  return /illegal data (address|value)/i.test(String(err));
}

function functionCodeLabel(fc: number): string {
  switch (fc) {
    case 1:
      return "Read Coils (0x01)";
    case 2:
      return "Read Discrete Inputs (0x02)";
    case 3:
      return "Read Holding Registers (0x03)";
    case 4:
      return "Read Input Registers (0x04)";
    case 5:
      return "Write Single Coil (0x05)";
    case 6:
      return "Write Single Register (0x06)";
    case 15:
      return "Write Multiple Coils (0x0F)";
    case 16:
      return "Write Multiple Registers (0x10)";
    default:
      return `Function ${fc}`;
  }
}

function defaultDataTypeForFunctionCode(fc: number): string {
  if (fc === 1 || fc === 2 || fc === 5 || fc === 15) return "bool";
  return "u16";
}

function supportsFunctionCodeForConnection(fc: number, connKind: string | undefined | null): boolean {
  if (connKind !== "serial" && connKind !== "tcp") return false;
  switch (fc) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 15:
    case 16:
      return true;
    default:
      return false;
  }
}

function effectiveReadFunctionCode(fc: number): number {
  if (fc === 5 || fc === 15) return 1;
  if (fc === 6 || fc === 16) return 3;
  return fc;
}

function newRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function wordCountForDataType(fc: number, dataType: string): number {
  if (fc === 1 || fc === 2 || fc === 5 || fc === 15) return 1;
  if (dataType === "u32" || dataType === "i32" || dataType === "f32") return 2;
  if (dataType === "u64" || dataType === "i64" || dataType === "f64") return 4;
  return 1;
}

function bytesFromWordsU16BE(words: number[]): number[] {
  const bytes: number[] = [];
  for (const w of words) {
    const v = w & 0xffff;
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function wordsFromBytesU16BE(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out.push((((bytes[i] ?? 0) & 0xff) << 8) | ((bytes[i + 1] ?? 0) & 0xff));
  }
  return out;
}

function encodeWriteWordsInAddressOrder(
  dataType: string,
  order: string,
  raw: string,
): { words: number[] } | { error: string } {
  const dt = (dataType || "u16").trim();
  const o = normalizeOrder(order);

  const encodeBytes = (): number[] | null => {
    if (dt === "u16" || dt === "i16") {
      const n = parseIntOrNull(raw, 10);
      if (n == null) return null;
      if (dt === "u16") {
        if (n < 0 || n > 0xffff) return null;
        const w = n & 0xffff;
        return [(w >> 8) & 0xff, w & 0xff];
      }

      // i16: accept either signed decimal range, or explicit two's complement range 0..65535.
      const okSigned = n >= -0x8000 && n <= 0x7fff;
      const okTwoComp = n >= 0 && n <= 0xffff;
      if (!okSigned && !okTwoComp) return null;
      const w = n & 0xffff;
      return [(w >> 8) & 0xff, w & 0xff];
    }

    if (dt === "u32" || dt === "i32") {
      const n = parseIntOrNull(raw, 10);
      if (n == null) return null;
      if (dt === "u32" && (n < 0 || n > 0xffff_ffff)) return null;
      if (dt === "i32" && !(n >= -0x8000_0000 && n <= 0x7fff_ffff) && !(n >= 0 && n <= 0xffff_ffff)) return null;
      const u32 = n >>> 0;
      return [(u32 >>> 24) & 0xff, (u32 >>> 16) & 0xff, (u32 >>> 8) & 0xff, u32 & 0xff];
    }

    if (dt === "f32") {
      const f = Number.parseFloat(raw.trim());
      if (!Number.isFinite(f)) return null;
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      view.setFloat32(0, f, false);
      return Array.from(new Uint8Array(buf));
    }

    if (dt === "u64" || dt === "i64") {
      const bi = parseBigIntOrNull(raw, 10);
      if (bi == null) return null;
      const u64max = (1n << 64n) - 1n;
      const i64min = -(1n << 63n);
      const i64max = (1n << 63n) - 1n;

      if (dt === "u64") {
        if (bi < 0n || bi > u64max) return null;
      } else {
        const okSigned = bi >= i64min && bi <= i64max;
        const okTwoComp = bi >= 0n && bi <= u64max;
        if (!okSigned && !okTwoComp) return null;
      }

      const asU64 = dt === "i64" ? (bi & u64max) : bi;
      const bytes: number[] = [];
      for (let shift = 56n; shift >= 0n; shift -= 8n) {
        bytes.push(Number((asU64 >> shift) & 0xffn));
      }
      return bytes;
    }

    if (dt === "f64") {
      const f = Number.parseFloat(raw.trim());
      if (!Number.isFinite(f)) return null;
      const buf = new ArrayBuffer(8);
      const view = new DataView(buf);
      view.setFloat64(0, f, false);
      return Array.from(new Uint8Array(buf));
    }

    return null;
  };

  const bytes = encodeBytes();
  if (!bytes) return { error: `Invalid value for ${dt}` };

  const wc = dt === "u64" || dt === "i64" || dt === "f64" ? 4 : dt === "u32" || dt === "i32" || dt === "f32" ? 2 : 1;
  const finalWords = wordsFromBytesU16BE(bytes);
  if (finalWords.length !== wc) return { error: `Invalid value for ${dt}` };

  const byteSwap = isByteSwapOrder(o);
  const orderedWords = byteSwap ? finalWords.map((w) => applyByteSwapWord(w)) : finalWords;
  const wordsInAddressOrder = applyOrderWords(orderedWords, o);

  return { words: wordsInAddressOrder.map((w) => w & 0xffff) };
}

function applyByteSwapWord(word: number): number {
  const w = word & 0xffff;
  return ((w & 0xff) << 8) | ((w >> 8) & 0xff);
}

const KNOWN_ORDERS = new Set<string>([
  "ABCD",
  "BADC",
  "CDAB",
  "DCBA",
  "HALF_SWAP",
  "HALF_SWAP_BS",
  "INTRA_HALF_SWAP",
  "INTRA_HALF_SWAP_BS",
]);

function normalizeOrder(order: string): string {
  const o = (order || "ABCD").trim().toUpperCase() || "ABCD";
  return KNOWN_ORDERS.has(o) ? o : "ABCD";
}

function isByteSwapOrder(order: string): boolean {
  const o = normalizeOrder(order);
  return o === "BADC" || o === "DCBA" || o === "HALF_SWAP_BS" || o === "INTRA_HALF_SWAP_BS";
}

function applyOrderWords(words: number[], order: string): number[] {
  const w = words.map((x) => x & 0xffff);
  const o = normalizeOrder(order);
  if (w.length === 2) {
    if (o === "CDAB" || o === "DCBA") return [w[1] ?? 0, w[0] ?? 0];
    return [w[0] ?? 0, w[1] ?? 0];
  }
  if (w.length === 4) {
    if (o === "CDAB" || o === "DCBA") {
      return [w[3] ?? 0, w[2] ?? 0, w[1] ?? 0, w[0] ?? 0];
    }
    if (o === "HALF_SWAP" || o === "HALF_SWAP_BS") {
      return [w[2] ?? 0, w[3] ?? 0, w[0] ?? 0, w[1] ?? 0];
    }
    if (o === "INTRA_HALF_SWAP" || o === "INTRA_HALF_SWAP_BS") {
      return [w[1] ?? 0, w[0] ?? 0, w[3] ?? 0, w[2] ?? 0];
    }
    return [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0, w[3] ?? 0];
  }
  return w;
}

function decodeU32FromBytesBE(bytes: number[]): number {
  if (bytes.length !== 4) return NaN;
  return (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>> 0;
}

function decodeF32FromBytesBE(bytes: number[]): number {
  if (bytes.length !== 4) return NaN;
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  bytes.forEach((b, i) => view.setUint8(i, b & 0xff));
  return view.getFloat32(0, false);
}

function decodeU64FromBytesBE(bytes: number[]): bigint | null {
  if (bytes.length !== 8) return null;
  let out = 0n;
  for (const b of bytes) {
    out = (out << 8n) | BigInt(b & 0xff);
  }
  return out;
}

function decodeF64FromBytesBE(bytes: number[]): number {
  if (bytes.length !== 8) return NaN;
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  bytes.forEach((b, i) => view.setUint8(i, b & 0xff));
  return view.getFloat64(0, false);
}

function parseFloatFromWriteValue(raw: string, format: string, dataType: string): number | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  const f = (format || "dec").toLowerCase();
  const dt = (dataType || "").trim().toLowerCase();
  const byteCount = dt === "f64" ? 8 : dt === "f32" ? 4 : null;
  if (byteCount == null) return null;

  if (f === "dec") {
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  if (f === "hex") {
    let t = trimmed;
    if (/^0x/i.test(t)) t = t.slice(2);
    if (!/^[0-9a-f]+$/i.test(t)) return null;
    if (t.length > byteCount * 2) return null;
    t = t.padStart(byteCount * 2, "0");

    const bytes: number[] = [];
    for (let i = 0; i < t.length; i += 2) {
      const b = Number.parseInt(t.slice(i, i + 2), 16);
      if (!Number.isFinite(b)) return null;
      bytes.push(b & 0xff);
    }

    const n = dt === "f64" ? decodeF64FromBytesBE(bytes) : decodeF32FromBytesBE(bytes);
    return Number.isFinite(n) ? n : null;
  }

  if (f === "bin") {
    let t = trimmed;
    if (/^0b/i.test(t)) t = t.slice(2);
    if (!/^[01]+$/.test(t)) return null;
    if (t.length > byteCount * 8) return null;
    t = t.padStart(byteCount * 8, "0");

    if (dt === "f32") {
      const u32 = Number.parseInt(t, 2) >>> 0;
      const bytes = [(u32 >>> 24) & 0xff, (u32 >>> 16) & 0xff, (u32 >>> 8) & 0xff, u32 & 0xff];
      const n = decodeF32FromBytesBE(bytes);
      return Number.isFinite(n) ? n : null;
    }

    const bi = BigInt(`0b${t}`);
    const bytes = bytesFromUnsignedBigIntBE(bi, 8);
    const n = decodeF64FromBytesBE(bytes);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function bytesForRowValue(
  fc: number,
  row: {
    dataType: string;
    order: string;
    runtimeRawWords: number[] | null;
  },
): number[] | null {
  const wc = wordCountForDataType(fc, row.dataType);
  const words = (row.runtimeRawWords ?? []).slice(0, wc);
  if (words.length !== wc) return null;

  if (fc === 1 || fc === 2 || fc === 5 || fc === 15) {
    // Bit functions are bit-addressable. In this UI we store 1 bit per address (0/1).
    // For raw byte display, return a single byte (0x00 or 0x01) rather than a fake 16-bit word.
    return [(words[0] ?? 0) & 0xff];
  }

  if (wc <= 1) return bytesFromWordsU16BE(words);

  const o = normalizeOrder(row.order);
  const orderedWords = applyOrderWords(words, o);
  const byteSwap = isByteSwapOrder(o);
  const finalWords = byteSwap ? orderedWords.map((w) => applyByteSwapWord(w)) : orderedWords;
  return bytesFromWordsU16BE(finalWords);
}

function formatBytesAsAscii(bytes: number[]): string {
  return bytes
    .map((b) => {
      const v = b & 0xff;
      if (v >= 0x20 && v <= 0x7e) return String.fromCharCode(v);
      return ".";
    })
    .join("");
}

function formatBits(value: bigint, bitCount: number): string {
  const mask = (1n << BigInt(bitCount)) - 1n;
  const v = value & mask;
  return `0b${v.toString(2).padStart(bitCount, "0")}`;
}

function hexFromBytesBE(bytes: number[]): string {
  return bytes
    .map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0"))
    .join("");
}

function bigintFromBytesBE(bytes: number[]): bigint {
  let out = 0n;
  for (const b of bytes) {
    out = (out << 8n) | BigInt(b & 0xff);
  }
  return out;
}

function formatValueTyped(v: number | bigint, fmt: string, dataType: string): string {
  if (v == null) return "NA";
  if (typeof v === "number" && !Number.isFinite(v)) return "NA";
  if (dataType === "u16" || dataType === "i16") {
    const n = Number(v) & 0xffff;
    if (dataType === "i16") {
      const asI16 = n >= 0x8000 ? n - 0x10000 : n;
      if (fmt === "hex") return `0x${(asI16 & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
      return String(asI16);
    }
    if (fmt === "hex") return `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
    return String(n);
  }

  if (dataType === "u32" || dataType === "i32") {
    const u32 = (Number(v) >>> 0);
    if (dataType === "i32") {
      const asI32 = u32 >= 0x80000000 ? u32 - 0x100000000 : u32;
      if (fmt === "hex") return `0x${(asI32 >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
      return String(asI32);
    }
    if (fmt === "hex") return `0x${u32.toString(16).toUpperCase().padStart(8, "0")}`;
    return String(u32);
  }

  if (dataType === "f32") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "NA";
    if (fmt === "hex" || fmt === "bin") {
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      view.setFloat32(0, n, false);
      const bytes = Array.from(new Uint8Array(buf));
      if (fmt === "hex") return `0x${hexFromBytesBE(bytes)}`;
      const u32 = view.getUint32(0, false) >>> 0;
      return `0b${u32.toString(2).padStart(32, "0")}`;
    }
    return String(n);
  }

  if (dataType === "u64" || dataType === "i64") {
    if (typeof v === "number") {
      if (!Number.isFinite(v) || !Number.isInteger(v)) return "NA";
    }
    const u = typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v)));
    if (dataType === "i64") {
      const neg = (u & (1n << 63n)) !== 0n;
      const asI64 = neg ? u - (1n << 64n) : u;
      if (fmt === "hex") return `0x${(asI64 < 0n ? (asI64 + (1n << 64n)) : asI64).toString(16).toUpperCase().padStart(16, "0")}`;
      return asI64.toString();
    }
    if (fmt === "hex") return `0x${u.toString(16).toUpperCase().padStart(16, "0")}`;
    return u.toString();
  }

  if (dataType === "f64") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "NA";
    if (fmt === "hex" || fmt === "bin") {
      const buf = new ArrayBuffer(8);
      const view = new DataView(buf);
      view.setFloat64(0, n, false);
      const bytes = Array.from(new Uint8Array(buf));
      if (fmt === "hex") return `0x${hexFromBytesBE(bytes)}`;
      const bi = bigintFromBytesBE(bytes);
      return `0b${bi.toString(2).padStart(64, "0")}`;
    }
    return String(n);
  }

  if (fmt === "hex") return `0x${v.toString(16).toUpperCase()}`;
  return String(v);
}

function formatAddress(v: number, base: 10 | 16): string {
  if (base === 16) return `0x${v.toString(16).toUpperCase()}`;
  return String(v);
}

function rowsSignature(rows: SlaveRegisterRowDraft[], base: 10 | 16): string {
  const normalized = rows
    .map((r) => {
      const addr = parseIntOrNull(r.address, base);
      return {
        address: addr == null ? r.address.trim() : addr,
        alias: r.alias,
        dataType: r.dataType,
        order: r.order,
        displayFormat: r.displayFormat,
        writeValue: r.writeValue,
      };
    })
    .sort((a, b) => {
      const aNum = typeof a.address === "number" ? a.address : Number.POSITIVE_INFINITY;
      const bNum = typeof b.address === "number" ? b.address : Number.POSITIVE_INFINITY;
      if (aNum !== bNum) return aNum - bNum;
      return String(a.address).localeCompare(String(b.address));
    });
  return JSON.stringify(normalized);
}

export default function SlaveDetailPage() {
  const { workspace, setHasUnsavedChanges, setInspectorContext } = useOutletContext<Screen2OutletContext>();
  const navigate = useNavigate();
  const params = useParams();

  const { pushToast } = useToast();

  const slaveId = Number(params.slaveId ?? "");
  const slaveIdValid = Number.isFinite(slaveId) && slaveId > 0;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slave, setSlave] = useState<SlaveItem | null>(null);
  const [conn, setConn] = useState<ConnectionSettings | null>(null);

  const [slaveAddress, setSlaveAddress] = useState<string>("");
  const [initialSlaveAddress, setInitialSlaveAddress] = useState<string>("");
  const [savingSlaveAddress, setSavingSlaveAddress] = useState(false);

  const [baseAddress, setBaseAddress] = useState<"0" | "1">("0");
  const [initialBaseAddress, setInitialBaseAddress] = useState<"0" | "1">("0");
  const [savingBaseAddress, setSavingBaseAddress] = useState(false);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [addressBase, setAddressBase] = useState<10 | 16>(10);

  const [selectedFunctionCode, setSelectedFunctionCode] = useState<number>(4);
  const [registerRows, setRegisterRows] = useState<SlaveRegisterRowDraft[]>([]);
  const registerRowsRef = useRef<SlaveRegisterRowDraft[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [savingRows, setSavingRows] = useState(false);
  const [readingRows, setReadingRows] = useState(false);
  const [writingRows, setWritingRows] = useState(false);

  const [readAfterWrite, setReadAfterWrite] = useState(true);

  const [savedRowsSig, setSavedRowsSig] = useState<string>("");

  const [pollIntervalMs, setPollIntervalMs] = useState<string>("1000");
  const [initialPollIntervalMs, setInitialPollIntervalMs] = useState<string>("1000");
  const [savingPollInterval, setSavingPollInterval] = useState(false);

  const currentRowsSig = rowsSignature(registerRows, addressBase);
  const hasUnsavedChanges = savedRowsSig !== "" && currentRowsSig !== savedRowsSig;

  const isSlaveAddressDirty = slave != null && slaveAddress.trim() !== initialSlaveAddress.trim();
  const isPollIntervalDirty = slave != null && pollIntervalMs.trim() !== initialPollIntervalMs.trim();
  const isBaseAddressDirty = slave != null && baseAddress !== initialBaseAddress;
  const hasPageUnsaved = isSlaveAddressDirty || isPollIntervalDirty || isBaseAddressDirty || hasUnsavedChanges;

  const [scanStartAddress, setScanStartAddress] = useState<string>("0");
  const [scanQuantity, setScanQuantity] = useState<string>("100");
  const [scanStopAfterConsecutiveIllegal, setScanStopAfterConsecutiveIllegal] = useState<string>("50");
  const [scanningRows, setScanningRows] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);

  const [maskWriteAddress, setMaskWriteAddress] = useState<string>("");
  const [maskWriteAndMask, setMaskWriteAndMask] = useState<string>("");
  const [maskWriteOrMask, setMaskWriteOrMask] = useState<string>("");
  const [maskWriting, setMaskWriting] = useState(false);
  const [maskWriteVisible, setMaskWriteVisible] = useState(false);

  const [leaveModalOpen, setLeaveModalOpen] = useState(false);

  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [connectionFormValue, setConnectionFormValue] = useState<GlobalConnectionSettings | null>(null);
  const [connectionSerialPorts, setConnectionSerialPorts] = useState<SerialPortItem[]>([]);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [connectionTestMessage, setConnectionTestMessage] = useState<string | null>(null);
  const [connectionTestError, setConnectionTestError] = useState<string | null>(null);

  const [pollingRows, setPollingRows] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const [pollingLastError, setPollingLastError] = useState<string | null>(null);
  const pollConsecutiveFailuresRef = useRef(0);
  const pollLastToastMsRef = useRef(0);
  const pollInFlightRef = useRef(false);

  const [readValueDetailsKey, setReadValueDetailsKey] = useState<string | null>(null);

  const runtimeSummary = (() => {
    let ok = 0;
    let illegal = 0;
    let errorCount = 0;
    let idle = 0;
    let lastTs = 0;
    for (const r of registerRows) {
      if (r.runtimeStatus === "ok") ok++;
      else if (r.runtimeStatus === "illegal") illegal++;
      else if (r.runtimeStatus === "error") errorCount++;
      else idle++;
      if (r.runtimeTs != null && r.runtimeTs > lastTs) lastTs = r.runtimeTs;
    }
    const ageSec = lastTs > 0 ? Math.max(0, Math.floor((Date.now() - lastTs) / 1000)) : null;
    const ageLabel =
      ageSec == null
        ? "—"
        : ageSec < 60
          ? `${ageSec}s`
          : ageSec < 60 * 60
            ? `${Math.floor(ageSec / 60)}m`
            : `${Math.floor(ageSec / 3600)}h`;
    return { ok, illegal, error: errorCount, idle, lastTs, ageLabel };
  })();

  const readValueDetailsRow =
    readValueDetailsKey != null
      ? registerRows.find((r) => r.key === readValueDetailsKey) ?? null
      : null;

  const readValueDetails = (() => {
    if (!readValueDetailsRow) return null;

    const wc = wordCountForDataType(selectedFunctionCode, readValueDetailsRow.dataType);

    const words = readValueDetailsRow.runtimeRawWords ?? [];
    const rawWordsLabel =
      words.length > 0
        ? words
            .map((w) => `0x${(w & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`)
            .join(" ")
        : "—";

    const bytesOrdered = bytesForRowValue(selectedFunctionCode, readValueDetailsRow) ?? [];

    const bytesLabel =
      bytesOrdered.length > 0
        ? bytesOrdered
            .map((b) => `0x${(b & 0xff).toString(16).toUpperCase().padStart(2, "0")}`)
            .join(" ")
        : "—";

    const decodedLabel = formatValueForRow(readValueDetailsRow);

    const decodeLine =
      wc > 1
        ? `${readValueDetailsRow.dataType.toUpperCase()} ${readValueDetailsRow.order} = ${decodedLabel}`
        : `${readValueDetailsRow.dataType.toUpperCase()} = ${decodedLabel}`;

    return {
      rawWordsLabel,
      bytesLabel,
      decodeLine,
    };
  })();

  function computeOccupancyInfo(rows: SlaveRegisterRowDraft[]): {
    occupiedByKeyByAddress: Map<number, { key: string; addressLabel: string }>;
    overlaps: Array<{ rowKey: string; rowAddressLabel: string; occupiedByAddressLabel: string }>;
  } {
    const occupiedByKeyByAddress = new Map<number, { key: string; addressLabel: string }>();
    const overlaps: Array<{ rowKey: string; rowAddressLabel: string; occupiedByAddressLabel: string }> = [];

    const addrEntries: Array<{ key: string; addr: number; addrLabel: string; wc: number }> = [];
    for (const r of rows) {
      const addr = parseIntOrNull(r.address, addressBase);
      if (addr == null || addr < 0) continue;
      const wc = wordCountForDataType(selectedFunctionCode, r.dataType);
      addrEntries.push({ key: r.key, addr, addrLabel: formatAddress(addr, addressBase), wc });
    }
    addrEntries.sort((a, b) => a.addr - b.addr);

    for (const e of addrEntries) {
      const already = occupiedByKeyByAddress.get(e.addr);
      if (already && already.key !== e.key) {
        overlaps.push({ rowKey: e.key, rowAddressLabel: e.addrLabel, occupiedByAddressLabel: already.addressLabel });
        continue;
      }

      if (e.wc <= 1) continue;
      for (let i = 1; i < e.wc; i++) {
        const a = e.addr + i;
        if (!occupiedByKeyByAddress.has(a)) {
          occupiedByKeyByAddress.set(a, { key: e.key, addressLabel: e.addrLabel });
        }
      }
    }

    return { occupiedByKeyByAddress, overlaps };
  }

  const occupancyInfo = computeOccupancyInfo(registerRows);

  const rowsForTable: Array<SlaveRegisterRowDraft & { occupiedByKey?: string | null; occupiedByAddress?: string | null }> =
    registerRows.map((r) => {
      const addr = parseIntOrNull(r.address, addressBase);
      if (addr == null || addr < 0) return r;
      const occ = occupancyInfo.occupiedByKeyByAddress.get(addr);
      if (!occ) return r;
      if (occ.key === r.key) return r;
      return {
        ...r,
        occupiedByKey: occ.key,
        occupiedByAddress: occ.addressLabel,
      };
    });

  function validateNoOverlapsOrThrow(onlyKeys?: string[]) {
    if (occupancyInfo.overlaps.length === 0) return;
    if (onlyKeys && onlyKeys.length > 0) {
      const onlyKeysSet = new Set(onlyKeys);
      const first = occupancyInfo.overlaps.find((o) => onlyKeysSet.has(o.rowKey));
      if (!first) return;
      throw new Error(
        `Overlapping row: address ${first.rowAddressLabel} overlaps a multi-register value starting at ${first.occupiedByAddressLabel}. Delete or move the overlapping row(s).`,
      );
    }

    const first = occupancyInfo.overlaps[0];
    throw new Error(
      `Overlapping rows: address ${first.rowAddressLabel} overlaps a multi-register value starting at ${first.occupiedByAddressLabel}. Delete or move the overlapping row(s).`,
    );
  }

  function formatValueForRow(row: RegisterRowDraft): string {
    if (row.runtimeStatus === "illegal") return "Illegal";
    if (row.runtimeStatus === "error") return "Error";
    if (row.runtimeStatus !== "ok") return "NA";
    if (row.runtimeValue == null) return "NA";

    const fmt = (row.displayFormat || "dec").toLowerCase();
    if (fmt === "ascii") {
      const bytes = bytesForRowValue(selectedFunctionCode, row);
      if (!bytes) return "NA";
      return formatBytesAsAscii(bytes);
    }
    if (fmt === "bin") {
      const bytes = bytesForRowValue(selectedFunctionCode, row);
      if (!bytes) return "NA";
      const dt = row.dataType;
      if (dt === "f32" || dt === "u32" || dt === "i32") {
        return formatBits(bigintFromBytesBE(bytes.slice(0, 4)), 32);
      }
      if (dt === "f64" || dt === "u64" || dt === "i64") {
        return formatBits(bigintFromBytesBE(bytes.slice(0, 8)), 64);
      }
      if (dt === "u16" || dt === "i16") {
        return formatBits(bigintFromBytesBE(bytes.slice(0, 2)), 16);
      }
      return "NA";
    }

    return formatValueTyped(row.runtimeValue, row.displayFormat, row.dataType);
  }

  useErrorToast(error);
  useErrorToast(pollingLastError);

  useEffect(() => {
    registerRowsRef.current = registerRows;
  }, [registerRows]);

  useEffect(() => {
    setHasUnsavedChanges?.(hasPageUnsaved);
    return () => {
      setHasUnsavedChanges?.(false);
    };
  }, [hasPageUnsaved, setHasUnsavedChanges]);

  useEffect(() => {
    if (!setInspectorContext) return;

    if (slaveIdValid) {
      setInspectorContext({
        trafficAvailable: true,
        trafficContext: { slaveId },
      });
    } else {
      setInspectorContext({ trafficAvailable: false });
    }

    return () => {
      setInspectorContext({ trafficAvailable: false });
    };
  }, [setInspectorContext, slaveIdValid, slaveId]);

  async function loadRegisterRows(slaveIdParam: number, fc: number) {
    setLoadingRows(true);
    setError(null);
    try {
      const rows = await invoke<SlaveRegisterRow[]>("list_slave_register_rows", {
        name: workspace.name,
        slaveId: slaveIdParam,
        functionCode: fc,
      });
      const drafts: SlaveRegisterRowDraft[] = rows.map((r) => {
        const df = r.displayFormat ?? "dec";
        const dataType = r.dataType ?? defaultDataTypeForFunctionCode(fc);
        const wc = wordCountForDataType(fc, dataType);
        const isSingleU16 = wc === 1 && (dataType === "u16" || dataType === "i16");
        const isU32I32 = wc === 2 && (dataType === "u32" || dataType === "i32");
        const initialWrite =
          r.writeValue == null
            ? ""
            : isSingleU16
              ? formatWriteValueWithFormat(r.writeValue, df)
              : isU32I32
                ? formatWriteValueIntegerWithFormat(r.writeValue, dataType, df)
                : String(r.writeValue);

        return {
          id: r.id,
          key: newRowKey(),
          address: formatAddress(r.address, addressBase),
          alias: r.alias ?? "",
          dataType,
          order: (r.order ?? "ABCD").trim() || "ABCD",
          displayFormat: df,
          writeValue: initialWrite,
          runtimeValue: null,
          runtimeRawWords: null,
          runtimeStatus: "idle",
          runtimeError: null,
          runtimeTs: null,
        };
      });
      setRegisterRows(drafts);
      registerRowsRef.current = drafts;
      setSavedRowsSig(rowsSignature(drafts, addressBase));
      setPollingLastError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingRows(false);
    }
  }

  async function saveSelectedRegisterRows() {
    if (!slave) return;
    setSavingRows(true);
    setError(null);
    try {
      validateNoOverlapsOrThrow();
      const nowIso = new Date().toISOString();

      const rowsToSave = registerRowsRef.current;

      const upserts: SlaveRegisterRowUpsert[] = rowsToSave.map((r) => {
        const addr = parseIntOrNull(r.address, addressBase);
        if (addr == null || addr < 0) {
          throw new Error("All rows must have a valid non-negative address");
        }

        const wc = wordCountForDataType(selectedFunctionCode, r.dataType);
        const isSingleU16 = wc === 1 && (r.dataType === "u16" || r.dataType === "i16");
        const isU32I32 = wc === 2 && (r.dataType === "u32" || r.dataType === "i32");
        const writeV = (() => {
          if (isSingleU16) return parseWriteValueWithFormat(r.writeValue, r.displayFormat);
          if (isU32I32) {
            const unsigned = parseUnsignedBigIntFromWriteValue(r.writeValue, r.displayFormat, r.dataType);
            if (unsigned == null) return null;
            return Number(unsigned);
          }
          return parseIntOrNull(r.writeValue, 10);
        })();

        return {
          address: addr,
          alias: r.alias,
          dataType: r.dataType,
          order: (r.order || "ABCD").trim() || "ABCD",
          displayFormat: r.displayFormat,
          writeValue: writeV == null ? null : writeV,
        };
      });

      const seen = new Set<number>();
      for (const u of upserts) {
        if (seen.has(u.address)) {
          throw new Error(`Duplicate address ${u.address}. Each address must be unique.`);
        }
        seen.add(u.address);
      }

      await invoke<void>("save_slave_register_rows", {
        name: workspace.name,
        slaveId: slave.id,
        functionCode: selectedFunctionCode,
        rows: upserts,
        nowIso,
      });

      setSavedRowsSig(rowsSignature(rowsToSave, addressBase));
      setPollingLastError(null);
      pushToast("Saved", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Register configuration saved",
        detailsJson: {
          slaveId: slave.id,
          functionCode: selectedFunctionCode,
          rowCount: registerRows.length,
        },
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Failed to save register configuration",
        detailsJson: {
          slaveId: slave?.id ?? null,
          functionCode: selectedFunctionCode,
          rowCount: registerRows.length,
          error: message,
        },
      });
    } finally {
      setSavingRows(false);
    }
  }

  function addRegisterRow() {
    if (busyOrPolling) return;
    const nextRow: SlaveRegisterRowDraft = {
      id: null,
      key: newRowKey(),
      address: addressBase === 16 ? "0x0" : "0",
      alias: "",
      dataType: defaultDataTypeForFunctionCode(selectedFunctionCode),
      order: "",
      displayFormat: "dec",
      writeValue: "",
      runtimeValue: null,
      runtimeRawWords: null,
      runtimeStatus: "idle",
      runtimeError: null,
      runtimeTs: null,
    };

    const next = [...registerRowsRef.current, nextRow];
    registerRowsRef.current = next;
    setRegisterRows(next);
  }

  function deleteRegisterRow(key: string) {
    if (busyOrPolling) return;
    const next = registerRowsRef.current.filter((row) => row.key !== key);
    registerRowsRef.current = next;
    setRegisterRows(next);
  }

  async function attemptDeleteRegisterRow(key: string) {
    if (busyOrPolling) return;

    const row = registerRowsRef.current.find((r) => r.key === key) ?? null;
    if (!row) return;

    if (row.id != null) {
      try {
        const ok = await invoke<boolean>("can_delete_slave_register_row", {
          name: workspace.name,
          registerRowId: row.id,
        });
        if (!ok) {
          setError(
            "Cannot delete this register row because it is used by the Analyzer dashboard (remove dependent tiles/signals first).",
          );
          return;
        }
      } catch (e) {
        setError(String(e));
        return;
      }
    }

    deleteRegisterRow(key);
  }

  function readSingleRow(key: string) {
    const fcOverride = effectiveReadFunctionCode(selectedFunctionCode);
    void readSelectedRegisterRows({
      functionCodeOverride: fcOverride,
      onlyKeys: [key],
      reportGlobalError: false,
    });
  }

  function writeSingleRow(key: string) {
    void writeAllSelectedRows([key]);
  }

  async function readSelectedRegisterRows(opts?: {
    silent?: boolean;
    functionCodeOverride?: number;
    onlyKeys?: string[];
    reportGlobalError?: boolean;
  }) {
    if (!slave) return;

    const fc = opts?.functionCodeOverride ?? effectiveReadFunctionCode(selectedFunctionCode);
    const onlyKeysSet = opts?.onlyKeys ? new Set(opts.onlyKeys) : null;
    const scopedRows = onlyKeysSet
      ? registerRowsRef.current.filter((r) => onlyKeysSet.has(r.key))
      : registerRowsRef.current;

    const reportGlobalError = opts?.reportGlobalError ?? true;
    const reportError = (msg: string) => {
      if (opts?.silent) {
        pollConsecutiveFailuresRef.current += 1;
        setPollingLastError(msg);

        setRegisterRows((prev) =>
          prev.map((row) => {
            if (onlyKeysSet && !onlyKeysSet.has(row.key)) return row;
            const addr = parseIntOrNull(row.address, addressBase);
            if (addr == null || addr < 0) return row;
            return {
              ...row,
              runtimeStatus: "error",
              runtimeError: msg,
              runtimeTs: Date.now(),
            };
          }),
        );

        const now = Date.now();
        if (now - pollLastToastMsRef.current > 6000) {
          pollLastToastMsRef.current = now;
          pushToast(`Polling error: ${msg}`, "error");
        }

        if (pollConsecutiveFailuresRef.current >= 3) {
          stopRegisterPolling();
          pushToast("Polling stopped after repeated errors.", "error");
          void logEvent({
            scope: "workspace",
            level: "error",
            workspaceName: workspace.name,
            source: "slave_detail",
            message: "Polling stopped after repeated errors",
            detailsJson: {
              slaveId: slave.id,
              functionCode: fc,
              consecutiveFailures: pollConsecutiveFailuresRef.current,
              lastError: msg,
            },
          });
        }
        return;
      }

      if (reportGlobalError) {
        setError(msg);
      } else {
        pushToast(msg, "error");
      }
    };

    try {
      validateNoOverlapsOrThrow(opts?.onlyKeys);
    } catch (e) {
      reportError(String(e));
      return;
    }

    const unitId = parseIntOrNull(slaveAddress, 10);
    if (unitId == null || unitId < 0 || unitId > 255) {
      reportError(
        unitId == null
          ? "Slave Address (Unit ID) is required"
          : "Slave Address (Unit ID) must be a positive number",
      );
      return;
    }
    if (!supportsFunctionCodeForConnection(fc, slave?.connectionKind)) {
      const msg = `Function ${fc} is not supported for ${slave?.connectionKind ?? "this"} connection yet`;
      reportError(msg);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Read failed: unsupported function code",
        detailsJson: {
          slaveId: slave.id,
          functionCode: fc,
          connectionKind: slave?.connectionKind ?? null,
        },
      });
      return;
    }

    const parsed = scopedRows
      .map((r) => ({
        key: r.key,
        addr: parseIntOrNull(r.address, addressBase),
        dataType: r.dataType,
        order: (r.order || "ABCD").trim() || "ABCD",
      }))
      .filter((x): x is { key: string; addr: number; dataType: string; order: string } => x.addr != null && x.addr >= 0);

    const addressOffset = slave.addressOffset ?? 0;
    const minAddress = addressOffset < 0 ? -addressOffset : 0;
    const tooSmall = parsed.find((p) => p.addr < minAddress);
    if (tooSmall) {
      reportError(`Address must be >= ${minAddress} when base-address offset is ${addressOffset}`);
      return;
    }

    if (parsed.length === 0) {
      reportError("Add at least one valid address row");
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Read failed: no valid rows",
        detailsJson: {
          slaveId: slave.id,
          functionCode: fc,
        },
      });
      return;
    }

    if (!opts?.silent) {
      setReadingRows(true);
      if (reportGlobalError) {
        setError(null);
      }
    }

    try {
      const kind = slave?.connectionKind ?? conn?.kind ?? "serial";
      if (kind === "serial") {
        await invoke<void>("modbus_rtu_connect", { name: workspace.name, unitId });
      } else {
        await invoke<void>("modbus_tcp_connect", { name: workspace.name, unitId });
      }
      setConnected(true);

      const addresses: number[] = [];
      for (const p of parsed) {
        const wc = wordCountForDataType(fc, p.dataType);
        for (let i = 0; i < wc; i++) {
          addresses.push(p.addr + i);
        }
      }

      const uniqueAddrs = Array.from(new Set(addresses)).sort((a, b) => a - b);
      const maxQty = fc === 3 || fc === 4 ? 125 : 2000;
      const ranges: Array<{ start: number; qty: number }> = [];
      let rangeStart = uniqueAddrs[0] ?? 0;
      let last = rangeStart;
      let qty = uniqueAddrs.length > 0 ? 1 : 0;

      for (let i = 1; i < uniqueAddrs.length; i++) {
        const a = uniqueAddrs[i];
        const contiguous = a === last + 1;
        if (contiguous && qty + 1 <= maxQty) {
          qty++;
          last = a;
        } else {
          ranges.push({ start: rangeStart, qty });
          rangeStart = a;
          last = a;
          qty = 1;
        }
      }
      if (qty > 0) ranges.push({ start: rangeStart, qty });

      const readRange = async (addr: number, count: number): Promise<Array<number | null>> => {
        if (fc === 1) {
          const out =
            kind === "serial"
              ? await invoke<boolean[]>("modbus_rtu_read_coils", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              })
              : await invoke<boolean[]>("modbus_tcp_read_coils", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              });
          return out.map((b) => (b ? 1 : 0));
        }

        if (fc === 2) {
          const out =
            kind === "serial"
              ? await invoke<boolean[]>("modbus_rtu_read_discrete_inputs", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              })
              : await invoke<boolean[]>("modbus_tcp_read_discrete_inputs", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              });
          return out.map((b) => (b ? 1 : 0));
        }

        if (fc === 4) {
          const out =
            kind === "serial"
              ? await invoke<number[]>("modbus_rtu_read_input_registers", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              })
              : await invoke<number[]>("modbus_tcp_read_input_registers", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              });
          return out.map((v) => v);
        }

        if (fc === 3) {
          const out =
            kind === "serial"
              ? await invoke<number[]>("modbus_rtu_read_holding_registers", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              })
              : await invoke<number[]>("modbus_tcp_read_holding_registers", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              });
          return out.map((v) => v);
        }

        throw new Error(`Read not implemented for function ${fc}`);
      };

      const resultMap = new Map<
        number,
        { value: number | null; status: RowRuntimeStatus; error: string | null }
      >();
      for (const r of ranges) {
        try {
          const bulk = await readRange(r.start, r.qty);
          for (let i = 0; i < r.qty; i++) {
            resultMap.set(r.start + i, { value: bulk[i] ?? null, status: "ok", error: null });
          }
        } catch (e) {
          if (isIllegalDataAddressError(e)) {
            for (let i = 0; i < r.qty; i++) {
              const a = r.start + i;
              try {
                const one = await readRange(a, 1);
                resultMap.set(a, { value: one.length > 0 ? one[0] : null, status: "ok", error: null });
              } catch (e2) {
                if (isIllegalDataAddressError(e2)) {
                  resultMap.set(a, { value: null, status: "illegal", error: null });
                } else {
                  resultMap.set(a, { value: null, status: "error", error: String(e2) });
                }
              }
            }
          } else {
            const errMsg = String(e);
            for (let i = 0; i < r.qty; i++) {
              resultMap.set(r.start + i, { value: null, status: "error", error: errMsg });
            }
          }
        }
      }

      const rowResultMap = new Map<
        string,
        { value: number | bigint | null; rawWords: number[] | null; status: RowRuntimeStatus; error: string | null }
      >();

      for (const p of parsed) {
        const wc = wordCountForDataType(fc, p.dataType);
        if (wc === 1) {
          const res = resultMap.get(p.addr);
          rowResultMap.set(p.key, {
            value: res?.value ?? null,
            rawWords: res?.value == null ? null : [res.value],
            status: res?.status ?? "error",
            error: res?.error ?? (res == null ? "Missing register value" : null),
          });
          continue;
        }

        const wordsInAddressOrder: number[] = [];
        const statuses: RowRuntimeStatus[] = [];
        const errors: Array<string | null> = [];
        for (let i = 0; i < wc; i++) {
          const res = resultMap.get(p.addr + i);
          if (res?.value != null) wordsInAddressOrder.push(res.value);
          statuses.push(res?.status ?? "error");
          errors.push(res?.error ?? (res == null ? "Missing register value" : null));
        }

        const status: RowRuntimeStatus = statuses.includes("illegal")
          ? "illegal"
          : statuses.includes("error")
            ? "error"
            : statuses.every((s) => s === "ok")
              ? "ok"
              : "error";

        if (status !== "ok" || wordsInAddressOrder.length !== wc) {
          const err = errors.find((e) => e != null) ?? null;
          rowResultMap.set(p.key, {
            value: null,
            rawWords: wordsInAddressOrder.length > 0 ? wordsInAddressOrder : null,
            status,
            error: err,
          });
          continue;
        }

        const o = normalizeOrder(p.order);
        const orderedWords = applyOrderWords(wordsInAddressOrder, o);
        const byteSwap = isByteSwapOrder(o);
        const finalWords = byteSwap ? orderedWords.map((w) => applyByteSwapWord(w)) : orderedWords;
        const bytes = bytesFromWordsU16BE(finalWords);

        if (p.dataType === "f32") {
          rowResultMap.set(p.key, { value: decodeF32FromBytesBE(bytes), rawWords: wordsInAddressOrder, status: "ok", error: null });
        } else if (p.dataType === "u32" || p.dataType === "i32") {
          const u32 = decodeU32FromBytesBE(bytes);
          const value = p.dataType === "i32" && u32 >= 0x80000000 ? u32 - 0x100000000 : u32;
          rowResultMap.set(p.key, { value, rawWords: wordsInAddressOrder, status: "ok", error: null });
        } else if (p.dataType === "f64") {
          rowResultMap.set(p.key, { value: decodeF64FromBytesBE(bytes), rawWords: wordsInAddressOrder, status: "ok", error: null });
        } else if (p.dataType === "u64" || p.dataType === "i64") {
          const u64 = decodeU64FromBytesBE(bytes);
          if (u64 == null) {
            rowResultMap.set(p.key, { value: null, rawWords: wordsInAddressOrder, status: "error", error: "Invalid byte length" });
          } else {
            const value = p.dataType === "i64" && (u64 & (1n << 63n)) !== 0n ? u64 - (1n << 64n) : u64;
            rowResultMap.set(p.key, { value, rawWords: wordsInAddressOrder, status: "ok", error: null });
          }
        } else {
          rowResultMap.set(p.key, { value: null, rawWords: wordsInAddressOrder, status: "ok", error: null });
        }
      }

      setRegisterRows((prev) =>
        prev.map((row) => {
          if (onlyKeysSet && !onlyKeysSet.has(row.key)) return row;
          const res = rowResultMap.get(row.key);
          if (!res) return row;
          return {
            ...row,
            runtimeValue: res.value,
            runtimeRawWords: res.rawWords,
            runtimeStatus: res.status,
            runtimeError: res.error,
            runtimeTs: Date.now(),
          };
        }),
      );

      if (opts?.silent) {
        pollConsecutiveFailuresRef.current = 0;
        setPollingLastError(null);
      }
    } catch (e) {
      reportError(String(e));
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Read registers failed",
        detailsJson: {
          slaveId: slave.id,
          functionCode: fc,
          error: String(e),
        },
      });
    } finally {
      if (!opts?.silent) {
        setReadingRows(false);
      }
    }
  }

  async function scanAndAddRegisterRows() {
    if (!slave) return;
    const scanFc = effectiveReadFunctionCode(selectedFunctionCode);
    if (![1, 2, 3, 4].includes(scanFc)) {
      setError("Scan is only available for function codes that support reading (0x01, 0x02, 0x03, 0x04)");
      return;
    }

    const unitId = parseIntOrNull(slaveAddress, 10);
    if (unitId == null || unitId < 0 || unitId > 255) {
      setError(
        unitId == null
          ? "Slave Address (Unit ID) is required"
          : "Slave Address (Unit ID) must be a positive number",
      );
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Scan failed: invalid unit id",
        detailsJson: {
          slaveId: slave.id,
          functionCode: selectedFunctionCode,
        },
      });
      return;
    }
    if (!supportsFunctionCodeForConnection(scanFc, slave?.connectionKind)) {
      setError(`Function ${scanFc} is not supported for ${slave?.connectionKind ?? "this"} connection yet`);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Scan failed: unsupported function code",
        detailsJson: {
          slaveId: slave.id,
          functionCode: selectedFunctionCode,
          connectionKind: slave?.connectionKind ?? null,
        },
      });
      return;
    }

    const start = parseIntOrNull(scanStartAddress, addressBase);
    const qty = parseIntOrNull(scanQuantity, 10);
    if (start == null || start < 0 || qty == null || qty <= 0) {
      setError("Scan start must be non-negative and quantity must be > 0");
      return;
    }

    const end = start + qty - 1;

    const stopAfter = parseIntOrNull(scanStopAfterConsecutiveIllegal, 10);
    if (stopAfter == null || stopAfter <= 0) {
      setError("Stop-after-illegal must be > 0");
      return;
    }

    if (qty > 50000) {
      setError("Scan quantity too large (max 50000 addresses)");
      return;
    }

    stopRegisterPolling();
    setScanningRows(true);
    setError(null);
    try {
      if (slave?.connectionKind === "serial") {
        await invoke<void>("modbus_rtu_connect", { name: workspace.name, unitId });
      } else {
        await invoke<void>("modbus_tcp_connect", { name: workspace.name, unitId });
      }
      setConnected(true);

      const readRange = async (addr: number, count: number): Promise<Array<number | null>> => {
        if (scanFc === 1) {
          const out =
            slave?.connectionKind === "serial"
              ? await invoke<boolean[]>("modbus_rtu_read_coils", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              })
              : await invoke<boolean[]>("modbus_tcp_read_coils", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              });
          return out.map((b) => (b ? 1 : 0));
        }

        if (scanFc === 2) {
          const out =
            slave?.connectionKind === "serial"
              ? await invoke<boolean[]>("modbus_rtu_read_discrete_inputs", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              })
              : await invoke<boolean[]>("modbus_tcp_read_discrete_inputs", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              });
          return out.map((b) => (b ? 1 : 0));
        }

        if (scanFc === 4) {
          const out =
            slave?.connectionKind === "serial"
              ? await invoke<number[]>("modbus_rtu_read_input_registers", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              })
              : await invoke<number[]>("modbus_tcp_read_input_registers", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              });
          return out.map((v) => v);
        }

        if (scanFc === 3) {
          const out =
            slave?.connectionKind === "serial"
              ? await invoke<number[]>("modbus_rtu_read_holding_registers", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              })
              : await invoke<number[]>("modbus_tcp_read_holding_registers", {
                name: workspace.name,
                unitId,
                startAddress: addr,
                quantity: count,
              });
          return out.map((v) => v);
        }

        throw new Error(`Read not implemented for function ${scanFc}`);
      };

      const maxQty = scanFc === 3 || scanFc === 4 ? 125 : 2000;
      const valueMap = new Map<number, number>();
      const illegalSet = new Set<number>();
      let stoppedEarly = false;
      let consecutiveIllegal = 0;

      let addr = start;
      while (addr <= end) {
        const remaining = end - addr + 1;
        const qty = Math.min(maxQty, remaining);
        try {
          const bulk = await readRange(addr, qty);
          for (let i = 0; i < qty; i++) {
            const v = bulk[i];
            if (v == null) continue;
            valueMap.set(addr + i, v);
          }
          consecutiveIllegal = 0;
          addr += qty;
        } catch (e) {
          if (!isIllegalDataAddressError(e)) throw e;
          for (let i = 0; i < qty; i++) {
            const a = addr + i;
            try {
              const one = await readRange(a, 1);
              if (one.length > 0 && one[0] != null) {
                valueMap.set(a, one[0]);
              }
              consecutiveIllegal = 0;
            } catch (e2) {
              if (isIllegalDataAddressError(e2)) {
                illegalSet.add(a);
                consecutiveIllegal++;
                if (consecutiveIllegal >= stopAfter) {
                  stoppedEarly = true;
                  break;
                }
              } else {
                throw e2;
              }
            }
          }
          if (stoppedEarly) break;
          addr += qty;
        }
      }

      const foundAddrs = Array.from(valueMap.keys()).sort((a, b) => a - b);
      const existing = new Set<number>();
      for (const r of registerRows) {
        const a = parseIntOrNull(r.address, addressBase);
        if (a != null && a >= 0) existing.add(a);
      }

      const added: SlaveRegisterRowDraft[] = [];
      for (const a of foundAddrs) {
        if (existing.has(a)) continue;
        const addrStr = formatAddress(a, addressBase);
        added.push({
          id: null,
          key: newRowKey(),
          address: addrStr,
          alias: "",
          dataType: defaultDataTypeForFunctionCode(selectedFunctionCode),
          order: "",
          displayFormat: "dec",
          writeValue: "",
          runtimeValue: valueMap.get(a) ?? null,
          runtimeRawWords: valueMap.has(a) ? [valueMap.get(a) ?? 0] : null,
          runtimeStatus: "ok" as RowRuntimeStatus,
          runtimeError: null,
          runtimeTs: Date.now(),
        });
      }

      setRegisterRows((prev) => {
        const next = prev.map((row) => {
          const a = parseIntOrNull(row.address, addressBase);
          if (a == null || a < 0) return row;
          if (valueMap.has(a))
            return {
              ...row,
              runtimeValue: valueMap.get(a) ?? null,
              runtimeStatus: "ok" as RowRuntimeStatus,
              runtimeError: null,
              runtimeTs: Date.now(),
            };
          if (illegalSet.has(a))
            return {
              ...row,
              runtimeValue: null,
              runtimeStatus: "illegal" as RowRuntimeStatus,
              runtimeError: null,
              runtimeTs: Date.now(),
            };
          return row;
        });
        return [...next, ...added];
      });

      const msg = stoppedEarly
        ? `Scan stopped early after ${stopAfter} consecutive illegal addresses. Added ${added.length} new rows.`
        : `Scan complete. Added ${added.length} new rows.`;
      pushToast(msg, "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: stoppedEarly ? "Scan stopped early" : "Scan completed",
        detailsJson: {
          slaveId: slave.id,
          functionCode: selectedFunctionCode,
          startAddress: start,
          endAddress: end,
          addedRowCount: added.length,
          stoppedEarly,
        },
      });
      setScanModalOpen(false);
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Scan failed",
        detailsJson: {
          slaveId: slave.id,
          functionCode: selectedFunctionCode,
          error: message,
        },
      });
    } finally {
      setScanningRows(false);
    }
  }

  async function writeAllSelectedRows(onlyKeys?: string[]) {
    if (!slave) return;
    if (![5, 6, 15, 16].includes(selectedFunctionCode)) {
      setError("Write is only available for 0x05, 0x06, 0x0F, 0x10");
      return;
    }
    const unitId = parseIntOrNull(slaveAddress, 10);
    if (unitId == null || unitId < 0 || unitId > 255) {
      setError(
        unitId == null
          ? "Slave Address (Unit ID) is required"
          : "Slave Address (Unit ID) must be a positive number",
      );
      return;
    }
    if (!supportsFunctionCodeForConnection(selectedFunctionCode, slave?.connectionKind)) {
      setError(`Function ${selectedFunctionCode} is not supported for ${slave?.connectionKind ?? "this"} connection yet`);
      return;
    }

    const onlyKeysSet = onlyKeys ? new Set(onlyKeys) : null;
    const sourceRows = onlyKeysSet ? registerRowsRef.current.filter((r) => onlyKeysSet.has(r.key)) : registerRowsRef.current;

    const parsedRows = sourceRows
      .map((r) => ({
        key: r.key,
        addr: parseIntOrNull(r.address, addressBase),
        dataType: (r.dataType || defaultDataTypeForFunctionCode(selectedFunctionCode)).trim(),
        order: (r.order || "ABCD").trim() || "ABCD",
        displayFormat: (r.displayFormat || "dec").toLowerCase(),
        writeRaw: r.writeValue,
      }))
      .filter(
        (x): x is {
          key: string;
          addr: number;
          dataType: string;
          order: string;
          displayFormat: string;
          writeRaw: string;
        } => x.addr != null && x.addr >= 0,
      );

    const addressOffset = slave.addressOffset ?? 0;
    const minAddress = addressOffset < 0 ? -addressOffset : 0;
    const tooSmall = parsedRows.find((p) => p.addr < minAddress);
    if (tooSmall) {
      setError(`Address must be >= ${minAddress} when base-address offset is ${addressOffset}`);
      return;
    }
    if (parsedRows.length === 0) {
      setError("No valid rows (address required)");
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Write failed: no valid rows",
        detailsJson: {
          slaveId: slave.id,
          functionCode: selectedFunctionCode,
        },
      });
      return;
    }

    setWritingRows(true);
    setError(null);
    try {
      if (slave?.connectionKind === "serial") {
        await invoke<void>("modbus_rtu_connect", { name: workspace.name, unitId });
      } else {
        await invoke<void>("modbus_tcp_connect", { name: workspace.name, unitId });
      }
      setConnected(true);

      if (selectedFunctionCode === 5) {
        const writes = parsedRows
          .map((x) => ({ addr: x.addr, writeValue: parseIntOrNull(x.writeRaw, 10) }))
          .filter((x): x is { addr: number; writeValue: number } => x.writeValue != null);
        if (writes.length === 0) {
          setError("No valid write rows (needs write value)");
          return;
        }
        for (const w of writes) {
          const value = w.writeValue !== 0;
          if (slave?.connectionKind === "serial") {
            await invoke<void>("modbus_rtu_write_single_coil", {
              name: workspace.name,
              unitId,
              address: w.addr,
              value,
            });
          } else {
            await invoke<void>("modbus_tcp_write_single_coil", {
              name: workspace.name,
              unitId,
              address: w.addr,
              value,
            });
          }
        }
      } else if (selectedFunctionCode === 6) {
        const invalidMulti = parsedRows.find((r) => wordCountForDataType(6, r.dataType) !== 1);
        if (invalidMulti) {
          setError("Write Single Register (0x06) only supports single-register data types (u16/i16)");
          return;
        }

        const writes = parsedRows
          .map((x) => ({ addr: x.addr, writeValue: parseWriteValueWithFormat(x.writeRaw, x.displayFormat) }))
          .filter((x): x is { addr: number; writeValue: number } => x.writeValue != null);
        if (writes.length === 0) {
          setError("No valid write rows (needs write value)");
          return;
        }
        for (const w of writes) {
          if (w.writeValue < 0 || w.writeValue > 0xffff) {
            setError("Register value must be in range 0..65535");
            return;
          }
          if (slave?.connectionKind === "serial") {
            await invoke<void>("modbus_rtu_write_single_register", {
              name: workspace.name,
              unitId,
              address: w.addr,
              value: w.writeValue,
            });
          } else {
            await invoke<void>("modbus_tcp_write_single_register", {
              name: workspace.name,
              unitId,
              address: w.addr,
              value: w.writeValue,
            });
          }
        }
      } else if (selectedFunctionCode === 15) {
        const sorted = parsedRows
          .map((r) => ({ addr: r.addr, writeValue: parseIntOrNull(r.writeRaw, 10) }))
          .filter((x): x is { addr: number; writeValue: number } => x.writeValue != null)
          .sort((a, b) => a.addr - b.addr);
        if (sorted.length === 0) {
          setError("No valid write rows (needs write value)");
          return;
        }

        const addrToValue = new Map<number, boolean>();
        for (const w of sorted) {
          addrToValue.set(w.addr, w.writeValue !== 0);
        }
        const addresses = Array.from(addrToValue.keys()).sort((a, b) => a - b);
        const maxQty = 1968;
        let start = addresses[0] ?? 0;
        let last = start;
        let block: boolean[] = [addrToValue.get(start) ?? false];
        const flush = async () => {
          if (block.length === 0) return;
          if (slave?.connectionKind === "serial") {
            await invoke<void>("modbus_rtu_write_multiple_coils", {
              name: workspace.name,
              unitId,
              startAddress: start,
              values: block,
            });
          } else {
            await invoke<void>("modbus_tcp_write_multiple_coils", {
              name: workspace.name,
              unitId,
              startAddress: start,
              values: block,
            });
          }
        };

        for (let i = 1; i < addresses.length; i++) {
          const a = addresses[i];
          const contiguous = a === last + 1;
          if (contiguous && block.length + 1 <= maxQty) {
            block.push(addrToValue.get(a) ?? false);
            last = a;
          } else {
            await flush();
            start = a;
            last = a;
            block = [addrToValue.get(a) ?? false];
          }
        }
        await flush();
      } else if (selectedFunctionCode === 16) {
        const writes = parsedRows
          .filter((r) => r.writeRaw.trim() !== "")
          .sort((a, b) => a.addr - b.addr);
        if (writes.length === 0) {
          setError("No valid write rows (needs write value)");
          return;
        }

        const addrToWord = new Map<number, number>();
        for (const r of writes) {
          let rawForEncode = r.writeRaw;
          const wc = wordCountForDataType(16, r.dataType);
          const isSingleU16 = wc === 1 && (r.dataType === "u16" || r.dataType === "i16");
          const isU32I32 = wc === 2 && (r.dataType === "u32" || r.dataType === "i32");
          if (isSingleU16) {
            const parsedVal = parseWriteValueWithFormat(r.writeRaw, r.displayFormat);
            if (parsedVal == null) {
              setError(`Invalid value for ${r.dataType}`);
              return;
            }
            rawForEncode = String(parsedVal);
          } else if (isU32I32) {
            const unsigned = parseUnsignedBigIntFromWriteValue(r.writeRaw, r.displayFormat, r.dataType);
            if (unsigned == null) {
              setError(`Invalid value for ${r.dataType}`);
              return;
            }
            rawForEncode = unsigned.toString(10);
          }

          const enc = encodeWriteWordsInAddressOrder(r.dataType, r.order, rawForEncode);
          if ("error" in enc) {
            setError(enc.error);
            return;
          }
          for (let i = 0; i < enc.words.length; i++) {
            const a = r.addr + i;
            if (addrToWord.has(a)) {
              setError(`Overlapping write addresses at ${formatAddress(a, addressBase)}. Delete or move the overlapping row(s).`);
              return;
            }
            addrToWord.set(a, enc.words[i] ?? 0);
          }
        }

        const addresses = Array.from(addrToWord.keys()).sort((a, b) => a - b);
        if (addresses.length === 0) {
          setError("No valid write rows (needs write value)");
          return;
        }

        const maxQty = 123;
        let start = addresses[0];
        let last = start;
        let block: number[] = [addrToWord.get(start) ?? 0];
        const flush = async () => {
          if (block.length === 0) return;
          if (slave?.connectionKind === "serial") {
            await invoke<void>("modbus_rtu_write_multiple_registers", {
              name: workspace.name,
              unitId,
              startAddress: start,
              values: block,
            });
          } else {
            await invoke<void>("modbus_tcp_write_multiple_registers", {
              name: workspace.name,
              unitId,
              startAddress: start,
              values: block,
            });
          }
        };

        for (let i = 1; i < addresses.length; i++) {
          const a = addresses[i];
          const contiguous = a === last + 1;
          if (contiguous && block.length + 1 <= maxQty) {
            block.push(addrToWord.get(a) ?? 0);
            last = a;
          } else {
            await flush();
            start = a;
            last = a;
            block = [addrToWord.get(a) ?? 0];
          }
        }
        await flush();
      }

      let refreshFc: number | null = null;
      if (selectedFunctionCode === 5 || selectedFunctionCode === 15) {
        // Coils -> read via 0x01
        refreshFc = 1;
      } else if (selectedFunctionCode === 6 || selectedFunctionCode === 16) {
        // Holding registers -> read via 0x03
        refreshFc = 3;
      }

      if (readAfterWrite && refreshFc != null) {
        await readSelectedRegisterRows({
          functionCodeOverride: refreshFc,
          onlyKeys,
          reportGlobalError: false,
        });
      }
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Write completed",
        detailsJson: {
          slaveId: slave.id,
          functionCode: selectedFunctionCode,
          rowCount: parsedRows.length,
        },
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Write failed",
        detailsJson: {
          slaveId: slave.id,
          functionCode: selectedFunctionCode,
          error: message,
        },
      });
    } finally {
      setWritingRows(false);
    }
  }

  async function maskWriteRegisterOnce() {
    if (!slave) return;

    const unitId = parseIntOrNull(slaveAddress, 10);
    if (unitId == null || unitId < 0 || unitId > 255) {
      setError(
        unitId == null
          ? "Slave Address (Unit ID) is required"
          : "Slave Address (Unit ID) must be a positive number",
      );
      return;
    }

    const kind = slave?.connectionKind ?? "serial";
    if (kind !== "serial" && kind !== "tcp") {
      setError("Mask Write Register is only supported for TCP or serial connections");
      return;
    }

    const addr = parseIntOrNull(maskWriteAddress, addressBase);
    if (addr == null || addr < 0) {
      setError("Mask write address must be a non-negative integer");
      return;
    }

    const andMaskVal = parseIntOrNull(maskWriteAndMask, 16);
    const orMaskVal = parseIntOrNull(maskWriteOrMask, 16);

    if (andMaskVal == null || orMaskVal == null) {
      setError("AND/OR mask must be valid numbers (use hex like 0xFFFF or decimal)");
      return;
    }
    if (andMaskVal < 0 || andMaskVal > 0xffff || orMaskVal < 0 || orMaskVal > 0xffff) {
      setError("Mask values must be between 0 and 0xFFFF (0..65535)");
      return;
    }

    setMaskWriting(true);
    setError(null);
    try {
      if (kind === "serial") {
        await invoke<void>("modbus_rtu_connect", { name: workspace.name, unitId });
        await invoke<void>("modbus_rtu_mask_write_register", {
          name: workspace.name,
          unitId,
          address: addr,
          andMask: andMaskVal,
          orMask: orMaskVal,
        });
      } else {
        await invoke<void>("modbus_tcp_connect", { name: workspace.name, unitId });
        await invoke<void>("modbus_tcp_mask_write_register", {
          name: workspace.name,
          unitId,
          address: addr,
          andMask: andMaskVal,
          orMask: orMaskVal,
        });
      }

      setConnected(true);
      pushToast("Mask write completed", "info");
      await readCurrentRegisters();
    } catch (e) {
      setError(String(e));
    } finally {
      setMaskWriting(false);
    }
  }

  function startRegisterPolling() {
    const interval = parseIntOrNull(pollIntervalMs, 10);
    if (interval == null || interval <= 0) {
      setError("Poll interval must be > 0 (ms)");
      return;
    }
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollConsecutiveFailuresRef.current = 0;
    setPollingLastError(null);
    setPollingRows(true);
    void logEvent({
      scope: "workspace",
      level: "info",
      workspaceName: workspace.name,
      source: "slave_detail",
      message: "Polling started",
      detailsJson: {
        slaveId: slave?.id ?? null,
        functionCode: selectedFunctionCode,
        intervalMs: interval,
      },
    });
    void readSelectedRegisterRows({ silent: true });
    pollTimerRef.current = window.setInterval(() => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      void readSelectedRegisterRows({ silent: true }).finally(() => {
        pollInFlightRef.current = false;
      });
    }, interval);
  }

  function stopRegisterPolling() {
    const wasPolling = pollingRows || pollTimerRef.current != null || pollInFlightRef.current;

    setPollingRows(false);
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollInFlightRef.current = false;

    if (!wasPolling) {
      return;
    }

    void logEvent({
      scope: "workspace",
      level: "info",
      workspaceName: workspace.name,
      source: "slave_detail",
      message: "Polling stopped",
      detailsJson: {
        slaveId: slave?.id ?? null,
        functionCode: selectedFunctionCode,
      },
    });
  }

  async function refresh() {
    if (!slaveIdValid) {
      setError("Invalid slave id");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [rows, settings] = await Promise.all([
        invoke<SlaveItem[]>("list_slaves", { name: workspace.name }),
        invoke<ConnectionSettings>("get_connection_settings", { name: workspace.name }),
      ]);
      const found = rows.find((x) => x.id === slaveId) ?? null;
      if (!found) {
        setError("Slave not found");
        setSlave(null);
      } else {
        setSlave(found);
        const nextUnitId = String(found.unitId);
        setSlaveAddress(nextUnitId);
        setInitialSlaveAddress(nextUnitId);

        const nextBase = (found.addressOffset ?? 0) === -1 ? "1" : "0";
        setBaseAddress(nextBase);
        setInitialBaseAddress(nextBase);

        const nextPoll = String(found.pollIntervalMs ?? 1000);
        setPollIntervalMs(nextPoll);
        setInitialPollIntervalMs(nextPoll);

        await loadRegisterRows(found.id, selectedFunctionCode);
      }
      setConn(settings);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [workspace.name, slaveIdValid, slaveId]);

  useEffect(() => {
    if (!slave) return;
    void loadRegisterRows(slave.id, selectedFunctionCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slave?.id, selectedFunctionCode]);

  useEffect(() => {
    return () => {
      stopRegisterPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasPageUnsaved) return;
      e.preventDefault();
      // Chrome requires returnValue to be set.
      e.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasPageUnsaved]);

  async function connect() {
    if (!slave) return;

    const unitId = parseIntOrNull(slaveAddress, 10);
    if (unitId == null || unitId < 0 || unitId > 255) {
      setError(
        unitId == null
          ? "Slave Address (Unit ID) is required"
          : "Slave Address (Unit ID) must be a positive number",
      );
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      if (slave?.connectionKind === "serial") {
        await invoke<void>("modbus_rtu_connect", {
          name: workspace.name,
          unitId,
        });
      } else {
        await invoke<void>("modbus_tcp_connect", {
          name: workspace.name,
          unitId,
        });
      }
      setConnected(true);
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Connect succeeded",
        detailsJson: {
          slaveId: slave.id,
          connectionKind: slave?.connectionKind ?? null,
        },
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      setConnected(false);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Connect failed",
        detailsJson: {
          slaveId: slave.id,
          connectionKind: slave?.connectionKind ?? null,
          error: message,
        },
      });
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      if (slave?.connectionKind === "serial") {
        await invoke<void>("modbus_rtu_disconnect", { name: workspace.name });
      } else {
        await invoke<void>("modbus_tcp_disconnect", { name: workspace.name });
      }
      setConnected(false);
      if (slave) {
        void logEvent({
          scope: "workspace",
          level: "info",
          workspaceName: workspace.name,
          source: "slave_detail",
          message: "Disconnected",
          detailsJson: {
            slaveId: slave.id,
            connectionKind: slave?.connectionKind ?? null,
          },
        });
      }
    } catch (e) {
      const message = String(e);
      setError(message);
      if (slave) {
        void logEvent({
          scope: "workspace",
          level: "error",
          workspaceName: workspace.name,
          source: "slave_detail",
          message: "Disconnect failed",
          detailsJson: {
            slaveId: slave.id,
            connectionKind: slave?.connectionKind ?? null,
            error: message,
          },
        });
      }
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleChangeConnectionKind(nextKind: "serial" | "tcp") {
    if (!slave) return;
    try {
      const nowIso = new Date().toISOString();
      const updated = await invoke<SlaveItem>("update_slave", {
        name: workspace.name,
        id: slave.id,
        patch: { connectionKind: nextKind },
        nowIso,
      });
      setSlave(updated);
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Connection type changed",
        detailsJson: {
          slaveId: slave.id,
          fromKind: slave.connectionKind ?? null,
          toKind: nextKind,
        },
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Failed to change connection type",
        detailsJson: {
          slaveId: slave.id,
          fromKind: slave.connectionKind ?? null,
          toKind: nextKind,
          error: message,
        },
      });
    }
  }

  async function openConnectionModal() {
    try {
      const [settingsValue, ports] = await Promise.all([
        invoke<GlobalConnectionSettings>("get_connection_settings", { name: workspace.name }),
        invoke<SerialPortItem[]>("list_serial_ports"),
      ]);
      const effectiveKind =
        slave?.connectionKind === "serial" || slave?.connectionKind === "tcp"
          ? (slave.connectionKind as "serial" | "tcp")
          : settingsValue.kind;

      setConnectionFormValue(
        normalizeConnectionSettings({
          ...settingsValue,
          kind: effectiveKind,
        }),
      );
      setConnectionSerialPorts(ports);
      setConnectionTestMessage(null);
      setConnectionTestError(null);
      setConnectionModalOpen(true);
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveConnectionFromModal() {
    if (!connectionFormValue) return;
    setConnectionSaving(true);
    setConnectionTestMessage(null);
    setConnectionTestError(null);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      await invoke<void>("set_connection_settings", {
        name: workspace.name,
        settings: connectionFormValue,
        nowIso,
      });
      setConn((prev) => ({ ...(prev ?? {}), ...connectionFormValue } as ConnectionSettings));
      setConnectionModalOpen(false);
      pushToast("Saved connection settings", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Connection settings saved from slave detail",
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Failed to save connection settings from slave detail",
        detailsJson: {
          error: message,
        },
      });
    } finally {
      setConnectionSaving(false);
    }
  }

  async function testConnectionFromModal() {
    if (!connectionFormValue) return;
    setConnectionTesting(true);
    setConnectionTestMessage(null);
    setConnectionTestError(null);
    setError(null);
    try {
      await invoke<void>("test_connection", {
        name: workspace.name,
        settings: connectionFormValue,
      });
      setConnectionTestMessage("Connection test succeeded.");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Connection test succeeded (slave detail)",
      });
    } catch (e) {
      const msg = String(e);
      setConnectionTestError(msg);
      setError(msg);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Connection test failed (slave detail)",
        detailsJson: {
          error: msg,
        },
      });
    } finally {
      setConnectionTesting(false);
    }
  }

  async function savePollIntervalToSlave() {
    if (!slave) return;

    const interval = parseIntOrNull(pollIntervalMs, 10);
    if (interval == null || interval <= 0) {
      setError("Poll interval must be > 0 (ms)");
      return;
    }

    setSavingPollInterval(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const updated = await invoke<SlaveItem>("update_slave", {
        name: workspace.name,
        id: slave.id,
        patch: { pollIntervalMs: interval },
        nowIso,
      });
      setSlave(updated);
      const nextPoll = String(updated.pollIntervalMs ?? interval);
      setPollIntervalMs(nextPoll);
      setInitialPollIntervalMs(nextPoll);
      pushToast("Saved", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Slave poll interval saved",
        detailsJson: {
          slaveId: slave.id,
        },
      });
    } catch (e) {
      const message = humanizeSlaveError(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Failed to save slave poll interval",
        detailsJson: {
          slaveId: slave.id,
          error: message,
        },
      });
    } finally {
      setSavingPollInterval(false);
    }
  }

  async function saveSlaveAddressToSlave() {
    if (!slave) return;

    const unitId = parseIntOrNull(slaveAddress, 10);
    if (unitId == null || unitId < 0 || unitId > 255) {
      setError(
        unitId == null
          ? "Slave Address (Unit ID) is required"
          : "Slave Address (Unit ID) must be a positive number",
      );
      return;
    }

    setSavingSlaveAddress(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const updated = await invoke<SlaveItem>("update_slave", {
        name: workspace.name,
        id: slave.id,
        patch: { unitId },
        nowIso,
      });
      setSlave(updated);
      const nextUnitId = String(updated.unitId);
      setSlaveAddress(nextUnitId);
      setInitialSlaveAddress(nextUnitId);
      pushToast("Saved", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Slave address (Unit ID) saved",
        detailsJson: {
          slaveId: slave.id,
        },
      });
    } catch (e) {
      const message = humanizeSlaveError(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Failed to save slave address (Unit ID)",
        detailsJson: {
          slaveId: slave.id,
          error: message,
        },
      });
    } finally {
      setSavingSlaveAddress(false);
    }
  }

  async function saveBaseAddressToSlave() {
    if (!slave) return;

    const addressOffset = baseAddress === "1" ? -1 : 0;

    setSavingBaseAddress(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const updated = await invoke<SlaveItem>("update_slave", {
        name: workspace.name,
        id: slave.id,
        patch: { addressOffset },
        nowIso,
      });
      setSlave(updated);
      const nextBase = (updated.addressOffset ?? addressOffset) === -1 ? "1" : "0";
      setBaseAddress(nextBase);
      setInitialBaseAddress(nextBase);
      pushToast("Saved", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Slave base address saved",
        detailsJson: {
          slaveId: slave.id,
          addressOffset,
        },
      });
    } catch (e) {
      const message = humanizeSlaveError(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "slave_detail",
        message: "Failed to save slave base address",
        detailsJson: {
          slaveId: slave.id,
          addressOffset,
          error: message,
        },
      });
    } finally {
      setSavingBaseAddress(false);
    }
  }

  async function saveAll() {
    if (!slave) return;
    if (!hasPageUnsaved) return;

    if (isSlaveAddressDirty) {
      await saveSlaveAddressToSlave();
    }

    if (isPollIntervalDirty) {
      await savePollIntervalToSlave();
    }

    if (isBaseAddressDirty) {
      await saveBaseAddressToSlave();
    }

    if (hasUnsavedChanges) {
      await saveSelectedRegisterRows();
    }
  }

  const canWrite =
    selectedFunctionCode === 5 ||
    selectedFunctionCode === 6 ||
    selectedFunctionCode === 15 ||
    selectedFunctionCode === 16;

  const busy =
    loading ||
    connecting ||
    disconnecting ||
    loadingRows ||
    savingRows ||
    readingRows ||
    writingRows ||
    scanningRows ||
    savingSlaveAddress ||
    savingPollInterval ||
    savingBaseAddress ||
    maskWriting;

  const busyOrPolling = busy || pollingRows;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "s" && e.key !== "S") return;

      // Avoid triggering while already busy/saving or when nothing to save
      if (busyOrPolling || !slave || !hasPageUnsaved || savingRows || savingSlaveAddress || savingPollInterval || savingBaseAddress) {
        return;
      }

      e.preventDefault();
      void saveAll();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busyOrPolling, slave, hasPageUnsaved, savingRows, savingSlaveAddress, savingPollInterval, savingBaseAddress]);

  async function readCurrentRegisters() {
    const readFc = effectiveReadFunctionCode(selectedFunctionCode);
    await readSelectedRegisterRows({
      functionCodeOverride: readFc,
      reportGlobalError: !canWrite,
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-inner shadow-black/5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-black/30">
        <div className="min-w-0">
          <p className="text-sm uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">Slave</p>
          <div className="mt-2 truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
            {slave ? `${slave.name}: Unit ID ${slave.unitId}` : "Loading..."}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
            onClick={() => {
              if (!hasPageUnsaved && !pollingRows) {
                navigate(`/app/${encodeURIComponent(workspace.name)}/slaves`);
              } else {
                setLeaveModalOpen(true);
              }
            }}
            title="Back to slave list"
            disabled={busy}
          >
            <FiArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>

          <button
            type="button"
            title={`Save all changes ${CTRL_S}`}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
            onClick={() => {
              void saveAll();
            }}
            disabled={busyOrPolling || !slave || !hasPageUnsaved}
          >
            <FiSave className="h-4 w-4" aria-hidden="true" />
            {savingRows || savingSlaveAddress || savingPollInterval ? "Saving..." : "Save"}
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-2 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
            onClick={() => refresh()}
            disabled={busyOrPolling}
          >
            <FiRefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {pollingRows && pollingLastError ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200" title={pollingLastError}>
          {pollingLastError}
        </div>
      ) : null}

      {!slaveIdValid ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
          Invalid slave id.
        </div>
      ) : null}

      <div className="w-full grid gap-4 lg:grid-cols-2">
        <ConnectionCard
          conn={conn}
          slave={slave}
          busy={busyOrPolling}
          connected={connected}
          onChangeConnectionKind={handleChangeConnectionKind}
          onOpenConfigure={openConnectionModal}
          onConnect={connect}
          onDisconnect={disconnect}
        />

        <PollConfigCard
          slaveAddress={slaveAddress}
          hasSlaveAddressUnsavedChanges={isSlaveAddressDirty}
          pollIntervalMs={pollIntervalMs}
          hasPollUnsavedChanges={isPollIntervalDirty}
          baseAddress={baseAddress}
          hasBaseAddressUnsavedChanges={isBaseAddressDirty}
          busy={busyOrPolling}
          onChangeSlaveAddress={setSlaveAddress}
          onChangePollInterval={setPollIntervalMs}
          onChangeBaseAddress={setBaseAddress}
        />
      </div>

      {connectionModalOpen && connectionFormValue ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Connection settings</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Configure serial/TCP parameters for this workspace. Changes apply to all slaves.
                </div>
              </div>
            </div>

            {connectionTestError ? (
              <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                {connectionTestError}
              </div>
            ) : null}

            {connectionTestMessage ? (
              <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                {connectionTestMessage}
              </div>
            ) : null}

            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <ConnectionSettingsForm
                value={connectionFormValue}
                onChange={setConnectionFormValue}
                serialPortOptions={connectionSerialPorts}
                onRefreshSerialPorts={async () => {
                  try {
                    const ports = await invoke<SerialPortItem[]>("list_serial_ports");
                    setConnectionSerialPorts(ports);
                  } catch {
                    setConnectionSerialPorts([]);
                  }
                }}
                loading={loading}
                saving={connectionSaving}
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => setConnectionModalOpen(false)}
                disabled={connectionSaving || connectionTesting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => testConnectionFromModal()}
                disabled={connectionSaving || connectionTesting}
                title="Test current connection settings"
              >
                <FiActivity className="h-4 w-4" aria-hidden="true" />
                {connectionTesting ? "Testing..." : "Test Connection"}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                onClick={() => saveConnectionFromModal()}
                disabled={connectionSaving || connectionTesting}
              >
                <FiSave className="h-4 w-4" aria-hidden="true" />
                {connectionSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">Read / Write Registers</div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">

            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <label className="text-sm text-slate-700 dark:text-slate-300" htmlFor="function-code">
                Register Type
              </label>
              <select
                id="function-code"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 sm:w-auto dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                value={selectedFunctionCode}
                onChange={(e) => {
                  stopRegisterPolling();
                  setRegisterRows([]);
                  setSavedRowsSig("");
                  setSelectedFunctionCode(Number(e.currentTarget.value));
                }}
                disabled={busy || pollingRows}
              >
                {[1, 2, 3, 4, 5, 6, 15, 16].map((fc) => (
                  <option key={fc} value={fc} disabled={!supportsFunctionCodeForConnection(fc, slave?.connectionKind)}>
                    {functionCodeLabel(fc)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <label className="text-sm text-slate-700 dark:text-slate-300" htmlFor="addr-base">
                Address Format
              </label>
              <select
                id="addr-base"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 sm:w-auto dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
                value={addressBase}
                onChange={(e) => {
                  stopRegisterPolling();
                  const nextBase: 10 | 16 = e.currentTarget.value === "16" ? 16 : 10;

                  const prevBase = addressBase;
                  setAddressBase(nextBase);

                  setRegisterRows((prev) =>
                    prev.map((row) => {
                      const a = parseIntOrNull(row.address, prevBase);
                      return {
                        ...row,
                        address: a == null || a < 0 ? row.address : formatAddress(a, nextBase),
                      };
                    }),
                  );
                }}
                disabled={busyOrPolling}
              >
                <option value={10}>Dec</option>
                <option value={16}>Hex</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              {!pollingRows ? (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                  onClick={() => {
                    void readCurrentRegisters();
                  }}
                  disabled={busyOrPolling || !slave}
                >
                  <FiDownload className="h-4 w-4" aria-hidden="true" />
                  {readingRows ? "Reading..." : "Read All"}
                </button>
              ) : null}

              {!pollingRows ? (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                  onClick={() => startRegisterPolling()}
                  disabled={busyOrPolling || !slave}
                >
                  <FiPlay className="h-4 w-4" aria-hidden="true" />
                  Poll
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-rose-500/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-500/70 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:text-rose-200 dark:hover:border-rose-400 dark:hover:text-rose-100"
                  onClick={() => stopRegisterPolling()}
                  disabled={busy}
                >
                  <FiRefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Stop Polling
                </button>
              )}

              {[1, 2, 3, 4].includes(effectiveReadFunctionCode(selectedFunctionCode)) ? (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                  onClick={() => setScanModalOpen(true)}
                  disabled={busyOrPolling || !slave}
                  title="Configure batch scan range and add discovered addresses"
                >
                  <FiSearch className="h-4 w-4" aria-hidden="true" />
                  {scanningRows ? "Scanning..." : "Scan & Add"}
                </button>
              ) : null}

              {canWrite ? (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-1 sm:w-auto dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                  onClick={() => writeAllSelectedRows()}
                  disabled={busyOrPolling || !slave}
                >
                  <FiTool className="h-4 w-4" aria-hidden="true" />
                  {writingRows ? "Writing..." : "Write All"}
                </button>
              ) : null}

              <button
                type="button"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => addRegisterRow()}
                disabled={busyOrPolling}
              >
                <FiPlus className="h-4 w-4" aria-hidden="true" />
                Add Row
              </button>

              {hasUnsavedChanges ? (
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Unsaved
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-4">
              {canWrite ? (
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-slate-600 dark:text-slate-300">Read after write</span>
                  <button
                    type="button"
                    className={`relative inline-flex h-5 w-9 items-center rounded-full border px-0 transition focus:outline-hidden focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900 ${readAfterWrite
                      ? "border-emerald-500/60 bg-emerald-500/30"
                      : "border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60"
                      }`}
                    onClick={() => setReadAfterWrite((prev) => !prev)}
                    disabled={busyOrPolling}
                    aria-pressed={readAfterWrite}
                    aria-label="Toggle read after write"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition dark:bg-slate-200 ${readAfterWrite ? "translate-x-4" : "translate-x-1"
                        }`}
                    />
                  </button>
                </div>
              ) : null}

              {(selectedFunctionCode === 3 || selectedFunctionCode === 6 || selectedFunctionCode === 16) && (
                <div className="flex items-center justify-end gap-2 sm:min-w-45">
                  <span className="text-xs text-slate-600 dark:text-slate-300">Mask write</span>
                  <button
                    type="button"
                    className={`relative inline-flex h-5 w-9 items-center rounded-full border px-0 transition focus:outline-hidden focus:ring-2 focus:ring-emerald-500/40 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900 ${maskWriteVisible
                      ? "border-emerald-500/60 bg-emerald-500/30"
                      : "border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60"
                      }`}
                    onClick={() => setMaskWriteVisible((prev) => !prev)}
                    disabled={busyOrPolling}
                    aria-pressed={maskWriteVisible}
                    aria-label="Toggle mask write panel"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition dark:bg-slate-200 ${maskWriteVisible ? "translate-x-4" : "translate-x-1"
                        }`}
                    />
                  </button>
                </div>
              )}
            </div>
          </div>
          {maskWriteVisible && (selectedFunctionCode === 3 || selectedFunctionCode === 6 || selectedFunctionCode === 16) && (
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800/80 dark:bg-slate-950/30">
              <div className="mb-2 text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
                Mask Write Register (0x16)
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Address</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={maskWriteAddress}
                    onChange={(e) => setMaskWriteAddress(e.currentTarget.value)}
                    placeholder={addressBase === 16 ? "0x0" : "0"}
                    disabled={busyOrPolling}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">AND mask</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={maskWriteAndMask}
                    onChange={(e) => setMaskWriteAndMask(e.currentTarget.value)}
                    placeholder="0xFFFF"
                    disabled={pollingRows}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">OR mask</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                    value={maskWriteOrMask}
                    onChange={(e) => setMaskWriteOrMask(e.currentTarget.value)}
                    placeholder="0x0000"
                    disabled={busyOrPolling}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                    onClick={() => {
                      void maskWriteRegisterOnce();
                    }}
                    disabled={busyOrPolling || !slave}
                    title="Apply AND/OR mask to the specified holding register"
                  >
                    <FiTool className="h-4 w-4" aria-hidden="true" />
                    {maskWriting ? "Mask writing..." : "Mask write"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {scanModalOpen && [1, 2, 3, 4].includes(effectiveReadFunctionCode(selectedFunctionCode)) ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs">
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Batch Add</div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">Configure scan range and add discovered addresses.</div>
                  </div>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
                    onClick={() => setScanModalOpen(false)}
                    title="Close"
                  >
                    <RiCloseLine className="h-4 w-3" aria-hidden="true" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">Start address</label>
                      <input
                        type="text"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                        value={scanStartAddress}
                        onChange={(e) => setScanStartAddress(e.currentTarget.value)}
                        placeholder={addressBase === 16 ? "0x0" : "0"}
                        disabled={busyOrPolling}
                        title="Scan start address"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">Quantity</label>
                      <input
                        type="number"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                        value={scanQuantity}
                        onChange={(e) => setScanQuantity(e.currentTarget.value)}
                        placeholder="100"
                        min={1}
                        disabled={busyOrPolling}
                        title="Number of addresses to scan"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">Stop after N consecutive illegal addresses</label>
                    <input
                      type="number"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                      value={scanStopAfterConsecutiveIllegal}
                      onChange={(e) => setScanStopAfterConsecutiveIllegal(e.currentTarget.value)}
                      min={1}
                      disabled={busyOrPolling}
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                    onClick={() => setScanModalOpen(false)}
                    disabled={busyOrPolling}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                    onClick={() => {
                      void scanAndAddRegisterRows();
                    }}
                    disabled={busyOrPolling || !slave}
                  >
                    <FiSearch className="h-4 w-4" aria-hidden="true" />
                    {scanningRows ? "Scanning..." : "Scan & Add"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <RegisterRowsTable
            rows={rowsForTable}
            functionCode={selectedFunctionCode}
            canWrite={canWrite}
            busy={busyOrPolling}
            addressBase={addressBase}
            formatValue={formatValueForRow}
            onChangeRow={(key, patch) => {
              const next = registerRowsRef.current.map((row) => {
                if (row.key !== key) return row;

                // If only the displayFormat is changing, auto-convert the writeValue based on previous format.
                if (patch.displayFormat && !patch.writeValue) {
                  const prevFmt = (row.displayFormat || "dec").toLowerCase();
                  const nextFmt = (patch.displayFormat || "dec").toLowerCase();

                  if (prevFmt !== nextFmt && row.writeValue.trim() !== "") {
                    const wc = wordCountForDataType(selectedFunctionCode, row.dataType);
                    const isSingleWord = wc === 1;
                    if (isSingleWord) {
                      const parsed = parseWriteValueWithFormat(row.writeValue, prevFmt);
                      if (parsed != null) {
                        const converted = formatWriteValueWithFormat(parsed, nextFmt);
                        return {
                          ...row,
                          ...patch,
                          writeValue: converted,
                        };
                      }
                    } else if (wc === 2 && (row.dataType === "u32" || row.dataType === "i32")) {
                      const unsigned = parseUnsignedBigIntFromWriteValue(row.writeValue, prevFmt, row.dataType);
                      if (unsigned != null) {
                        const converted = formatWriteValueIntegerWithFormat(Number(unsigned), row.dataType, nextFmt);
                        return {
                          ...row,
                          ...patch,
                          writeValue: converted,
                        };
                      }
                    } else if ((wc === 2 && row.dataType === "f32") || (wc === 4 && row.dataType === "f64")) {
                      const parsed = parseFloatFromWriteValue(row.writeValue, prevFmt, row.dataType);
                      if (parsed != null) {
                        const converted = formatValueTyped(parsed, nextFmt, row.dataType);
                        return {
                          ...row,
                          ...patch,
                          writeValue: converted,
                        };
                      }
                    }
                  }
                }

                return { ...row, ...patch };
              });

              registerRowsRef.current = next;
              flushSync(() => {
                setRegisterRows(next);
              });
            }}
            onReadRow={(key) => {
              readSingleRow(key);
            }}
            onWriteRow={(key) => {
              writeSingleRow(key);
            }}
            onDeleteRow={(key) => {
              void attemptDeleteRegisterRow(key);
            }}
            onOpenReadValueDetails={(key) => {
              setReadValueDetailsKey(key);
            }}
          />
        </div>
        <div className="mt-4 rounded-full border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950/30">
          <div className="inline-flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-200">
            <span className={`h-2 w-2 rounded-full ${pollingRows ? "bg-emerald-400" : "bg-slate-600"}`} />
            <span className={pollingRows ? "font-semibold text-emerald-700 dark:text-emerald-200" : "text-slate-600 dark:text-slate-300"}>
              {pollingRows ? "Polling" : "Not polling"}
            </span>
            <span className="text-slate-400 dark:text-slate-500">|</span>
            <span className="text-slate-600 dark:text-slate-300">Updated</span>
            <span className="font-semibold text-slate-900 dark:text-slate-200">{runtimeSummary.ageLabel}</span>
            <span className="text-slate-400 dark:text-slate-500">|</span>
            <span className="text-emerald-700 dark:text-emerald-200">OK {runtimeSummary.ok}</span>
            <span className="text-amber-700 dark:text-amber-200">Bad {runtimeSummary.illegal}</span>
            <span className="text-rose-700 dark:text-rose-200">Err {runtimeSummary.error}</span>
          </div>
        </div>
      </div>

      <SlaveAttachmentsCard workspaceName={workspace.name} slaveId={slave?.id ?? null} />

      <ConfirmDialog
        open={leaveModalOpen}
        title={pollingRows ? "Polling in progress" : "Unsaved changes"}
        description={
          <>
            <p className="mb-2">
              {pollingRows && hasPageUnsaved
                ? "There is an active poll and unsaved changes on this slave. If you leave now, polling will be stopped and unsaved changes will be lost."
                : pollingRows
                  ? "There is an active poll on this slave. If you leave now, polling will be stopped."
                  : "There are unsaved changes on this slave. If you leave now, those changes will be lost."}
            </p>
            <p className="text-[11px] text-slate-400">This action cannot be undone from this app.</p>
          </>
        }
        confirmText={pollingRows ? "Stop and leave" : "Leave without saving"}
        cancelText="Stay on this screen"
        tone="danger"
        onConfirm={() => {
          setLeaveModalOpen(false);
          if (pollingRows) {
            stopRegisterPolling();
          }
          navigate(`/app/${encodeURIComponent(workspace.name)}/slaves`);
        }}
        onClose={() => {
          setLeaveModalOpen(false);
        }}
      />

      {readValueDetailsRow && readValueDetails ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-900 shadow-2xl sm:text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Register value details</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {`Address ${readValueDetailsRow.address}`}
                </div>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
                onClick={() => setReadValueDetailsKey(null)}
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-1">
              <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Raw</div>
                <div className="mt-1 space-y-1 text-xs text-slate-700 dark:text-slate-200">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Data / Values:</span>{" "}
                    <span className="font-mono">{readValueDetails.rawWordsLabel}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Bytes:</span>{" "}
                    <span className="font-mono">{readValueDetails.bytesLabel}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Decoded</div>
                <div className="mt-1 space-y-1 text-xs text-slate-700 dark:text-slate-200">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">As:</span>{" "}
                    <span className="font-mono text-emerald-700 dark:text-emerald-200">{readValueDetails.decodeLine}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Format:</span> {readValueDetailsRow.displayFormat}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
