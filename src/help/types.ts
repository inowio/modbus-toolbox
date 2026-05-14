import React from "react";

export type HelpSectionSlug =
  | "overview"
  | "workspace"
  | "connection"
  | "slaves"
  | "analyzer"
  | "logs"
  | "settings";

export const DEFAULT_HELP_SECTION: HelpSectionSlug = "overview";

export type HelpAnchor = {
  id: string;
  label: string;
  description?: string;
  etaMinutes?: number;
  requires?: string;
};

export type HelpSectionDefinition = {
  slug: HelpSectionSlug;
  title: string;
  description: string;
  keywords: string[];
  searchText: string;
  anchors: HelpAnchor[];
  Component: () => React.ReactElement;
};

export type OpenHelpOptions = {
  section?: HelpSectionSlug;
  anchor?: string | null;
};

export function isHelpSectionSlug(value: string | null | undefined): value is HelpSectionSlug {
  return (
    value === "overview" ||
    value === "workspace" ||
    value === "connection" ||
    value === "slaves" ||
    value === "analyzer" ||
    value === "logs" ||
    value === "settings"
  );
}

export function getHelpAnchorDomId(section: HelpSectionSlug, anchorId: string): string {
  return `help-${section}-${anchorId}`;
}
