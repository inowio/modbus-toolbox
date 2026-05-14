import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FiActivity, FiRefreshCcw, FiSave } from "react-icons/fi";
import type { Screen2OutletContext } from "../Screen2Layout";
import { useErrorToast, useToast } from "../../components/ToastProvider";
import {
  ConnectionSettings,
  ConnectionSettingsForm,
  PortItem,
  normalizeConnectionSettings,
} from "../components/ConnectionSettingsForm";
import { logEvent } from "../api/logs";
import { CTRL_S } from "../../components/ShortcutKeys";

export default function ConnectionPage() {
  const { workspace } = useOutletContext<Screen2OutletContext>();

  const { pushToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ConnectionSettings>(() =>
    normalizeConnectionSettings({ kind: "serial" }),
  );
  const [initial, setInitial] = useState<ConnectionSettings | null>(null);

  useErrorToast(error);

  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const [serialPorts, setSerialPorts] = useState<PortItem[]>([]);

  const prevSettingsRef = useRef<ConnectionSettings | null>(null);
  const saveRef = useRef<() => void>(() => {});

  async function loadSerialPorts() {
    try {
      const ports = await invoke<PortItem[]>("list_serial_ports");
      setSerialPorts(ports);
    } catch {
      setSerialPorts([]);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestMessage(null);
    setError(null);
    try {
      await invoke<void>("test_connection", { name: workspace.name, settings });
      setTestMessage("Connection test succeeded.");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "connection",
        message: "Connection test succeeded",
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "connection",
        message: "Connection test failed",
        detailsJson: {
          error: message,
        },
      });
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const loaded = await invoke<ConnectionSettings>("get_connection_settings", {
          name: workspace.name,
        });
        const normalized = normalizeConnectionSettings(loaded);
        setSettings(normalized);
        setInitial(normalized);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    void load();
    void loadSerialPorts();
  }, [workspace.name]);

  const isDirty = useMemo(() => {
    if (!initial) return false;
    return JSON.stringify(initial) !== JSON.stringify(settings);
  }, [initial, settings]);

  saveRef.current = save;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "s" && e.key !== "S") return;

      if (!isDirty || loading || saving || testing) return;

      e.preventDefault();
      void saveRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDirty, loading, saving, testing]);

  useEffect(() => {
    const prev = prevSettingsRef.current;
    if (!prev) {
      prevSettingsRef.current = settings;
      return;
    }

    const changedFields: string[] = [];
    if (prev.kind !== settings.kind) changedFields.push("kind");
    if (prev.serialPort !== settings.serialPort) changedFields.push("serialPort");
    if (prev.serialBaud !== settings.serialBaud) changedFields.push("serialBaud");
    if (prev.serialParity !== settings.serialParity) changedFields.push("serialParity");
    if (prev.serialDataBits !== settings.serialDataBits) changedFields.push("serialDataBits");
    if (prev.serialStopBits !== settings.serialStopBits) changedFields.push("serialStopBits");
    if (prev.serialFlowControl !== settings.serialFlowControl)
      changedFields.push("serialFlowControl");
    if (prev.tcpHost !== settings.tcpHost) changedFields.push("tcpHost");
    if (prev.tcpPort !== settings.tcpPort) changedFields.push("tcpPort");

    if (changedFields.length > 0) {
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "connection",
        message: "Connection settings changed",
        detailsJson: {
          fields: changedFields,
        },
      });
    }

    prevSettingsRef.current = settings;
  }, [settings, workspace.name]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      await invoke<void>("set_connection_settings", {
        name: workspace.name,
        settings,
        nowIso,
      });
      setInitial(settings);
      pushToast("Saved", "info");
      void logEvent({
        scope: "workspace",
        level: "info",
        workspaceName: workspace.name,
        source: "connection",
        message: "Connection settings saved",
      });
    } catch (e) {
      const message = String(e);
      setError(message);
      void logEvent({
        scope: "workspace",
        level: "error",
        workspaceName: workspace.name,
        source: "connection",
        message: "Failed to save connection settings",
        detailsJson: {
          error: message,
        },
      });
    } finally {
      setSaving(false);
    }
  }

  const serialPortOptions = useMemo(() => {
    const items = [...serialPorts];
    const current = (settings.serialPort ?? "").trim();
    if (current.length > 0 && !items.some((p) => p.port === current)) {
      items.unshift({ port: current, label: current });
    }
    return items;
  }, [serialPorts, settings.serialPort]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-inner dark:shadow-black/30">
        <div>
          <p className="text-sm uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">Modbus Connection</p>

          <div className="text-sm mt-2 text-slate-600 dark:text-slate-300">
            Connection settings for this app and other slaves can communicate. Choose Serial or TCP and configure parameters.
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {testMessage ? (
        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {testMessage}
        </div>
      ) : null}

      {loading ? <div className="flex items-center gap-2 p-2 text-sm text-slate-600 dark:text-slate-300 animate-pulse">
        <FiRefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading...
      </div> : null}

      <div className="w-full rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-sm">
        <ConnectionSettingsForm
          value={settings}
          onChange={setSettings}
          serialPortOptions={serialPortOptions}
          onRefreshSerialPorts={loadSerialPorts}
          loading={loading}
          saving={saving}
        />
      </div>

      <div className="w-full rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-sm">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
            onClick={() => testConnection()}
            disabled={loading || saving || testing}
            title="Test current connection settings"
          >
            <FiActivity className="h-4 w-4" aria-hidden="true" />
            {testing ? "Testing..." : "Test Connection"}
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
            onClick={() => save()}
            disabled={!isDirty || loading || saving}
            title={`Save connection info ${CTRL_S}`}
          >
            <FiSave className="h-4 w-4" aria-hidden="true" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
