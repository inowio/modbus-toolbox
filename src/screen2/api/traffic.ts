import { invoke } from "@tauri-apps/api/core";

export type TrafficEventEntry = {
  id: number;
  tsIso: string;
  functionKind: string; // read | write | poll | other
  packetType: string; // request | response
  proto: string; // tcp | rtu
  destAddr?: string | null;
  slaveId?: number | null;
  unitId?: number | null;
  functionCode?: number | null;
  address?: number | null;
  quantity?: number | null;
  durationMs?: number | null;
  ok: boolean;
  error?: string | null;
  checksum?: string | null;
  dataHex?: string | null;
  dataSize?: number | null;
  decodedData?: string | null;
};

export async function listTrafficEvents(
  workspaceName: string,
  params?: { slaveId?: number; sinceId?: number; limit?: number },
): Promise<TrafficEventEntry[]> {
  return invoke<TrafficEventEntry[]>("list_traffic_events", {
    workspace: workspaceName,
    filter: {
      slaveId: params?.slaveId ?? null,
      sinceId: params?.sinceId ?? null,
      limit: params?.limit ?? null,
    },
  });
}

export async function clearTrafficEvents(workspaceName: string): Promise<number> {
  return invoke<number>("clear_traffic_events", {
    workspace: workspaceName,
  });
}

export async function setTrafficCaptureEnabled(workspaceName: string, enabled: boolean): Promise<void> {
  return invoke<void>("set_traffic_capture_enabled", {
    workspace: workspaceName,
    enabled,
  });
}
