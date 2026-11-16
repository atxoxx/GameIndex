/**
 * `@tauri-apps/plugin-updater` shim backed by the Electron updater.
 *
 * The Tauri plugin consumed a minisign-signed `latest.json`; the Electron
 * build checks through the main process (`updater_check`) and installs through
 * two channels:
 *
 *   • NSIS / AppImage: `electron-updater` downloads the installer. Progress
 *     arrives on the `updater-progress` event and is forwarded to the caller's
 *     callback with the same `{ event, data }` shape the plugin used.
 *   • Windows portable: the main process resolves the GitHub release asset and
 *     returns it under `rawJson.platforms[target]`; `UpdateContext` downloads
 *     and applies it through the portable commands.
 */
import { invoke, isTauri } from "./tauri-core";
import { listen, type UnlistenFn } from "./tauri-event";

export interface UpdateDownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: {
    contentLength?: number;
    chunkLength?: number;
    downloaded?: number;
    total?: number;
    percent?: number;
    bytesPerSecond?: number;
  };
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

interface PortableArtifact {
  url: string;
  sha256: string | null;
  sizeBytes: number | null;
  fileName: string | null;
}

interface UpdaterCheckResult {
  available: boolean;
  version?: string;
  body?: string;
  date?: string;
  target?: string | null;
  portable?: PortableArtifact;
}

export async function check(_options?: CheckOptions): Promise<Update | null> {
  if (!isTauri()) return null;

  const info = await invoke<UpdaterCheckResult>("updater_check");
  if (!info?.available) return null;

  // The portable flow in UpdateContext reads `platforms[target]`, so expose the
  // GitHub asset in that shape. `signature` has always been "the hash the
  // downloader verifies"; for Electron it is the asset's sha256.
  const rawJson = info.portable
    ? {
        platforms: {
          [info.target ?? "windows-x86_64"]: {
            url: info.portable.url,
            signature: info.portable.sha256 ?? "",
            sha256: info.portable.sha256,
            size: info.portable.sizeBytes,
            fileName: info.portable.fileName,
          },
        },
      }
    : info;

  let unlisten: UnlistenFn | null = null;

  return {
    available: true,
    version: info.version ?? "",
    body: info.body,
    date: info.date,
    rawJson,
    async downloadAndInstall(onEvent) {
      if (onEvent) {
        unlisten = await listen<UpdateDownloadEvent>("updater-progress", (event) => {
          onEvent(event.payload);
        });
      }
      try {
        await invoke("updater_download");
        await invoke("updater_install");
      } finally {
        unlisten?.();
        unlisten = null;
      }
    },
    async close() {
      unlisten?.();
      unlisten = null;
    },
  };
}
