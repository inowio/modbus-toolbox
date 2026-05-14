import { invoke } from "@tauri-apps/api/core";

export type SlaveItem = {
  id: number;
  name: string;
  unitId: number;
  connectionKind: "serial" | "tcp" | string;
  pollIntervalMs: number;
  addressOffset: number;
  createdAt: string;
  updatedAt: string;
};

export type SlaveRegisterRow = {
  id: number;
  slaveId: number;
  functionCode: number;
  address: number;
  alias: string;
  dataType: string;
  order: string;
  displayFormat: string;
  writeValue?: number | null;
  updatedAt: string;
};

export async function listSlaves(workspaceName: string): Promise<SlaveItem[]> {
  return await invoke<SlaveItem[]>("list_slaves", { name: workspaceName });
}

export async function listSlaveRegisterRows(
  workspaceName: string,
  slaveId: number,
  functionCode: number,
): Promise<SlaveRegisterRow[]> {
  return await invoke<SlaveRegisterRow[]>("list_slave_register_rows", {
    name: workspaceName,
    slaveId,
    functionCode,
  });
}
