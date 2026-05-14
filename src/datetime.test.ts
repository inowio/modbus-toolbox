import { describe, expect, it } from "vitest";
import { formatLocalDateTime } from "./datetime";

describe("formatLocalDateTime", () => {
  it("returns empty string for nullish input", () => {
    expect(formatLocalDateTime(null)).toBe("");
    expect(formatLocalDateTime(undefined)).toBe("");
  });

  it("returns original value for invalid dates", () => {
    expect(formatLocalDateTime("not-a-date")).toBe("not-a-date");
  });

  it("formats valid ISO strings with date and time", () => {
    const value = formatLocalDateTime("2024-01-02T03:04:05.000Z");
    expect(value).not.toBe("");
    expect(value).toContain("2024");
    expect(value).toContain(":");
  });
});
