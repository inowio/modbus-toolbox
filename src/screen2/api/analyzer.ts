import { invoke } from "@tauri-apps/api/core";

export type AnalyzerTile = {
  id: number;
  kind: string;
  title: string;
  configJson: string;
  pollingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AnalyzerTileLayout = {
  tileId: number;
  breakpoint: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AnalyzerTileLayoutUpsert = {
  breakpoint: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AnalyzerSignal = {
  id: string;
  slaveId: number;
  connectionKind: string;
  functionKind: string;
  registerRowId: number;
  address: number;
  decoderJson: string;
  lastValueJson?: string | null;
  lastUpdatedTsMs?: number | null;
  state: string;
  errorJson?: string | null;
};

export type AnalyzerSignalUpsert = {
  id: string;
  slaveId: number;
  functionKind: string;
  registerRowId: number;
  decoderJson?: string;
};

export type AnalyzerTileSignalInfo = {
  tileId: number;
  signalId: string;
  role: string;
  functionCode: number;
  address: number;
  alias: string;
  dataType: string;
  order: string;
  displayFormat: string;
  decoderJson: string;
  lastValueJson?: string | null;
  lastUpdatedTsMs?: number | null;
  state: string;
  errorJson?: string | null;
};

export async function startAnalyzerPolling(workspaceName: string): Promise<void> {
  await invoke<void>("start_analyzer_polling", { name: workspaceName });
}

export async function stopAnalyzerPolling(workspaceName: string): Promise<void> {
  await invoke<void>("stop_analyzer_polling", { name: workspaceName });
}

export async function listAnalyzerTiles(workspaceName: string): Promise<AnalyzerTile[]> {
  return await invoke<AnalyzerTile[]>("list_analyzer_tiles", { name: workspaceName });
}

export async function listAnalyzerTileLayouts(
  workspaceName: string,
): Promise<AnalyzerTileLayout[]> {
  return await invoke<AnalyzerTileLayout[]>("list_analyzer_tile_layouts", { name: workspaceName });
}

export async function saveAnalyzerTileLayouts(
  workspaceName: string,
  tileId: number,
  layouts: AnalyzerTileLayoutUpsert[],
): Promise<void> {
  await invoke<void>("save_analyzer_tile_layouts", {
    name: workspaceName,
    tileId,
    layouts,
  });
}

export async function deleteAnalyzerSignal(workspaceName: string, signalId: string): Promise<void> {
  await invoke<void>("delete_analyzer_signal", {
    name: workspaceName,
    signalId,
  });
}

export async function setAnalyzerTilePollingEnabled(
  workspaceName: string,
  tileId: number,
  pollingEnabled: boolean,
): Promise<AnalyzerTile> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTile>("set_analyzer_tile_polling_enabled", {
    name: workspaceName,
    tileId,
    pollingEnabled,
    nowIso,
  });
}

export async function listAnalyzerSignals(workspaceName: string): Promise<AnalyzerSignal[]> {
  return await invoke<AnalyzerSignal[]>("list_analyzer_signals", { name: workspaceName });
}

export async function upsertAnalyzerSignal(
  workspaceName: string,
  signal: AnalyzerSignalUpsert,
): Promise<AnalyzerSignal> {
  return await invoke<AnalyzerSignal>("upsert_analyzer_signal", {
    name: workspaceName,
    signal: {
      ...signal,
      decoderJson: signal.decoderJson ?? "{}",
    },
  });
}

export async function createAnalyzerTile(
  workspaceName: string,
  tile: {
    kind: string;
    title: string;
    configJson: string;
    pollingEnabled: boolean;
    layouts: Array<{ breakpoint: string; x: number; y: number; w: number; h: number }>;
    signalLinks: Array<{ signalId: string; role: string }>;
  },
): Promise<AnalyzerTile> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTile>("create_analyzer_tile", {
    name: workspaceName,
    tile,
    nowIso,
  });
}

export async function updateAnalyzerTile(
  workspaceName: string,
  tileId: number,
  patch: {
    kind: string;
    title: string;
    configJson: string;
    pollingEnabled: boolean;
    signalLinks: Array<{ signalId: string; role: string }>;
  },
): Promise<AnalyzerTile> {
  const nowIso = new Date().toISOString();
  return await invoke<AnalyzerTile>("update_analyzer_tile", {
    name: workspaceName,
    tileId,
    patch,
    nowIso,
  });
}

export async function deleteAnalyzerTile(workspaceName: string, tileId: number): Promise<void> {
  await invoke<void>("delete_analyzer_tile", { name: workspaceName, tileId });
}

export async function listAnalyzerTileSignals(
  workspaceName: string,
  tileId: number,
): Promise<AnalyzerTileSignalInfo[]> {
  return await invoke<AnalyzerTileSignalInfo[]>("list_analyzer_tile_signals", {
    name: workspaceName,
    tileId,
  });
}
