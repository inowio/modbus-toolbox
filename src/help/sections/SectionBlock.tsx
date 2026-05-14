import React from "react";
import { getHelpAnchorDomId, type HelpAnchor, type HelpSectionDefinition } from "../types";

interface SectionBlockProps {
  section: HelpSectionDefinition["slug"];
  anchor: string;
  title: string;
  children: React.ReactNode;
  meta?: Partial<HelpAnchor>;
  actions?: React.ReactNode;
}

export default function SectionBlock({ section, anchor, title, children, meta, actions }: SectionBlockProps): React.ReactElement {
  return (
    <section
      id={getHelpAnchorDomId(section, anchor)}
      className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-black/5 dark:border-slate-800/80 dark:bg-slate-900/40 dark:shadow-black/40"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
          {meta?.description ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{meta.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide text-slate-400">
          {meta?.requires ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-900 dark:text-amber-100">
              Requires {meta.requires}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{children}</div>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
