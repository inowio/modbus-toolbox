import type { HelpSectionDefinition } from "./types";
import overviewSection from "./sections/overview";
import workspaceSection from "./sections/workspace";
import connectionSection from "./sections/connection";
import slavesSection from "./sections/slaves";
import analyzerSection from "./sections/analyzer";
import logsSection from "./sections/logs";
import settingsSection from "./sections/settings";

export const helpSections: HelpSectionDefinition[] = [
  overviewSection,
  workspaceSection,
  connectionSection,
  slavesSection,
  analyzerSection,
  logsSection,
  settingsSection,
];

export function getHelpSectionDefinitions(): HelpSectionDefinition[] {
  return helpSections;
}
