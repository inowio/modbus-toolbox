export type ModbusOrder = "ABCD" | "BADC" | "CDAB" | "DCBA" | string;

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

export function wordCountForDataType(functionCode: number, dataType: string): number {
  const fc = Number(functionCode);
  if (fc === 1 || fc === 2 || fc === 5 || fc === 15) return 1;
  const dt = (dataType || "u16").trim().toLowerCase();
  if (dt === "u32" || dt === "i32" || dt === "f32") return 2;
  if (dt === "u64" || dt === "i64" || dt === "f64") return 4;
  return 1;
}

export function bytesFromWordsU16BE(words: number[]): number[] {
  const bytes: number[] = [];
  for (const w of words) {
    const v = w & 0xffff;
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

export function wordsFromBytesU16BE(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out.push((((bytes[i] ?? 0) & 0xff) << 8) | ((bytes[i + 1] ?? 0) & 0xff));
  }
  return out;
}

export function applyByteSwapWord(word: number): number {
  const w = word & 0xffff;
  return ((w & 0xff) << 8) | ((w >> 8) & 0xff);
}

export function normalizeOrder(order: string): string {
  const o = (order || "ABCD").trim().toUpperCase() || "ABCD";
  return KNOWN_ORDERS.has(o) ? o : "ABCD";
}

function isByteSwapOrder(order: string): boolean {
  const o = normalizeOrder(order);
  return o === "BADC" || o === "DCBA" || o === "HALF_SWAP_BS" || o === "INTRA_HALF_SWAP_BS";
}

export function applyOrderWords(words: number[], order: string): number[] {
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

export function decodeU32FromBytesBE(bytes: number[]): number {
  if (bytes.length !== 4) return Number.NaN;
  return (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>> 0;
}

export function decodeF32FromBytesBE(bytes: number[]): number {
  if (bytes.length !== 4) return Number.NaN;
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  bytes.forEach((b, i) => view.setUint8(i, b & 0xff));
  return view.getFloat32(0, false);
}

export function decodeU64FromBytesBE(bytes: number[]): bigint | null {
  if (bytes.length !== 8) return null;
  let out = 0n;
  for (const b of bytes) {
    out = (out << 8n) | BigInt(b & 0xff);
  }
  return out;
}

export function decodeF64FromBytesBE(bytes: number[]): number {
  if (bytes.length !== 8) return Number.NaN;
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  bytes.forEach((b, i) => view.setUint8(i, b & 0xff));
  return view.getFloat64(0, false);
}

export function bytesForRowValue(
  functionCode: number,
  row: {
    dataType: string;
    order: string;
    runtimeRawWords: number[] | null;
  },
): number[] | null {
  const wc = wordCountForDataType(functionCode, row.dataType);
  const words = (row.runtimeRawWords ?? []).slice(0, wc);
  if (words.length !== wc) return null;

  if (functionCode === 1 || functionCode === 2 || functionCode === 5 || functionCode === 15) {
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

export function formatBytesAsAscii(bytes: number[]): string {
  return bytes
    .map((b) => {
      const v = b & 0xff;
      if (v >= 0x20 && v <= 0x7e) return String.fromCharCode(v);
      return ".";
    })
    .join("");
}

export function bigintFromBytesBE(bytes: number[]): bigint {
  let out = 0n;
  for (const b of bytes) {
    out = (out << 8n) | BigInt(b & 0xff);
  }
  return out;
}

export function formatBits(value: bigint, bitCount: number): string {
  const mask = (1n << BigInt(bitCount)) - 1n;
  const v = value & mask;
  return `0b${v.toString(2).padStart(bitCount, "0")}`;
}

function hexFromBytesBE(bytes: number[]): string {
  return bytes
    .map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0"))
    .join("");
}

export function formatValueTyped(v: number | bigint, fmt: string, dataType: string): string {
  if (v == null) return "NA";
  if (typeof v === "number" && !Number.isFinite(v)) return "NA";

  const f = (fmt || "dec").toLowerCase();
  const dt = (dataType || "u16").trim().toLowerCase();

  if (dt === "u16" || dt === "i16") {
    const n = Number(v) & 0xffff;
    if (dt === "i16") {
      const asI16 = n >= 0x8000 ? n - 0x10000 : n;
      if (f === "hex") return `0x${(asI16 & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
      return String(asI16);
    }
    if (f === "hex") return `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
    return String(n);
  }

  if (dt === "u32" || dt === "i32") {
    const u32 = Number(v) >>> 0;
    if (dt === "i32") {
      const asI32 = u32 >= 0x80000000 ? u32 - 0x100000000 : u32;
      if (f === "hex") return `0x${(asI32 >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
      return String(asI32);
    }
    if (f === "hex") return `0x${u32.toString(16).toUpperCase().padStart(8, "0")}`;
    return String(u32);
  }

  if (dt === "f32") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "NA";
    if (f === "hex" || f === "bin") {
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      view.setFloat32(0, n, false);
      const bytes = Array.from(new Uint8Array(buf));
      if (f === "hex") return `0x${hexFromBytesBE(bytes)}`;
      const u32 = view.getUint32(0, false) >>> 0;
      return `0b${u32.toString(2).padStart(32, "0")}`;
    }
    return String(n);
  }

  if (dt === "f64") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "NA";
    if (f === "hex" || f === "bin") {
      const buf = new ArrayBuffer(8);
      const view = new DataView(buf);
      view.setFloat64(0, n, false);
      const bytes = Array.from(new Uint8Array(buf));
      if (f === "hex") return `0x${hexFromBytesBE(bytes)}`;
      const bi = bigintFromBytesBE(bytes);
      return `0b${bi.toString(2).padStart(64, "0")}`;
    }
    return String(n);
  }

  if (dt === "u64" || dt === "i64") {
    if (typeof v === "number") {
      if (!Number.isFinite(v) || !Number.isInteger(v)) return "NA";
      const bi = BigInt(v);
      if (f === "hex") return `0x${bi.toString(16).toUpperCase().padStart(16, "0")}`;
      return bi.toString(10);
    }

    const bi = v;
    if (dt === "i64") {
      const u64max = (1n << 64n) - 1n;
      const asU64 = bi & u64max;
      const value = (asU64 & (1n << 63n)) !== 0n ? asU64 - (1n << 64n) : asU64;
      if (f === "hex") return `0x${(value & u64max).toString(16).toUpperCase().padStart(16, "0")}`;
      return value.toString(10);
    }

    if (f === "hex") return `0x${bi.toString(16).toUpperCase().padStart(16, "0")}`;
    return bi.toString(10);
  }

  return "NA";
}

export type EncodeWriteResult = { words: number[] } | { error: string };

function parseIntOrNull(s: string, radix: number): number | null {
  const trimmed = (s || "").trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  let inferredRadix = radix;
  let digits = body;
  if (body.startsWith("0x") || body.startsWith("0X")) {
    inferredRadix = 16;
    digits = body.slice(2);
  } else if (body.startsWith("0b") || body.startsWith("0B")) {
    inferredRadix = 2;
    digits = body.slice(2);
  }
  if (!digits) return null;

  if (inferredRadix === 16 && !/^[0-9a-f]+$/i.test(digits)) return null;
  if (inferredRadix === 10 && !/^[0-9]+$/.test(digits)) return null;
  if (inferredRadix === 2 && !/^[01]+$/.test(digits)) return null;

  const n = Number.parseInt(negative ? `-${digits}` : digits, inferredRadix);
  return Number.isFinite(n) ? n : null;
}

function parseBigIntOrNull(s: string, radix: number): bigint | null {
  const trimmed = (s || "").trim();
  if (!trimmed) return null;

  try {
    const negative = trimmed.startsWith("-");
    const body = negative ? trimmed.slice(1) : trimmed;

    // Allow 0x / 0b prefixes even when callers pass radix=10.
    if (body.startsWith("0x") || body.startsWith("0X")) {
      const digits = body.slice(2);
      if (!digits) return null;
      const v = BigInt(`0x${digits}`);
      return negative ? -v : v;
    }
    if (body.startsWith("0b") || body.startsWith("0B")) {
      const digits = body.slice(2);
      if (!digits) return null;
      const v = BigInt(`0b${digits}`);
      return negative ? -v : v;
    }

    if (radix === 10) return BigInt(trimmed);

    let t = trimmed;
    if (t.startsWith("0x") || t.startsWith("0X")) t = t.slice(2);
    if (!t) return null;
    const normalized = `0x${t}`;
    return BigInt(normalized);
  } catch {
    return null;
  }
}

export function encodeWriteWordsInAddressOrder(
  dataType: string,
  order: string,
  raw: string,
): EncodeWriteResult {
  const dt = (dataType || "u16").trim().toLowerCase();
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
      const f = Number.parseFloat((raw || "").trim());
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
      const f = Number.parseFloat((raw || "").trim());
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

export type DecodedRowResult =
  | { ok: true; value: number | bigint; rawWords: number[] }
  | { ok: false; error: string; rawWords: number[] | null };

export function decodeWordsInAddressOrder(
  dataType: string,
  order: string,
  wordsInAddressOrder: number[],
): DecodedRowResult {
  const dt = (dataType || "u16").trim().toLowerCase();
  const o = normalizeOrder(order);

  const wc = dt === "u64" || dt === "i64" || dt === "f64" ? 4 : dt === "u32" || dt === "i32" || dt === "f32" ? 2 : 1;
  const words = (wordsInAddressOrder ?? []).slice(0, wc).map((w) => w & 0xffff);
  if (words.length !== wc) {
    return { ok: false, error: "Not enough words", rawWords: words.length > 0 ? words : null };
  }

  if (dt === "bool") {
    return { ok: true, value: (words[0] ?? 0) ? 1 : 0, rawWords: words };
  }

  const orderedWords = applyOrderWords(words, o);
  const byteSwap = isByteSwapOrder(o);
  const finalWords = byteSwap ? orderedWords.map((w) => applyByteSwapWord(w)) : orderedWords;
  const bytes = bytesFromWordsU16BE(finalWords);

  if (dt === "u16" || dt === "i16") {
    const u16 = finalWords[0] ?? 0;
    const value = dt === "i16" && u16 >= 0x8000 ? u16 - 0x10000 : u16;
    return { ok: true, value, rawWords: words };
  }

  if (dt === "f32") return { ok: true, value: decodeF32FromBytesBE(bytes), rawWords: words };

  if (dt === "u32" || dt === "i32") {
    const u32 = decodeU32FromBytesBE(bytes);
    const value = dt === "i32" && u32 >= 0x80000000 ? u32 - 0x100000000 : u32;
    return { ok: true, value, rawWords: words };
  }

  if (dt === "f64") return { ok: true, value: decodeF64FromBytesBE(bytes), rawWords: words };

  if (dt === "u64" || dt === "i64") {
    const u64 = decodeU64FromBytesBE(bytes);
    if (u64 == null) return { ok: false, error: "Invalid byte length", rawWords: words };
    const value = dt === "i64" && (u64 & (1n << 63n)) !== 0n ? u64 - (1n << 64n) : u64;
    return { ok: true, value, rawWords: words };
  }

  return { ok: false, error: `Unsupported data type: ${dt}`, rawWords: words };
}
