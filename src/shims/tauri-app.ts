/** `@tauri-apps/api/app` shim. */
import { invoke, isTauri } from "./tauri-core";

export async function getVersion(): Promise<string> {
  if (!isTauri()) return "0.0.0-dev";
  return invoke<string>("__app_version");
}

export async function getName(): Promise<string> {
  return "GameIndex";
}

export async function getTauriVersion(): Promise<string> {
  return "2 (electron-compat)";
}
