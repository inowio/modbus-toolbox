import { describe, expect, it } from "vitest";
import { getHelpAnchorDomId, isHelpSectionSlug } from "./types";

describe("help types", () => {
  it("checks valid help section slugs", () => {
    expect(isHelpSectionSlug("overview")).toBe(true);
    expect(isHelpSectionSlug("settings")).toBe(true);
    expect(isHelpSectionSlug("unknown")).toBe(false);
  });

  it("builds anchor dom ids", () => {
    expect(getHelpAnchorDomId("overview", "intro")).toBe("help-overview-intro");
  });
});
