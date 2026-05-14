import React from "react";
import { useHelp } from "../HelpProvider";
import type { HelpSectionSlug } from "../types";

type HelpAnchorLinkProps = {
  section: HelpSectionSlug;
  anchor?: string | null;
  children: React.ReactNode;
  variant?: "button" | "link";
};

export default function HelpAnchorLink({ section, anchor, children, variant = "button" }: HelpAnchorLinkProps): React.ReactElement {
  const { setHelpSection } = useHelp();

  if (variant === "link") {
    return (
      <button
        type="button"
        className="text-sm font-medium text-emerald-700 underline-offset-4 transition hover:text-emerald-800 hover:underline dark:text-emerald-300 dark:hover:text-emerald-200"
        onClick={() => setHelpSection(section, anchor ?? null)}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-full border border-emerald-600/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 dark:border-emerald-500/40 dark:text-emerald-100 dark:hover:border-emerald-400"
      onClick={() => setHelpSection(section, anchor ?? null)}
    >
      {children}
    </button>
  );
}
