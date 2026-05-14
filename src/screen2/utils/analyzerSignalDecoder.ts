import {
  bigintFromBytesBE,
  bytesForRowValue,
  decodeWordsInAddressOrder,
  formatBits,
  formatBytesAsAscii,
  formatValueTyped,
} from "./modbusValueCodec";

export type AnalyzerRawSnapshot = {
  rawWords?: number[];
  rawBools?: boolean[];
};

export type AnalyzerDecoderConfig = {
  bit?: number;
  scale?: number;
  offset?: number;
  clampMin?: number;
  clampMax?: number;
  decimals?: number;
  unit?: string;
};

export type AnalyzerDecodedValue =
  | { kind: "bool"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "bigint"; value: bigint };

export type AnalyzerDecodeResult =
  | {
      ok: true;
      value: AnalyzerDecodedValue;
      formatted: string;
    }
  | {
      ok: false;
      error: string;
      formatted: string;
    };

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asNumberOrUndefined(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function asStringOrUndefined(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  return undefined;
}

 function parseErrorMessageFromJson(errorJson: string | null | undefined): string | null {
   if (!errorJson) return null;
   const parsed = safeJsonParse(errorJson);
   if (!parsed || typeof parsed !== "object") return null;
   const obj = parsed as Record<string, unknown>;
   const message = asStringOrUndefined(obj.message);
   return message?.trim() ? message.trim() : null;
 }

function formatNonOkStateMessage(state: string, errorMessage: string): string {
  const s = (state || "").toUpperCase();
  if (s === "DISCONNECTED") return "Disconnected";

  const msg = (errorMessage || "").trim();
  const m = msg.toLowerCase();

  const looksLikeSerialMissing =
    m.includes("failed to open serial port") ||
    m.includes("cannot find the file specified") ||
    m.includes("no such file") ||
    m.includes("not found");

  if (looksLikeSerialMissing) return "Device not available";

  const looksLikeConnectIssue =
    m.includes("connect timed out") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("connection refused") ||
    m.includes("failed to connect") ||
    m.includes("disconnected");

  if (looksLikeConnectIssue) return "Disconnected";

  if (s === "STALE") return "Stale";
  return "Disconnected";
}

function asBoolArrayOrUndefined(v: unknown): boolean[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: boolean[] = [];
  for (const x of v) {
    if (typeof x !== "boolean") return undefined;
    out.push(x);
  }
  return out;
}

function asU16ArrayOrUndefined(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
    const n = Math.trunc(x);
    if (n < 0 || n > 0xffff) return undefined;
    out.push(n);
  }
  return out;
}

export function parseAnalyzerRawSnapshotFromJson(jsonStr: string | null | undefined): AnalyzerRawSnapshot | null {
  if (!jsonStr) return null;
  const parsed = safeJsonParse(jsonStr);
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const rawWords = asU16ArrayOrUndefined(obj.rawWords);
  const rawBools = asBoolArrayOrUndefined(obj.rawBools);

  if (!rawWords && !rawBools) return null;

  const out: AnalyzerRawSnapshot = {};
  if (rawWords) out.rawWords = rawWords;
  if (rawBools) out.rawBools = rawBools;
  return out;
}

export function parseAnalyzerDecoderConfig(decoderJson: string | null | undefined): AnalyzerDecoderConfig {
  if (!decoderJson) return {};
  const parsed = safeJsonParse(decoderJson);
  if (!parsed || typeof parsed !== "object") return {};

  const obj = parsed as Record<string, unknown>;

  const bit = asNumberOrUndefined(obj.bit);
  const scale = asNumberOrUndefined(obj.scale);
  const offset = asNumberOrUndefined(obj.offset);
  const clampMin = asNumberOrUndefined(obj.clampMin);
  const clampMax = asNumberOrUndefined(obj.clampMax);
  const decimals = asNumberOrUndefined(obj.decimals);
  const unit = asStringOrUndefined(obj.unit);

  const out: AnalyzerDecoderConfig = {};
  if (bit != null) out.bit = Math.trunc(bit);
  if (scale != null) out.scale = scale;
  if (offset != null) out.offset = offset;
  if (clampMin != null) out.clampMin = clampMin;
  if (clampMax != null) out.clampMax = clampMax;
  if (decimals != null) out.decimals = Math.trunc(decimals);
  if (unit != null) out.unit = unit;

  return out;
}

function applyTransforms(
  value: AnalyzerDecodedValue,
  cfg: AnalyzerDecoderConfig,
): AnalyzerDecodedValue {
  let current: AnalyzerDecodedValue = value;

  if (cfg.bit != null && Number.isInteger(cfg.bit) && cfg.bit >= 0) {
    if (current.kind === "bigint") {
      const bit = BigInt(cfg.bit);
      current = { kind: "bool", value: ((current.value >> bit) & 1n) === 1n };
    } else if (current.kind === "number") {
      const asU32 = (Math.trunc(current.value) >>> 0);
      if (cfg.bit <= 31) {
        current = { kind: "bool", value: ((asU32 >>> cfg.bit) & 1) === 1 };
      }
    }
  }

  if (current.kind === "bool") return current;

  // Any scale/offset/clamp/decimals implies numeric operations.
  const needsNumeric =
    cfg.scale != null || cfg.offset != null || cfg.clampMin != null || cfg.clampMax != null || cfg.decimals != null;

  if (!needsNumeric) return current;

  let n = current.kind === "bigint" ? Number(current.value) : current.value;

  if (cfg.scale != null) n *= cfg.scale;
  if (cfg.offset != null) n += cfg.offset;

  if (cfg.clampMin != null) n = Math.max(n, cfg.clampMin);
  if (cfg.clampMax != null) n = Math.min(n, cfg.clampMax);

  if (cfg.decimals != null && Number.isInteger(cfg.decimals) && cfg.decimals >= 0) {
    const p = Math.min(12, cfg.decimals);
    const m = 10 ** p;
    n = Math.round(n * m) / m;
  }

  return { kind: "number", value: n };
}

function formatDecoded(
  value: AnalyzerDecodedValue,
  displayFormat: string,
  functionCode: number,
  dataType: string,
  order: string,
  rawWords: number[] | null,
  cfg: AnalyzerDecoderConfig,
): string {
  if (value.kind === "bool") {
    const base = value.value ? "1" : "0";
    return cfg.unit ? `${base} ${cfg.unit}` : base;
  }

  const fmt = (displayFormat || "dec").toLowerCase();

  if (fmt === "ascii") {
    const bytes = bytesForRowValue(functionCode, { dataType, order, runtimeRawWords: rawWords });
    if (!bytes) return "NA";
    const base = formatBytesAsAscii(bytes);
    return cfg.unit ? `${base} ${cfg.unit}` : base;
  }

  if (fmt === "bin") {
    const bytes = bytesForRowValue(functionCode, { dataType, order, runtimeRawWords: rawWords });
    if (!bytes) return "NA";
    const dt = (dataType || "u16").trim().toLowerCase();

    if (dt === "f32" || dt === "u32" || dt === "i32") {
      const base = formatBits(bigintFromBytesBE(bytes.slice(0, 4)), 32);
      return cfg.unit ? `${base} ${cfg.unit}` : base;
    }

    if (dt === "f64" || dt === "u64" || dt === "i64") {
      const base = formatBits(bigintFromBytesBE(bytes.slice(0, 8)), 64);
      return cfg.unit ? `${base} ${cfg.unit}` : base;
    }

    if (dt === "u16" || dt === "i16") {
      const base = formatBits(bigintFromBytesBE(bytes.slice(0, 2)), 16);
      return cfg.unit ? `${base} ${cfg.unit}` : base;
    }

    return "NA";
  }

  // If we applied numeric transforms we treat it as number formatting.
  if (value.kind === "number") {
    let base: string;
    if (cfg.decimals != null && Number.isInteger(cfg.decimals) && cfg.decimals >= 0) {
      base = value.value.toFixed(Math.min(12, cfg.decimals));
    } else {
      base = formatValueTyped(value.value, displayFormat, dataType);
    }
    return cfg.unit ? `${base} ${cfg.unit}` : base;
  }

  const base = formatValueTyped(value.value, displayFormat, dataType);
  return cfg.unit ? `${base} ${cfg.unit}` : base;
}

export function decodeAnalyzerSignal(
  input: {
    state: string;
    error?: string | null;
    errorJson?: string | null;
    rawWords?: number[] | null;
    rawBools?: boolean[] | null;
    functionCode: number;
    dataType: string;
    order: string;
    displayFormat: string;
    decoderJson?: string | null;
  },
): AnalyzerDecodeResult {
  const state = (input.state || "").toUpperCase();
  const fallbackError = state || "ERROR";
  const errorMessage =
    (input.error || "").trim() || parseErrorMessageFromJson(input.errorJson) || fallbackError;

  if (state !== "OK") {
    const formatted = formatNonOkStateMessage(state, errorMessage);
    return { ok: false, error: errorMessage, formatted };
  }

  const cfg = parseAnalyzerDecoderConfig(input.decoderJson);

  if (input.rawBools && input.rawBools.length > 0) {
    const idx = cfg.bit != null && Number.isInteger(cfg.bit) && cfg.bit >= 0 ? cfg.bit : 0;
    const decoded: AnalyzerDecodedValue = {
      kind: "bool",
      value: Boolean(input.rawBools[idx] ?? input.rawBools[0]),
    };
    const transformed = applyTransforms(decoded, cfg);
    const formatted = formatDecoded(
      transformed,
      input.displayFormat,
      input.functionCode,
      input.dataType,
      input.order,
      null,
      cfg,
    );
    return { ok: true, value: transformed, formatted };
  }

  const words = (input.rawWords ?? []).map((w) => Math.trunc(w) & 0xffff);
  if (words.length === 0) {
    return { ok: false, error: "No data", formatted: "NA" };
  }

  const decoded = decodeWordsInAddressOrder(input.dataType, input.order, words);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error, formatted: "NA" };
  }

  const typed: AnalyzerDecodedValue =
    typeof decoded.value === "bigint"
      ? { kind: "bigint", value: decoded.value }
      : { kind: "number", value: Number(decoded.value) };

  const transformed = applyTransforms(typed, cfg);
  if (transformed.kind === "number" && !Number.isFinite(transformed.value)) {
    return { ok: false, error: "Numeric overflow", formatted: "NA" };
  }
  const formatted = formatDecoded(
    transformed,
    input.displayFormat,
    input.functionCode,
    input.dataType,
    input.order,
    decoded.rawWords,
    cfg,
  );

  return { ok: true, value: transformed, formatted };
}
