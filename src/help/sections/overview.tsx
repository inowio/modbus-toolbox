import React from "react";
import SectionBlock from "./SectionBlock";
import HelpAnchorLink from "../components/HelpAnchorLink";
import type { HelpSectionDefinition } from "../types";

const overviewAnchors: HelpSectionDefinition["anchors"] = [
  {
    id: "hero",
    label: "What is Modbus Toolbox?",
    description: "High-level positioning plus key capabilities and example workflow.",
    etaMinutes: 2,
  },
  {
    id: "workflow",
    label: "Core workflow",
    description: "See how a workspace flows from setup to analyzer + logs.",
    etaMinutes: 2,
  },
  {
    id: "phases",
    label: "Product phases",
    description: "Detailed breakdown of Workspace, Connection, Slaves, Analyzer, Logs.",
    etaMinutes: 4,
  },
  {
    id: "scenario",
    label: "Pump station scenario",
    description: "Step-by-step example with Modbus TCP device.",
    etaMinutes: 2,
  },
  {
    id: "principles",
    label: "Design + best practices",
    description: "Guiding principles, naming, byte-order validation, logging habits.",
    etaMinutes: 2,
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting",
    description: "Common symptoms, likely causes, and quick fixes.",
    etaMinutes: 1,
  },
];

const overviewSection: HelpSectionDefinition = {
  slug: "overview",
  title: "Overview",
  description: "High-level tour of the Modbus toolbox, core workflow, guiding principles, and troubleshooting cues.",
  keywords: ["introduction", "workflow", "principles", "troubleshooting", "modbus"],
  searchText:
    "Understand what Modbus Toolbox does, see the Workspace → Connection → Slaves → Analyzer → Logs journey, review design principles, best practices, troubleshooting table, and a real-world pump station scenario.",
  anchors: overviewAnchors,
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock
        section="overview"
        anchor="hero"
        title="What Modbus Toolbox delivers"
        meta={overviewAnchors[0]}
        actions={
          <HelpAnchorLink section="workspace" anchor="details">
            Jump to workspace setup
          </HelpAnchorLink>
        }
      >
        <p>
          <strong>Modbus Toolbox</strong> is a client-side suite for testing, simulating, and monitoring industrial hardware over
          Modbus RTU or Modbus TCP. It replaces ad-hoc scripts with a visual workspace that keeps register definitions,
          analyzer layouts, and logs in one place so engineers can diagnose field issues quickly.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Visual interface for device interaction without writing test harnesses.</li>
          <li>Central register catalog reused across connections, slaves, and analyzer tiles.</li>
          <li>Real-time polling with decoded + raw values to validate scaling and byte order.</li>
          <li>Structured logging for exportable diagnostics when something misbehaves.</li>
        </ul>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800/60 dark:bg-slate-900/30">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Example workflow</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Define registers once when configuring a slave.</li>
            <li>Connect over serial (RTU) or Ethernet (TCP) using workspace-level settings.</li>
            <li>Watch live data through Analyzer tiles that reuse those registers.</li>
            <li>Troubleshoot with timestamped Modbus logs.</li>
          </ol>
        </div>
      </SectionBlock>
      <SectionBlock
        section="overview"
        anchor="workflow"
        title="Core application workflow"
        meta={overviewAnchors[1]}
        actions={
          <HelpAnchorLink section="logs" anchor="workspace" variant="link">
            Review workspace logs
          </HelpAnchorLink>
        }
      >
        <p>The app walks you through a linear-but-repeatable journey:</p>
        <div className="grid gap-3 md:grid-cols-5">
          {["Workspace", "Connection", "Slaves", "Analyzer", "Logs"].map((phase, index) => (
            <div
              key={phase}
              className="rounded-xl border border-slate-200 bg-white p-3 text-center text-sm text-slate-700 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:text-slate-200 dark:shadow-black/0"
            >
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Step {index + 1}</p>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white">{phase}</p>
            </div>
          ))}
        </div>
        <p>
          Use the header Help button or any inline “?” chip to open this modal. Deep-linking keeps the browser URL in sync via
          <code className="mx-1 rounded-sm bg-slate-200 px-1 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100">?help=&lt;section&gt;&amp;helpAnchor=&lt;topic&gt;</code>, making it easy to
          share exact instructions with teammates or in commissioning checklists.
        </p>
      </SectionBlock>
      <SectionBlock
        section="overview"
        anchor="phases"
        title="Phase-by-phase highlights"
        meta={overviewAnchors[2]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">1. Workspace</h3>
            <p>Represents a physical setup (machine, production line, test bench).</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Stores connection, slaves, register definitions, analyzer layouts, and logs.</li>
              <li>Example: <code>Pump_Station_3</code> holds everything for one treatment station.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">2. Connection</h3>
            <p>Single configuration per workspace for how Modbus comms occur.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>RTU</strong>: port, baud rate, parity (<code>/dev/ttyUSB0 @ 9600 8N1</code>).
              </li>
              <li>
                <strong>TCP</strong>: host and port (<code>192.168.1.100:502</code>).
              </li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">3. Slaves</h3>
            <p>Models each Modbus device with IDs, register maps, polling intervals, and byte order rules.</p>
            <pre className="mt-3 overflow-auto rounded-lg border border-slate-200 bg-white/60 p-3 text-xs text-slate-900 dark:border-slate-800/60 dark:bg-slate-950/70 dark:text-slate-200">
{`slave_id: 5
device_type: Temperature Controller
registers:
  - address: 30001
    name: Setpoint
    type: float32
    byte_order: big-endian
  - address: 30003
    name: Current Temp
    type: float32`}
            </pre>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">4. Analyzer</h3>
            <p>Live dashboards for polling registers, validating values, and writing overrides.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Displays raw + decoded values with byte-order awareness.</li>
              <li>Visual indicators for errors and write confirmation prompts.</li>
              <li>Example: track pressure (40001) and flow (40003) every 2 s.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 md:col-span-2 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">5. Logs</h3>
            <p>Chronological trace of every Modbus exchange for diagnostics and audits.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Includes timestamps, function codes, responses, and decoded human values.</li>
              <li>Export or copy snippets when collaborating with field engineers.</li>
            </ul>
            <pre className="mt-3 overflow-auto rounded-lg border border-slate-200 bg-white/60 p-3 text-xs text-slate-900 dark:border-slate-800/60 dark:bg-slate-950/70 dark:text-slate-200">
{`[2023-10-15 14:23:45] TX → Slave 1: Read Holding Registers (40001-40002)
[2023-10-15 14:23:45] RX ← Slave 1: [2456, 1890] → 42.5°C`}
            </pre>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock
        section="overview"
        anchor="scenario"
        title="Practical example: Pump station"
        meta={overviewAnchors[3]}
      >
        <p>Use this scenario as a template when onboarding a new site:</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Create workspace <code>Pump_Station_5</code> to isolate assets for that facility.
          </li>
          <li>
            Configure Modbus TCP connection: host <code>192.168.1.50</code>, port <code>502</code>.
          </li>
          <li>Add slave with ID <code>1</code> representing the combined temperature/pressure controller.</li>
          <li>
            Define registers <code>40001</code> (Temperature, float32, big-endian) and <code>40003</code> (Pressure, float32,
            big-endian).
          </li>
          <li>Start Analyzer polling to watch values update in real time without writing code.</li>
        </ol>
        <p>
          The end result is a repeatable monitoring package you can clone for each pump line—just update host addresses and
          slave IDs.
        </p>
      </SectionBlock>
      <SectionBlock
        section="overview"
        anchor="principles"
        title="Design principles & best practices"
        meta={overviewAnchors[4]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Design principles</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Explicit configuration—no hidden defaults; everything is inspectable.</li>
              <li>Single source of truth—register definitions propagate to all surfaces.</li>
              <li>Safe operations—writes and destructive actions have warnings + confirms.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Best practices</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Use descriptive names (e.g., <code>VFD_Line1_Pump</code> vs. <code>Slave3</code>).</li>
              <li>Validate byte order with known-good readings before scaling up.</li>
              <li>Configure incrementally—connection first, then slaves, then analyzer.</li>
              <li>Review logs at the first hint of timeouts or unexpected values.</li>
            </ul>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock
        section="overview"
        anchor="troubleshooting"
        title="Troubleshooting quick reference"
        meta={overviewAnchors[5]}
        actions={
          <HelpAnchorLink section="logs" anchor="analysis">
            Dive into log analysis
          </HelpAnchorLink>
        }
      >
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/30 dark:shadow-black/0">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead>
              <tr className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-950/50 dark:text-slate-400">
                <th className="px-4 py-3">Symptom</th>
                <th className="px-4 py-3">Possible cause</th>
                <th className="px-4 py-3">Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              <tr>
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">Timeout</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">Wrong IP/port or cabling issues.</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">Verify connection parameters and inspect physical wiring.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">Invalid data</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">Byte-order mismatch or wrong data type selected.</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">Re-check register definition and test with known reference values.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">No response</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">Incorrect slave ID or device offline.</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">Confirm slave ID (1–247) and verify device power/status.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          When an issue persists, export the Logs panel and attach it to your ticket—the decoded values plus raw frames make it
          easy for peers to reproduce or advise remotely.
        </p>
      </SectionBlock>
    </div>
  ),
};

export default overviewSection;
