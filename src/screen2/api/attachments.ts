import { invoke } from "@tauri-apps/api/core";

export type AttachmentItem = {
  fileName: string;
  displayName: string;
  ext: string;
  sizeBytes: number;
  modifiedAtIso: string;
  path: string;
};

export type AttachmentPreview = {
  kind: "image" | "pdf" | "text" | "binary";
  data: string;
  mimeType: string;
};

export async function listSlaveAttachments(workspaceName: string, slaveId: number): Promise<AttachmentItem[]> {
  if (!workspaceName || !Number.isFinite(slaveId)) return [];
  return invoke<AttachmentItem[]>("list_slave_attachments", { name: workspaceName, slaveId });
}

export async function addSlaveAttachment(workspaceName: string, slaveId: number, sourcePath: string): Promise<AttachmentItem> {
  return invoke<AttachmentItem>("add_slave_attachment", { name: workspaceName, slaveId, sourcePath });
}

export async function deleteSlaveAttachment(workspaceName: string, slaveId: number, fileName: string): Promise<void> {
  await invoke("delete_slave_attachment", { name: workspaceName, slaveId, fileName });
}

export async function readSlaveAttachment(
  workspaceName: string,
  slaveId: number,
  fileName: string,
): Promise<AttachmentPreview> {
  return invoke<AttachmentPreview>("read_slave_attachment", { name: workspaceName, slaveId, fileName });
}

export async function exportSlaveAttachment(
  workspaceName: string,
  slaveId: number,
  fileName: string,
  targetPath: string,
): Promise<void> {
  await invoke("export_slave_attachment", { name: workspaceName, slaveId, fileName, targetPath });
}
