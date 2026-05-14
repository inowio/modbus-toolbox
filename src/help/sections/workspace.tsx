import React from "react";
import SectionBlock from "./SectionBlock";
import type { HelpSectionDefinition } from "../types";

const workspaceSection: HelpSectionDefinition = {
  slug: "workspace",
  title: "Workspace",
  description:
    "Understand why workspaces matter, how to search/filter them, create new ones, manage metadata, and handle logs/deletion safely.",
  keywords: ["workspace", "search", "cards", "add", "rename", "export", "import", "logs", "delete", "example"],
  searchText:
    "Workspaces are the top-level containers. Learn about the header context, search, cards, add dialog, rename, export, import, metadata form, save/delete, logs separation, deletion cautions, and practical multi-site examples.",
  anchors: [
    { id: "overview", label: "What is a workspace?" },
    { id: "header", label: "Header overview" },
    { id: "search", label: "Search & filtering" },
    { id: "cards", label: "Workspace cards" },
    { id: "create", label: "Add workspace dialog" },
    { id: "rename", label: "Renaming a workspace" },
    { id: "export", label: "Exporting a workspace" },
    { id: "import", label: "Importing a workspace" },
    { id: "info", label: "Workspace info form" },
    { id: "actions", label: "Save & delete" },
    { id: "logs", label: "Workspace logs" },
    { id: "danger", label: "Deleting workspaces" },
    { id: "example", label: "Practical example" },
    { id: "summary", label: "Summary" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="workspace" anchor="overview" title="Why workspaces matter">
        <p>
          A <strong>Workspace</strong> is the top-level container inside Modbus Toolbox. It represents a single logical project—a
          site, panel, test rig, or machine. Everything else (connections, slaves, registers, analyzer layouts, logs) belongs to
          the currently selected workspace so your projects never bleed into each other.
        </p>
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800/60 dark:bg-slate-900/30 dark:text-slate-200">
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">Core Idea:</span> <em>One workspace = one real-world Modbus system.</em>
        </p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="header" title="Header overview">
        <p>The header keeps context visible while you navigate:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Workspace name + count</strong> so you always know where you are and how many projects you manage.
          </li>
          <li>
            <strong>Add Workspace</strong> button for quick creation.
          </li>
          <li>
            <strong>Search bar</strong> for instant filtering.</li>
        </ul>
        <p>It is intentionally minimal—switching contexts feels instant, even when juggling dozens of workspaces.</p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="search" title="Search & filtering">
        <p>
          The search input filters cards in real time by name. Typing <code>pump</code> will match “Pump Station” or “Pump Test
          Bench”; typing <code>2025</code> surfaces projects tagged by year. Because the filter is case-insensitive and instant,
          you never need to manage extra dropdowns or tags.
        </p>
        <p>Use it when handling many customer sites, multiple commissioning projects, or historical test benches.</p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="cards" title="Workspace cards">
        <p>Each workspace appears as a card so projects stay visually separated:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Name</strong> and optional description.</li>
          <li><strong>Created / updated</strong> timestamps to see activity.</li>
          <li><strong>Quick actions</strong> like Open or Delete.</li>
        </ul>
        <p>This layout reduces the risk of editing the wrong setup and keeps scanning faster than a dense table.</p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="create" title="Add workspace dialog">
        <p>The Add Workspace dialog is how new projects begin. It captures:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Workspace Name</strong> – human-readable identifier such as <code>Factory-A Energy Meters</code> or
            <code>Hydraulic Pack – Test Rig</code>.
          </li>
          <li>
            <strong>Description (optional)</strong> – short note for future you/teammates, e.g., “Energy meters connected via
            RS-485 in Block B.”
          </li>
        </ul>
        <p>Use descriptive names; avoid vague ones like “Test1” unless temporary.</p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="rename" title="Renaming a workspace">
        <p>
          You can rename a workspace directly from the workspace list. Click the <strong>edit icon</strong> on any workspace card to
          open a modal where you can change both the name and description.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Names are validated—duplicates (case-insensitive) are rejected.</li>
          <li>The underlying folder is renamed automatically to match.</li>
          <li>The description field is optional; clearing it removes it entirely.</li>
        </ul>
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800/60 dark:bg-slate-900/30 dark:text-slate-200">
          <span className="font-semibold text-amber-700 dark:text-amber-300">Note:</span> Rename from the workspace list (not from
          inside the workspace) to avoid conflicts with open database connections.
        </p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="export" title="Exporting a workspace">
        <p>
          Export packages an entire workspace into a single <strong>.zip</strong> file for backup or sharing. You will find the
          Export button on the <strong>Workspace Information</strong> page.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The ZIP includes <code>workspace.json</code>, <code>workspace.db</code>, and all attachment files.</li>
          <li>A native save dialog lets you choose where to save the file.</li>
          <li>The default filename is the workspace name with a <code>.zip</code> extension.</li>
        </ul>
        <p>Use export before deleting old workspaces, or to transfer setups between machines.</p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="import" title="Importing a workspace">
        <p>
          Import restores a workspace from a previously exported <strong>.zip</strong> file. Click the <strong>Import</strong> button
          in the workspace list header, then select the ZIP file.
        </p>
        <p>If a workspace with the same name already exists, a conflict dialog offers three choices:</p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Cancel</h3>
            <p>Abort the import—nothing changes.</p>
          </div>
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <h3 className="text-base font-semibold text-emerald-800 dark:text-emerald-200">Import as New</h3>
            <p>Creates the workspace under an indexed name (e.g., "Pump Station 1") so both copies coexist.</p>
          </div>
          <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
            <h3 className="text-base font-semibold text-rose-800 dark:text-rose-200">Overwrite</h3>
            <p>Replaces the existing workspace entirely with the imported data. This is irreversible.</p>
          </div>
        </div>
        <p>If no conflict exists, the workspace is imported directly without any prompt.</p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="info" title="Workspace info form">
        <p>
          Inside a workspace, the Info screen lets you review and edit metadata without touching communication settings. You can
          rename descriptions, confirm created/updated timestamps, and keep notes accurate for handovers or audits.
        </p>
        <p>It is strictly organizational—changing these fields will not impact Modbus polling.</p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="actions" title="Save & delete actions">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Save</h3>
            <p>Persists Workspace Info edits immediately—no background sync. Always save after renaming or editing notes.</p>
          </div>
          <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
            <h3 className="text-base font-semibold text-rose-800 dark:text-rose-200">Delete</h3>
            <p>
              Removes the workspace plus connections, slaves, register mappings, and logs. Requires confirmation because it is
              irreversible.
            </p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="logs" title="Workspace-scoped logs">
        <p>
          Logs are stored per workspace so troubleshooting is scoped to the current project. No cross-contamination between
          plants or labs—what you see reflects only the active workspace, making diagnosis clearer.
        </p>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="danger" title="Deleting workspaces (important)">
        <p>
          Deleting has no undo. Remove a workspace only when a project is truly finished. If storage allows, keep old
          workspaces as references instead of wiping them.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Export the workspace as a ZIP backup before deleting.</li>
          <li>Use clear names so you do not delete the wrong entry.</li>
          <li>When in doubt, pause—workspaces are cheap to keep.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="example" title="Practical example">
        <p>Managing two similar sites? Keep clarity like this:</p>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800/60 dark:bg-slate-900/20 dark:text-slate-300">
          <p className="font-semibold text-slate-900 dark:text-white">Scenario</p>
          <p>Two compressor plants share hardware but run independently.</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>Workspace 1: <code>Plant-A Compressors</code></li>
            <li>Workspace 2: <code>Plant-B Compressors</code></li>
            <li>Each has unique IPs, slave IDs, and logs.</li>
          </ul>
          <p className="mt-3 text-emerald-700 dark:text-emerald-300">Result: zero confusion, zero overlap.</p>
        </div>
      </SectionBlock>
      <SectionBlock section="workspace" anchor="summary" title="Summary">
        <ul className="list-disc space-y-1 pl-5">
          <li>Workspaces are safe boundaries around projects.</li>
          <li>They act as project containers for every downstream feature.</li>
          <li>They provide a mental reset button between systems.</li>
        </ul>
        <p>Master workspaces and the rest of Modbus Toolbox feels effortless.</p>
      </SectionBlock>
    </div>
  ),
};

export default workspaceSection;
