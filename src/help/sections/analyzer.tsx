import React from "react";
import SectionBlock from "./SectionBlock";
import type { HelpSectionDefinition } from "../types";

const analyzerSection: HelpSectionDefinition = {
  slug: "analyzer",
  title: "Analyzer",
  description: "Turn raw Modbus registers into reusable signals and visualize them as value or trend tiles.",
  keywords: [
    "analyzer",
    "signals",
    "tiles",
    "trend",
    "decoder",
    "poll interval",
    "value tile",
    "chart",
  ],
  searchText:
    "Analyzer pipeline Register → Signal → Tile. Learn screen controls, how to define signals, configure decoders (unit, scale, offset, bit, clamp), manage poll intervals, add tiles (value/trend), use tile menus, run/stop polling, avoid anti-patterns, and follow real-world examples.",
  anchors: [
    { id: "overview", label: "Register → Signal → Tile" },
    { id: "controls", label: "Screen controls" },
    { id: "signal-definition", label: "Signals (concept)" },
    { id: "signal-list", label: "Signal list & reuse" },
    { id: "create-signal", label: "Create / edit signal" },
    { id: "signal-decoder", label: "Decoder configuration" },
    { id: "poll-delete", label: "Poll interval & delete" },
    { id: "tiles", label: "Tiles" },
    { id: "tile-types", label: "Tile types" },
    { id: "add-tile", label: "Add tile" },
    { id: "tile-menu", label: "Tile menu" },
    { id: "run-stop", label: "Run / Stop" },
    { id: "examples", label: "Examples" },
    { id: "anti-patterns", label: "What not to do" },
    { id: "mental-model", label: "Mental model" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="analyzer" anchor="overview" title="Why Analyzer matters">
        <p>
          Analyzer is the live dashboard where the pipeline <strong>Register → Signal → Tile</strong> plays out. Registers provide raw bytes, <strong>Signals</strong> decode those bytes into engineering values, and <strong>Tiles</strong> decide how the value is visualized. Keep the layers separate: signals are data contracts, tiles are UI.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="controls" title="Screen controls">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Trends to show</h3>
            <p>Limits the historical window (Last 1/5/10/30/60 min or All) for every trend tile. Only the on-screen history changes—the Modbus reads do not.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Run</h3>
            <p>Starts/stops Analyzer-wide polling while respecting each signal’s poll interval. Stopped dashboards label tiles as <em>Stopped</em>.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Edit layout</h3>
            <p>Drag and resize tiles to group by equipment, enlarge important trends, or prioritize alarms.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Options menu</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong>Configure Signals</strong> – open the signal panel.</li>
              <li><strong>Add Tile</strong> – add value or trend tiles.</li>
              <li><strong>Connection Settings</strong> – adjust RTU/TCP parameters without leaving Analyzer.</li>
              <li><strong>Refresh</strong> – reload layout after structural changes.</li>
            </ul>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="signal-definition" title="Signals — what they are">
        <p>
          A signal is the semantic definition of a register: it answers <em>what the value means, how to decode it, what unit it uses, and how fast it should update</em>. It is not a tile or a chart. Configure signals once and reuse them everywhere.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="signal-list" title="Signal list & reuse">
        <p>The Signals panel lists every configured signal with:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Name</li>
          <li>Slave reference and register type</li>
          <li>Register address</li>
          <li>Status indicator (green healthy, red error)</li>
        </ul>
        <p className="mt-3">Typical reuse targets: value tiles, trend charts, logs, future alarms/analytics.</p>
        <pre className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 dark:border-slate-800/60 dark:bg-slate-900/40 dark:text-slate-100">
Signal name: temp_inlet
Slave: TCP-Simulator (Unit 2)
Register type: Read Input Registers (0x04)
Address: 0
        </pre>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="create-signal" title="Create / edit signal">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Options → <strong>Configure Signals</strong> → <strong>Add Signal</strong>.</li>
          <li>Select the <strong>Slave</strong>, <strong>Register type</strong>, and <strong>Register address</strong>.</li>
          <li>Provide a unique <strong>Signal ID</strong> plus decoder settings (below).</li>
          <li>Save. Duplicate combinations of (Slave + Register type + Address) are blocked intentionally.</li>
        </ol>
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">Editing follows the same dialog. Deleting removes the signal from the list and automatically unlinks any tiles that referenced it.</p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="signal-decoder" title="Signal decoder configuration">
        <p>Decoder fields convert raw registers into engineering truth:</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Unit</strong> – text label such as °C, V, %, bar.</li>
              <li><strong>Scale</strong> – multiplier; raw 268 × 0.1 = 26.8 °C.</li>
              <li><strong>Offset</strong> – applied after scaling, e.g., subtract 40 for RTD sensors.</li>
              <li><strong>Decimals</strong> – presentation precision only.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Clamp min/max</strong> – clip noisy spikes (e.g., -40 to 150).</li>
              <li><strong>Bit (0–63)</strong> – extract a single bit for alarms/flags.</li>
              <li><strong>Formula</strong> – <code>(raw × scale) + offset</code> before clamping.</li>
            </ul>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="poll-delete" title="Poll interval & deleting signals">
        <p>
          Each signal can override its poll interval (e.g., 500 ms for fast loops, 5000 ms for slow sensors). Analyzer respects these intervals even when multiple signals live on the same tile layout.
        </p>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Deleting a signal removes it from the workspace and automatically detaches it from any tiles—no orphaned bindings remain.</p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="tiles" title="Tiles">
        <p>
          Tiles are pure views. Each tile references exactly one primary signal and inherits its decoder, units, and poll cadence. Use them to spotlight key KPIs or trends without duplicating signal logic.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="tile-types" title="Tile types">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Value tile</h3>
            <p>Shows the latest value, its unit, and state (Running / Stopped). Ideal for temperatures, pressures, setpoints, or digital flags.</p>
            <pre className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 dark:border-slate-800/60 dark:bg-slate-950/40 dark:text-slate-100">Temp
VALUE
26.80 °C</pre>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Trend chart</h3>
            <p>Plots historical samples (time on X, value on Y) and updates as polling runs. Perfect for drift detection, oscillations, and stability analysis.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="add-tile" title="Adding a tile">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Options → <strong>Add Tile</strong>.</li>
          <li>Choose tile type (Value or Trend).</li>
          <li>Select the <strong>Primary signal</strong> (required) and optionally override the title.</li>
          <li>Click <strong>Add</strong>; the tile appears immediately and reflects live signal state.</li>
        </ol>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="tile-menu" title="Tile menu">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Disable Polling</strong> – pauses only this tile’s signal binding, marking it as <em>Disabled</em>.</li>
          <li><strong>Information</strong> – quick reference for slave, register, decoder, and poll interval.</li>
          <li><strong>Edit</strong> – change the title or rebind to another signal without touching the signal itself.</li>
          <li><strong>Delete</strong> – removes the tile; the signal remains available.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="run-stop" title="Run / Stop Analyzer">
        <p>
          The Run toggle starts polling for all active tiles, observes per-signal intervals, and never overlaps poll cycles—Analyzer waits for each round-trip to finish to avoid flooding Modbus devices. Stop halts everything immediately.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="examples" title="Real-world example">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800/60 dark:bg-slate-900/20 dark:text-slate-300">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">Classic temperature loop</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Register: Input Register 0 returns 268.</li>
              <li>Decoder: data type i16, scale 0.1, unit °C → final value 26.8 °C.</li>
              <li>Tiles: value tile for live reading, trend chart for history.</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">Digital status from packed bits</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Add signal to the register carrying flags.</li>
              <li>Set <strong>Bit (0–63)</strong> to the alarm bit (e.g., bit 4).</li>
              <li>Add a value tile to display 0/1 state instantly.</li>
            </ol>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="anti-patterns" title="What not to do">
        <ul className="list-disc space-y-1 pl-5">
          <li>❌ Create multiple signals for the same register – reuse signals; tiles exist for visualization.</li>
          <li>❌ Apply scaling inside tiles – scaling belongs in the signal decoder.</li>
          <li>❌ Poll too fast – start around 1000&nbsp;ms; many devices lock up when spammed.</li>
          <li>❌ Guess byte order – verify with Register Value Details and raw bytes.</li>
          <li>❌ Use trend charts for booleans – value tiles suit discrete states.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="mental-model" title="Mental model">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Slaves</strong> define where data originates.</li>
          <li><strong>Registers</strong> define what raw data exists.</li>
          <li><strong>Signals</strong> define meaning and math.</li>
          <li><strong>Tiles</strong> define visibility and UI.</li>
        </ul>
      </SectionBlock>
    </div>
  ),
};

export default analyzerSection;
