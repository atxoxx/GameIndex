/** `@tauri-apps/plugin-dialog` shim (native dialogs via the main process). */
import { getBridge } from "./bridge";

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
  multiple?: boolean;
  directory?: boolean;
  recursive?: boolean;
  canCreateDirectories?: boolean;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
  canCreateDirectories?: boolean;
}

export interface ConfirmDialogOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
}

type Bridge = NonNullable<ReturnType<typeof getBridge>>;

function dialog<T>(kind: string, options?: unknown): Promise<T> {
  const bridge: Bridge | null = getBridge();
  if (!bridge) return Promise.reject(new Error("[gameindex] dialogs need Electron"));
  return bridge.dialog(kind as never, options) as Promise<T>;
}

export async function open(
  options: OpenDialogOptions = {},
): Promise<string | string[] | null> {
  return dialog<string | string[] | null>("open", options);
}

export async function save(
  options: SaveDialogOptions = {},
): Promise<string | null> {
  return dialog<string | null>("save", options);
}

export async function message(
  text: string,
  options: ConfirmDialogOptions = {},
): Promise<void> {
  await dialog("message", { ...options, message: text });
}

export async function ask(
  text: string,
  options: ConfirmDialogOptions = {},
): Promise<boolean> {
  return dialog<boolean>("ask", { ...options, message: text });
}

export async function confirm(
  text: string,
  options: ConfirmDialogOptions = {},
): Promise<boolean> {
  return dialog<boolean>("confirm", { ...options, message: text });
}
