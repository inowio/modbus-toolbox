import React from "react";
import SectionBlock from "./SectionBlock";
import type { HelpSectionDefinition } from "../types";

const connectionSection: HelpSectionDefinition = {
  slug: "connection",
  title: "Connection",
  description: "Define how Modbus Toolbox reaches your devices—RTU, TCP, testing, inheritance, and best practices.",
  keywords: ["connection", "rtu", "tcp", "serial", "test", "inheritance", "examples"],
  searchText:
    "Connection screen sets the workspace-wide transport. Learn the difference between RTU and TCP, serial field meanings, TCP host/port, save & test behavior, status indicators, inheritance model, common mistakes, practical examples, and best practices.",
  anchors: [
    { id: "overview", label: "What is the connection screen?" },
    { id: "types", label: "Supported transports" },
    { id: "rtu", label: "Modbus RTU (Serial)" },
    { id: "tcp", label: "Modbus TCP" },
    { id: "save", label: "Save & test" },
    { id: "status", label: "Status indicators" },
    { id: "inheritance", label: "Inheritance model" },
    { id: "mistakes", label: "Common mistakes" },
    { id: "examples", label: "Practical examples" },
    { id: "best", label: "Best practices" },
    { id: "summary", label: "Summary" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="connection" anchor="overview" title="What is the Connection screen?">
        <p>
          The Connection screen defines <strong>how Modbus Toolbox communicates with devices</strong>. It answers the question,
          “How do I reach the Modbus slaves in this workspace?” and acts as the default communication layer that every slave inherits.
        </p>
      </SectionBlock>
      <SectionBlock section="connection" anchor="types" title="Supported transports">
        <p>Pick the transport at the top of the screen:</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Modbus RTU (Serial)</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>RS-485 / RS-232 wiring</li>
              <li>PLCs, meters, sensors</li>
              <li>USB-to-Serial converters</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Modbus TCP</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Ethernet devices, gateways, simulators</li>
              <li>LAN / local lab testing</li>
              <li>Works with PLCs or software bridges</li>
            </ul>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="connection" anchor="rtu" title="Modbus RTU (Serial)">
        <p>Select Serial to expose the classic RTU fields:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Serial Port</strong> – choose the physical/virtual port (e.g., <code>COM3</code>, <code>/dev/ttyUSB0</code>, <code>/dev/cu.usbserial-*</code>). Must match where the RS-485 adapter is connected.
          </li>
          <li>
            <strong>Baud Rate</strong> – common speeds include 9600, 19200, 38400, 115200. Must match the device exactly or frames will fail.
          </li>
          <li>
            <strong>Parity</strong> – None, Even, Odd. Most industrial devices use Even or None.
          </li>
          <li>
            <strong>Data Bits</strong> – usually 8; change only for legacy equipment.
          </li>
          <li>
            <strong>Stop Bits</strong> – typically 1 (occasionally 2).
          </li>
          <li>
            <strong>Flow Control</strong> – usually None; hardware/software options exist for niche adapters.
          </li>
        </ul>
        <p>These settings are workspace-wide so every serial slave shares the same timing.</p>
      </SectionBlock>
      <SectionBlock section="connection" anchor="tcp" title="Modbus TCP">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Host</strong> – IP address or hostname (e.g., <code>192.168.1.100</code>, <code>localhost</code>, <code>10.0.0.50</code>).
          </li>
          <li>
            <strong>Port</strong> – defaults to 502. Change only if the device listens on a custom port.
          </li>
        </ul>
        <p>Keep TCP values handy even if using RTU; you can switch quickly without retyping.</p>
      </SectionBlock>
      <SectionBlock section="connection" anchor="save" title="Save & test connection">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Save</h3>
            <p>Stores the connection configuration for the workspace. All slaves inherit it automatically.</p>
          </div>
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <h3 className="text-base font-semibold text-emerald-800 dark:text-emerald-200">Test Connection</h3>
            <p>Runs a live test with the provided parameters to confirm port availability, network reachability, or serial access. Failures surface detailed log entries so you know why the test failed.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="connection" anchor="status" title="Connection status indicators">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Connected</strong> – communication established.</li>
          <li><strong>Disconnected</strong> – not active.</li>
          <li><strong>Error</strong> – wrong parameters or unreachable device.</li>
        </ul>
        <p>Status chips help you troubleshoot at a glance.</p>
      </SectionBlock>
      <SectionBlock section="connection" anchor="inheritance" title="Inheritance model">
        <p>
          All slaves use the workspace connection unless an override exists. Configure it once, reduce duplication, and keep large setups manageable. This mirrors how real installations share comms infrastructure.
        </p>
      </SectionBlock>
      <SectionBlock section="connection" anchor="mistakes" title="Common mistakes & fixes">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-900/60 dark:bg-rose-950/30">
            <p className="font-semibold text-rose-800 dark:text-rose-200">❌ Wrong baud / parity / COM port</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-200">
              <li>Confirm values from device manuals.</li>
              <li>Replug USB-serial adapters to see the active COM.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/20">
            <p className="font-semibold text-amber-800 dark:text-amber-200">❌ Firewall blocking TCP</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-200">
              <li>Allow port 502 (or the custom port) on the network.</li>
              <li>Test from the same subnet before deploying.</li>
            </ul>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="connection" anchor="examples" title="Practical examples">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <p className="font-semibold text-slate-900 dark:text-white">Energy meter via RS-485</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Type: Modbus RTU</li>
              <li>Port: <code>COM4</code></li>
              <li>Baud: 9600</li>
              <li>Parity: Even</li>
              <li>Data bits: 8</li>
              <li>Stop bits: 1</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <p className="font-semibold text-slate-900 dark:text-white">PLC via Ethernet</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Type: Modbus TCP</li>
              <li>Host: <code>192.168.10.20</code></li>
              <li>Port: <code>502</code></li>
            </ul>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="connection" anchor="best" title="Best practices">
        <ul className="list-disc space-y-1 pl-5">
          <li>Configure the connection before adding slaves.</li>
          <li>Keep one workspace per physical network.</li>
          <li>Use Modbus TCP simulators or loopback devices when validating configuration.</li>
          <li>Start with default values, then match the field device exactly.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="connection" anchor="summary" title="Summary">
        <p>The Connection screen:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Defines how communication happens.</li>
          <li>Is shared across the workspace.</li>
          <li>Forms the foundation for all Modbus operations.</li>
        </ul>
        <p>Get this right and everything downstream just works.</p>
      </SectionBlock>
    </div>
  ),
};

export default connectionSection;
