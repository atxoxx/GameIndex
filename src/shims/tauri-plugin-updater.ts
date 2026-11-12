/**
 * `@tauri-apps/plugin-updater` shim.
 *
 * The Tauri updater consumed a `latest.json` signed with the minisign key that
 * ships in `tauri.conf.json`. Electron publishes a different artifact set, so
 * the packaged updater is not wired yet: `check()` reports "no update" and the
 * app says it is up to date.
 *
 * TODO(electron): replace with `electron-updater`'s `autoUpdater` and keep this
 * same shape so `UpdateContext` needs no changes.
 */
import { isTauri } from "./tauri-core";

export interface UpdateDownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: { contentLength?: number; chunkLength?: number };
}

export interface Update {
  available: boolean;
  version: string;
  body?: string;
  date?: string;
  rawJson?: unknown;
  downloadAndInstall(
    onEvent?: (event: UpdateDownloadEvent) => void,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface CheckOptions {
  target?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export async function check(_options?: CheckOptions): Promise<Update | null> {
  if (!isTauri()) return null;
  // No Electron update feed is configured yet (see the file header).
  return null;
}
