import { invoke } from "@tauri-apps/api/core";

export type LogScope = "app" | "workspace";
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEventInput = {
  scope: LogScope;
  level: LogLevel;
  workspaceName?: string;
  source: string;
  message: string;
  detailsJson?: unknown;
};

export async function logEvent(event: LogEventInput): Promise<void> {
  const payload = {
    scope: event.scope,
    level: event.level,
    workspaceName: event.workspaceName ?? null,
    source: event.source,
    message: event.message,
    detailsJson: event.detailsJson != null ? JSON.stringify(event.detailsJson) : null,
  };

  await invoke("log_event", { event: payload });
}

export type AppLogEntry = {
  id: number;
  tsIso: string;
  level: LogLevel;
  severity: number;
  source: string;
  message: string;
  detailsJson?: string | null;
};

export type WorkspaceLogEntry = {
  id: number;
  tsIso: string;
  level: LogLevel;
  severity: number;
  source: string;
  message: string;
  detailsJson?: string | null;
};

export async function listAppLogs(params?: {
  minLevel?: LogLevel;
  limit?: number;
}): Promise<AppLogEntry[]> {
  return invoke<AppLogEntry[]>("list_app_logs", {
    filter: {
      minLevel: params?.minLevel ?? null,
      limit: params?.limit ?? null,
    },
  });
}

export async function listWorkspaceLogs(
  workspaceName: string,
  params?: { minLevel?: LogLevel; limit?: number },
): Promise<WorkspaceLogEntry[]> {
  return invoke<WorkspaceLogEntry[]>("list_workspace_logs", {
    name: workspaceName,
    filter: {
      minLevel: params?.minLevel ?? null,
      limit: params?.limit ?? null,
    },
  });
}
