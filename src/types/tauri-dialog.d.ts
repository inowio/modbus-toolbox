declare module "@tauri-apps/plugin-dialog" {
  export interface OpenDialogOptions {
    multiple?: boolean;
  }

  export interface SaveDialogOptions {
    defaultPath?: string;
  }

  export function open(options?: OpenDialogOptions): Promise<string | string[] | null>;
  export function save(options?: SaveDialogOptions): Promise<string | null>;
}
