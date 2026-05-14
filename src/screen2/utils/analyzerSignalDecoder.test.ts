import { describe, expect, it } from "vitest";
import {
  decodeAnalyzerSignal,
  parseAnalyzerDecoderConfig,
  parseAnalyzerRawSnapshotFromJson,
} from "./analyzerSignalDecoder";

describe("analyzerSignalDecoder", () => {
  it("parses raw snapshots from JSON", () => {
    expect(parseAnalyzerRawSnapshotFromJson(null)).toBeNull();
    expect(parseAnalyzerRawSnapshotFromJson("not-json")).toBeNull();
    expect(parseAnalyzerRawSnapshotFromJson('{"rawWords":[1,2]}')).toEqual({ rawWords: [1, 2] });
    expect(parseAnalyzerRawSnapshotFromJson('{"rawBools":[true,false]}')).toEqual({ rawBools: [true, false] });
    expect(parseAnalyzerRawSnapshotFromJson('{"rawWords":["x"]}')).toBeNull();
  });

  it("parses decoder config with numeric fields", () => {
    expect(parseAnalyzerDecoderConfig(null)).toEqual({});
    const cfg = parseAnalyzerDecoderConfig('{"bit":2,"scale":2.5,"offset":1,"decimals":2,"unit":"V"}');
    expect(cfg).toEqual({ bit: 2, scale: 2.5, offset: 1, decimals: 2, unit: "V" });
  });

  it("returns formatted errors for non-ok states", () => {
    const res = decodeAnalyzerSignal({
      state: "DISCONNECTED",
      functionCode: 3,
      dataType: "u16",
      order: "ABCD",
      displayFormat: "dec",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.formatted).toBe("Disconnected");
    }
  });

  it("decodes raw boolean snapshots", () => {
    const res = decodeAnalyzerSignal({
      state: "OK",
      rawBools: [true, false],
      functionCode: 1,
      dataType: "bool",
      order: "ABCD",
      displayFormat: "dec",
      decoderJson: '{"bit":1}',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.formatted).toBe("0");
    }
  });

  it("decodes raw words with transforms", () => {
    const res = decodeAnalyzerSignal({
      state: "OK",
      rawWords: [10],
      functionCode: 3,
      dataType: "u16",
      order: "ABCD",
      displayFormat: "dec",
      decoderJson: '{"scale":2,"offset":1,"decimals":1}',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.formatted).toBe("21.0");
    }
  });

  it("returns errors when no data is available", () => {
    const res = decodeAnalyzerSignal({
      state: "OK",
      rawWords: [],
      functionCode: 3,
      dataType: "u16",
      order: "ABCD",
      displayFormat: "dec",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("No data");
    }
  });
});
