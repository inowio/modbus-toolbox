import React from "react";
import SectionBlock from "./SectionBlock";
import type { HelpSectionDefinition } from "../types";

const logsSection: HelpSectionDefinition = {
  slug: "logs",
  title: "Logs",
  description: "Understand workspace vs app logs, filtering, and when to use each diagnostic view.",
  keywords: ["logs", "workspace", "app", "filters", "traffic"],
  searchText:
    "Logs screen explains workspace logs, app logs, columns, severity filter, search, expand/collapse behavior, how logs differ from Traffic Monitor, and practical troubleshooting scenarios.",
  anchors: [
    { id: "overview", label: "What is the Logs screen?" },
    { id: "types", label: "Log types" },
    { id: "columns", label: "Columns" },
    { id: "filters", label: "Filters & controls" },
    { id: "layout", label: "Expand / collapse" },
    { id: "vs-traffic", label: "Logs vs Traffic Monitor" },
    { id: "examples", label: "Practical examples" },
    { id: "scope", label: "What logs do not do" },
    { id: "summary", label: "Summary" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="logs" anchor="overview" title="Why logs matter">
        <p>
          The Logs screen answers “what just happened?” by listing chronological events for the current workspace (and application lifecycle). Entries are read-only, safe to inspect anytime, and scoped per workspace so noise stays contained.
        </p>
      </SectionBlock>
      <SectionBlock section="logs" anchor="types" title="Log types">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Workspace logs</h3>
            <p>Track workspace-specific activity: settings changes, polling start/stop, connection saves, slave read/write failures, Analyzer listeners, etc.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">App logs</h3>
            <p>Capture lifecycle events like app start, workspace load, navigation. Useful before a workspace opens or when auditing overall usage.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="logs" anchor="columns" title="Log table columns">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Time</strong> – exact timestamp; align with external systems or understand ordering.</li>
          <li><strong>Level</strong> – severity (INFO, ERROR, etc.).</li>
          <li><strong>Message</strong> – human description (e.g., “Polling started”, “Read registers failed”).</li>
          <li><strong>Source</strong> – module or screen triggering the event (connection, settings, AnalyzerPage, workspace/get, etc.).</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="logs" anchor="filters" title="Filters & controls">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Min level</strong> dropdown shows only logs at/above the selected severity (Info, Warn, Error). Lower levels are hidden, not deleted.</li>
          <li><strong>Search</strong> filters message or source in real time—type partial text ("poll", "connection") to isolate a workflow.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="logs" anchor="layout" title="Expand / collapse">
        <p>
          The log drawer can expand to take over the lower viewport or collapse into a slim bar. This lets you monitor logs while configuring slaves, Analyzer, or settings without leaving the page, then tuck them away when focus shifts.
        </p>
      </SectionBlock>
      <SectionBlock section="logs" anchor="vs-traffic" title="Logs vs Traffic Monitor">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs text-slate-700 dark:divide-slate-800 dark:text-slate-300">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-950/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Feature</th>
                <th className="px-3 py-2">Logs</th>
                <th className="px-3 py-2">Traffic Monitor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              <tr>
                <td className="px-3 py-2">High-level events</td>
                <td className="px-3 py-2">✅</td>
                <td className="px-3 py-2">❌</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Workspace/app actions</td>
                <td className="px-3 py-2">✅</td>
                <td className="px-3 py-2">❌</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Raw Modbus frames</td>
                <td className="px-3 py-2">❌</td>
                <td className="px-3 py-2">✅</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Byte-level inspection</td>
                <td className="px-3 py-2">❌</td>
                <td className="px-3 py-2">✅</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">If something failed, start with Logs. If the frame looks wrong on the wire, open Traffic Monitor. Together they tell the full story.</p>
      </SectionBlock>
      <SectionBlock section="logs" anchor="examples" title="Practical examples">
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li><strong>Polling not updating:</strong> Check workspace logs for “Polling started” or “Read registers failed”.</li>
          <li><strong>Unexpected app restart:</strong> App logs show “App started” and “Loaded workspace” to confirm timing.</li>
          <li><strong>Configuration audit:</strong> Workspace logs record who changed settings and when.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="logs" anchor="scope" title="What logs do not do">
        <ul className="list-disc space-y-1 pl-5">
          <li>They never modify device state.</li>
          <li>They cannot replay actions.</li>
          <li>They do not replace Traffic Monitor for byte-level debugging.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="logs" anchor="summary" title="Summary">
        <p>
          Logs provide operational transparency, separating workspace behavior from app lifecycle so you can debug without guessing. When in doubt, open Logs to see what just happened.
        </p>
      </SectionBlock>
    </div>
  ),
};

export default logsSection;
