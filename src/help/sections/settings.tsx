import React from "react";
import SectionBlock from "./SectionBlock";
import type { HelpSectionDefinition } from "../types";

const settingsSection: HelpSectionDefinition = {
  slug: "settings",
  title: "Settings",
  description: "Workspace-level timeouts, retries, logging, and cleanup to keep communications reliable.",
  keywords: ["settings", "timeouts", "logging", "retries", "retention", "workspace"],
  searchText:
    "Settings covers logging levels, delete-log ranges, response/connect timeouts, retry attempts/delay, save behavior, practical configurations, best practices, and scope limitations.",
  anchors: [
    { id: "overview", label: "What is Settings?" },
    { id: "logging", label: "Logging" },
    { id: "delete-logs", label: "Delete logs" },
    { id: "timing", label: "Timing" },
    { id: "retry", label: "Retry" },
    { id: "save", label: "Save" },
    { id: "examples", label: "Examples" },
    { id: "best", label: "Best practices" },
    { id: "scope", label: "What it doesn’t change" },
    { id: "summary", label: "Summary" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="settings" anchor="overview" title="Workspace-scoped behavior">
        <p>
          The Settings screen tunes logging verbosity, communication timing, retry strategy, and log retention for the <strong>active workspace only</strong>.
          It doesn’t touch register maps or dashboards, but it directly impacts stability, performance, and diagnostics.
        </p>
      </SectionBlock>
      <SectionBlock section="settings" anchor="logging" title="Logging">
        <p>
          <strong>Minimum log level</strong> sets the lowest severity captured (Debug, Info, Warn, Error). Anything below the chosen level is ignored; higher levels always record.
        </p>
        <p className="text-sm text-slate-700 dark:text-slate-300">Suggested use: Info for normal operation, Debug during commissioning, Warn/Error for long-term production.</p>
      </SectionBlock>
      <SectionBlock section="settings" anchor="delete-logs" title="Delete logs">
        <p>
          Pick a range (e.g., Older than 6 months) to permanently remove historic logs for this workspace. The Delete button applies instantly—no undo, and other workspaces stay untouched.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Use to reduce storage, clear commissioning noise, or keep only relevant records.</li>
          <li>Raises a confirmation prompt so you understand the impact before erasing data.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="settings" anchor="timing" title="Timing controls">
        <p>
          <strong>Response Timeout (ms)</strong> defines how long the app waits for a slave reply before marking the request failed. Increase it for slow devices, noisy RS-485 buses, or high-latency links.</p>
        <p>
          <strong>Connect Timeout (ms)</strong> caps how long the client waits when establishing TCP sockets or opening serial ports. If exceeded, the connection attempt fails.
        </p>
      </SectionBlock>
      <SectionBlock section="settings" anchor="retry" title="Retry strategy">
        <p>
          <strong>Retries</strong> sets how many additional attempts follow a failure (e.g., 3 = initial + 3 retries). Higher counts improve resilience; lower counts keep the bus lean.</p>
        <p>
          <strong>Retry Delay (ms)</strong> inserts a pause between attempts to avoid re-flooding the bus. Example: 200 ms prevents hammering slow devices.</p>
      </SectionBlock>
      <SectionBlock section="settings" anchor="save" title="Saving changes">
        <p>
          The <strong>Save</strong> button persists all timing, retry, and logging adjustments for this workspace. Changes take effect immediately without restarting the app and do not affect other workspaces.
        </p>
      </SectionBlock>
      <SectionBlock section="settings" anchor="examples" title="Practical examples">
        <div className="grid gap-4 md:grid-cols-2 text-sm">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <p className="font-semibold text-slate-900 dark:text-white">Noisy RS-485 network</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Response Timeout: 2000 ms</li>
              <li>Retries: 5</li>
              <li>Retry Delay: 300 ms</li>
              <li>Log Level: Debug</li>
            </ul>
            <p className="mt-2 text-emerald-700 dark:text-emerald-300">Higher tolerance + better diagnostics during commissioning.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <p className="font-semibold text-slate-900 dark:text-white">Stable production system</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Response Timeout: 1000 ms</li>
              <li>Retries: 2</li>
              <li>Retry Delay: 200 ms</li>
              <li>Log Level: Warn</li>
            </ul>
            <p className="mt-2 text-emerald-700 dark:text-emerald-300">Clean logs, fast detection, minimal storage growth.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="settings" anchor="best" title="Best practices">
        <ul className="list-disc space-y-1 pl-5">
          <li>Tune timeouts before tweaking retries.</li>
          <li>Avoid ultra-short retry delays on RS-485 buses.</li>
          <li>Use Debug logging temporarily; drop to Info/Warn once stable.</li>
          <li>Schedule periodic log cleanup for long-running workspaces.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="settings" anchor="scope" title="What Settings does not change">
        <ul className="list-disc space-y-1 pl-5">
          <li>No effect on Modbus register definitions.</li>
          <li>Doesn’t alter Analyzer layouts or signal decoding.</li>
          <li>Changes aren’t global—every workspace keeps its own profile.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="settings" anchor="summary" title="Summary">
        <p>
          Settings fine-tune communication behavior, control diagnostic verbosity, and keep long-running projects healthy. It’s the difference between “it works” and “it works reliably.”
        </p>
      </SectionBlock>
    </div>
  ),
};

export default settingsSection;
