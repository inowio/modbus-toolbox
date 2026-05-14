import React from "react";
import SectionBlock from "./SectionBlock";
import type { HelpSectionDefinition } from "../types";

const slavesSection: HelpSectionDefinition = {
  slug: "slaves",
  title: "Slaves & Registers",
  description:
    "Manage the device list, dive into a single slave, and master register reads/writes—including mask write and safety workflows.",
  keywords: [
    "slaves",
    "registers",
    "unit id",
    "polling",
    "mask write",
    "scan",
    "attachments",
    "read after write",
  ],
  searchText:
    "Learn how to maintain the slaves list, open slave detail, configure connections, poll intervals, register selector, toolbar actions, register rows, mask write, row actions, read-after-write, attachments, switching behavior, address format, and safety rules.",
  anchors: [
    { id: "list-overview", label: "Slaves list overview" },
    { id: "list-layout", label: "List layout" },
    { id: "list-header", label: "Header actions" },
    { id: "list-search", label: "Search & filter" },
    { id: "list-rows", label: "Row metadata" },
    { id: "list-actions", label: "Per-slave actions" },
    { id: "list-dialogs", label: "Add / edit / delete" },
    { id: "list-best", label: "List best practices" },
    { id: "list-scope", label: "List scope" },
    { id: "detail-purpose", label: "Slave detail purpose" },
    { id: "detail-layout", label: "Detail layout" },
    { id: "detail-connection", label: "Connection card" },
    { id: "detail-identity", label: "Identity & poll" },
    { id: "detail-registers", label: "Registers card" },
    { id: "detail-toolbar", label: "Detail toolbar" },
    { id: "detail-table", label: "Register table" },
    { id: "detail-mask", label: "Mask write" },
    { id: "detail-read-after", label: "Read after write" },
    { id: "detail-attachments", label: "Attachments" },
    { id: "registers-read", label: "Read register types" },
    { id: "registers-write", label: "Write register types" },
    { id: "registers-mask", label: "Mask write math" },
    { id: "registers-switching", label: "Switching behavior" },
    { id: "registers-address", label: "Address format" },
    { id: "registers-actions", label: "Register toolbar" },
    { id: "registers-rows", label: "Row anatomy" },
    { id: "registers-value-details", label: "Value details" },
    { id: "registers-row-actions", label: "Row actions" },
    { id: "registers-safety", label: "Safety rules" },
    { id: "summary", label: "Summary" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="slaves" anchor="list-overview" title="Slaves list overview">
        <p>
          The Slaves page is your workspace inventory of Modbus devices. Each row represents one physical or logical device referenced by its Unit ID. Changes are scoped to the current workspace so multi-team setups stay isolated.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="list-layout" title="List layout">
        <p>The page flows from top to bottom:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Header + quick actions (Add, Refresh)</li>
          <li>Search field</li>
          <li>Device cards</li>
          <li>Inline actions per slave</li>
        </ol>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="list-header" title="Header actions">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>+ Add</strong> — register a new Unit ID with a descriptive name.</li>
          <li><strong>Refresh</strong> — reload after teammates change the list or after imports.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="list-search" title="Search & filter">
        <p>
          Filters live by name or Unit ID instantly (typing <code>2</code> finds Unit 2; typing <code>SHT</code> matches SHT20/30). Search never mutates data—it only narrows the visible set.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="list-rows" title="Row metadata">
        <p>Each card highlights:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>UNIT-ID X · Name</strong> — identity plus friendly label.</li>
          <li><strong>Created / Updated</strong> — timestamps for auditing stale entries.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="list-actions" title="Per-slave actions">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Open</strong> — jump into the Slave Detail workspace to configure registers, poll, or write.</li>
          <li><strong>Edit</strong> — rename or adjust Unit ID (duplicates allowed for different connection types).</li>
          <li><strong>Delete</strong> — remove the definition (never touches hardware, confirmation required).</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="list-dialogs" title="Add / edit / delete">
        <p>
          Add and Edit dialogs share the same fields (name + Unit ID). Choose descriptive names such as <code>Energy-Meter-Line-A</code>; they show up across Analyzer, Logs, and Signals. Delete dialogs reiterate the Unit ID so you do not remove the wrong device.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="list-best" title="List best practices">
        <ul className="list-disc space-y-1 pl-5">
          <li>One slave equals one device. Do not overload Unit IDs.</li>
          <li>Confirm Unit IDs on the actual bus before adding to avoid collisions.</li>
          <li>Keep names meaningful—future Analyzer tiles and logs depend on them.</li>
          <li>Refresh after bulk edits or imports to stay in sync with teammates.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="list-scope" title="List scope">
        <p>
          The list is intentionally shallow: it does not poll, write, or show register values. Click <strong>Open</strong> on a row to enter the richer Slave Detail workspace for that Unit ID.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-purpose" title="Slave detail purpose">
        <p>
          Slave Detail is the playground for a single device. Configure how it connects, curate register rows, read/poll, issue writes, inspect bytes, and attach documentation without impacting other slaves.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-layout" title="Detail layout">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Header with Back, Save, Refresh</li>
          <li>Connection card (status + configure)</li>
          <li>Identity & poll interval</li>
          <li>Read/Write Registers card (selector, toolbar, table)</li>
          <li>Attachments</li>
        </ol>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-connection" title="Connection card">
        <p>
          Shows current status (Connected/Disconnected) and lets you switch between TCP and RTU. <strong>Configure</strong> opens the workspace-wide Connection Settings modal; changes cascade to all slaves. <strong>Connect/Disconnect</strong> give intentional control so you do not accidentally poll live hardware.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-identity" title="Identity & poll interval">
        <p>
          Unit ID and base address display for reference (edit Unit IDs from the list to keep governance centralized). The Poll Interval (ms) defines how the Poll button and Analyzer signals pace their reads—fast loops (~500 ms) vs. slow sensors (~5000 ms).
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-registers" title="Registers card & selector">
        <p>
          The selector isolates Modbus function codes so each set of registers/coils lives in its own context:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Read</strong>: Coils (0x01), Discrete Inputs (0x02), Holding (0x03), Input (0x04).</li>
          <li><strong>Write</strong>: Single Coil (0x05), Single Register (0x06), Multiple Coils (0x0F), Multiple Registers (0x10).</li>
          <li><strong>Mask</strong>: Mask Write Register (0x16) for bit-level control words.</li>
        </ul>
        <p>Switching types clears unsaved rows and loads the saved set for that function—preventing cross-contamination between read/write operations. Address format (Dec / Hex) only changes how you type values.</p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-toolbar" title="Detail toolbar actions">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Read All</strong> — single-shot read of every row.</li>
          <li><strong>Poll</strong> — continuous reads with status chips (Not polling / Updated / OK / Bad / Err). Cycles never overlap.</li>
          <li><strong>Scan & Add</strong> (read types) — discover unknown maps using Start, Quantity, Stop-after-illegal. Adds only valid addresses.</li>
          <li><strong>Add Row</strong> — manual entry for known addresses, write-only rows, or mask-write prep.</li>
          <li><strong>Write All</strong> — executes batch writes for 0x0F/0x10 when you explicitly trigger it.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-table" title="Register table columns">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Local Address</strong> — base-relative (0-based) address aligned with the datasheet.</li>
          <li><strong>Alias</strong> — friendly label reused by Analyzer, Logs, Signals.</li>
          <li><strong>Data Type</strong> — drives register count and decode logic (u16/i16, i32/u32, f32/f64, etc.).</li>
          <li><strong>Byte Order</strong> — ABCD/BADC/CDAB/DCBA + swap combos to fix vendor endianness.</li>
          <li><strong>Value Format</strong> — Dec / Hex / Binary / ASCII for display only.</li>
          <li><strong>Read Value</strong> — live reading (read types); click to open Register Value Details.</li>
          <li><strong>Value to Write</strong> — editable for write functions.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-mask" title="Mask write (workflow)">
        <p>
          Mask Write rows expose Address, AND mask, and OR mask. Devices apply <code>(current AND AND_mask) OR OR_mask</code>, letting you toggle individual bits in a control word without touching others—perfect for PLC command flags.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-read-after" title="Read after write toggle">
        <p>
          Enable during commissioning so every write is immediately followed by a read. You instantly know whether the slave accepted the value, plus you validate scaling and byte order.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="detail-attachments" title="Attachments">
        <p>
          Upload datasheets, wiring diagrams, PDFs, or notes directly to the slave. Everything stays scoped to that Unit ID so technicians always have reference material beside the configuration.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-read" title="Read register types (deeper dive)">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Read Coils (0x01)</h3>
            <p>Digital outputs (ON/OFF). Example: <code>Motor_Run</code> at address 0 returns 0 or 1. Never expect numeric words—coils are bits.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Read Discrete Inputs (0x02)</h3>
            <p>Read-only digital inputs such as limit switches or push buttons. Writes are invalid.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Read Holding Registers (0x03)</h3>
            <p>Read/write registers for setpoints, counters, configs. Always verify scaling and byte order.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Read Input Registers (0x04)</h3>
            <p>Read-only analog values (temperature, energy). Do not attempt writes.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-write" title="Write register types">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Write Single Coil (0x05)</strong> — toggle one bit (e.g., start pump). Avoid rapid loops.</li>
          <li><strong>Write Single Register (0x06)</strong> — push a single 16-bit value (speed reference). Confirm signedness.</li>
          <li><strong>Write Multiple Coils (0x0F)</strong> — batch coils; only group related outputs.</li>
          <li><strong>Write Multiple Registers (0x10)</strong> — batch words; match data type to register count and byte order.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-mask" title="Mask write math">
        <p>Mask write modifies specific bits without touching others—ideal for control words or PLC command flags.</p>
        <pre className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900 dark:border-slate-800/60 dark:bg-slate-900/20 dark:text-slate-100">NewValue = (CurrentValue AND AND_mask) OR OR_mask</pre>
        <p>Example: set bit 4 on, leave others untouched.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>AND mask <code>0xFFEF</code> clears bit 4.</li>
          <li>OR mask <code>0x0010</code> sets bit 4.</li>
          <li>Result: only bit 4 changes.</li>
        </ul>
        <p className="text-xs text-amber-800 dark:text-amber-300">Do not use mask write if you are unsure of the bit layout.</p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-switching" title="Switching behavior">
        <p>
          Changing register types swaps the dataset, loads saved rows for that type, and clears unsaved edits. This prevents accidental writes, keeps incompatible operations apart, and is by design.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-address" title="Address format (Dec / Hex)">
        <p>
          Choose whichever matches your datasheet. <code>100</code> (Dec) equals <code>0x64</code> (Hex); only the input UI changes. Internal Modbus requests remain the same.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-actions" title="Register toolbar (quick reference)">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Read All</h3>
            <p>Single-shot verification. Use it to confirm connectivity without continuous polling.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Poll</h3>
            <p>Continuous reads paced by Poll Interval with status indicators. Do not poll huge ranges or write-only registers.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Scan & Add</h3>
            <p>For read types only. Fields: Start, Quantity, Stop-after-illegal. Sequential scan adds valid addresses and skips duplicates.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Add Row & Write All</h3>
            <p>Add Row handles manual or write-only entries. Write All pushes a deliberate batch for 0x0F/0x10—never mix unrelated registers.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-rows" title="Register row anatomy">
        <p>Each row equals a logical Modbus item:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Local Address</strong> — matches device docs.</li>
          <li><strong>Alias</strong> — meaningful label reused everywhere.</li>
          <li><strong>Data Type</strong> — controls register count and decode.</li>
          <li><strong>Byte Order</strong> — golden rule: if the value looks wrong, byte order probably is.</li>
          <li><strong>Value Format</strong> — Dec/Hex/Binary/ASCII for display only.</li>
          <li><strong>Read Value</strong> — live data; click for details.</li>
          <li><strong>Value to Write</strong> — available for write-capable functions; double-check before sending.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-value-details" title="Register value details modal">
        <p>
          Clicking a Read Value opens the debugging microscope: raw hex, individual bytes, applied decoder, and the final value. Use it when numbers look off, byte order is unknown, or floats refuse to decode.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-row-actions" title="Row-level actions">
        <p>
          Rows include delete and per-row write (for single write functions). Combine with Add Row to stage mask-write entries or rapid spot checks without affecting the rest of the table.
        </p>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="registers-safety" title="Safety rules">
        <ul className="list-disc space-y-1 pl-5">
          <li>Reads are safe; polling is rate-limited by your interval.</li>
          <li>Writes (Single, Multiple, Mask) only fire when you explicitly click Write All or per-row write.</li>
          <li>Mask Write is powerful—verify AND/OR masks twice before sending.</li>
          <li>Byte order mistakes are common; rely on Register Value Details instead of guesswork.</li>
          <li>Never assume datasheets are perfect—trust what the device returns.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="slaves" anchor="summary" title="Summary">
        <p>
          Use Slaves & Registers as a continuum: maintain the workspace inventory, open a slave to configure connections and polling, then refine register definitions (reads, writes, mask writes) with the built-in safeguards like Read After Write and the value microscope. Everything you need to commission or troubleshoot a Modbus device now lives in one place.
        </p>
      </SectionBlock>
    </div>
  ),
};

export default slavesSection;
