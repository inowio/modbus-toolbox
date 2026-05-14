import { describe, expect, it } from "vitest";
import {
  applyByteSwapWord,
  applyOrderWords,
  bytesForRowValue,
  bytesFromWordsU16BE,
  decodeWordsInAddressOrder,
  encodeWriteWordsInAddressOrder,
  formatBytesAsAscii,
  formatValueTyped,
  normalizeOrder,
  wordCountForDataType,
  wordsFromBytesU16BE,
} from "./modbusValueCodec";

describe("modbusValueCodec", () => {
  it("computes word counts for function codes and data types", () => {
    expect(wordCountForDataType(1, "u16")).toBe(1);
    expect(wordCountForDataType(3, "u32")).toBe(2);
    expect(wordCountForDataType(4, "f64")).toBe(4);
    expect(wordCountForDataType(3, "")).toBe(1);
  });

  it("converts words to bytes and back", () => {
    const bytes = bytesFromWordsU16BE([0x1234, 0xabcd]);
    expect(bytes).toEqual([0x12, 0x34, 0xab, 0xcd]);
    expect(wordsFromBytesU16BE(bytes)).toEqual([0x1234, 0xabcd]);
  });

  it("normalizes orders and applies byte swaps", () => {
    expect(normalizeOrder("invalid")).toBe("ABCD");
    expect(normalizeOrder("dcba")).toBe("DCBA");
    expect(applyByteSwapWord(0x1234)).toBe(0x3412);
  });

  it("reorders words based on byte order", () => {
    expect(applyOrderWords([1, 2], "CDAB")).toEqual([2, 1]);
    expect(applyOrderWords([1, 2, 3, 4], "HALF_SWAP")).toEqual([3, 4, 1, 2]);
    expect(applyOrderWords([1, 2, 3, 4], "INTRA_HALF_SWAP")).toEqual([2, 1, 4, 3]);
  });

  it("encodes bytes for row values", () => {
    const bitBytes = bytesForRowValue(1, {
      dataType: "u16",
      order: "ABCD",
      runtimeRawWords: [1],
    });
    expect(bitBytes).toEqual([1]);

    const u32Bytes = bytesForRowValue(3, {
      dataType: "u32",
      order: "ABCD",
      runtimeRawWords: [0x1234, 0xabcd],
    });
    expect(u32Bytes).toEqual([0x12, 0x34, 0xab, 0xcd]);
  });

  it("formats bytes as ASCII", () => {
    expect(formatBytesAsAscii([0x41, 0x00, 0x7f])).toBe("A..");
  });

  it("formats typed values", () => {
    expect(formatValueTyped(0x1234, "hex", "u16")).toBe("0x1234");
    expect(formatValueTyped(0xffff, "dec", "i16")).toBe("-1");
    expect(formatValueTyped(42, "hex", "u32")).toBe("0x0000002A");
    expect(formatValueTyped(Number.NaN, "dec", "u16")).toBe("NA");
  });

  it("encodes words for write operations", () => {
    const ok = encodeWriteWordsInAddressOrder("u16", "ABCD", "255");
    expect(ok).toEqual({ words: [255] });

    const err = encodeWriteWordsInAddressOrder("u16", "ABCD", "-1");
    expect("error" in err).toBe(true);
  });

  it("decodes words in address order", () => {
    expect(decodeWordsInAddressOrder("u16", "ABCD", [0x1234])).toEqual({
      ok: true,
      value: 0x1234,
      rawWords: [0x1234],
    });

    const notEnough = decodeWordsInAddressOrder("u32", "ABCD", [0x1234]);
    expect(notEnough.ok).toBe(false);

    const unsupported = decodeWordsInAddressOrder("foo", "ABCD", [0x1234]);
    expect(unsupported.ok).toBe(false);
  });
});
