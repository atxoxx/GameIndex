/**
 * Electron wiring for the plugin runtime.
 *
 * Kept separate from `runtime.ts` so the manager, sandbox and registry can be
 * exercised outside Electron (the `%TEMP%` harness). This module owns the
 * `userData` paths, the `plugins.json` document and `safeStorage` encryption
 * for secret config values.
 */
import { safeStorage } from "electron";

import { ensureDir, userDataPath } from "../../lib/paths";
import { createJsonStore } from "../../state/jsonStore";
import {
  emptyPluginDocument,
  normalizePluginDocument,
  type PluginDocumentStore,
  type SecretCipher,
} from "./registry";
import { PluginRuntime } from "./runtime";
import type {
  PluginDocument,
  PluginDownloadResult,
  PluginSearchOptions,
  PluginSearchSource,
} from "./types";

/**
 * `safeStorage` is DPAPI on Windows / Keychain on macOS / libsecret on Linux.
 * When no OS keystore is available the config values are still persisted, but
 * unencrypted — the UI only ever shows "set / not set", and the files live
 * under the app's private `userData` folder.
 */
function safeStorageCipher(): SecretCipher | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return {
      encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
      decrypt: (cipherText) =>
        safeStorage.decryptString(Buffer.from(cipherText, "base64")),
    };
  } catch (error) {
    console.warn("[plugins] OS encryption is unavailable:", error);
    return null;
  }
}

let runtime: PluginRuntime | null = null;

export function getPluginRuntime(): PluginRuntime {
  if (runtime) return runtime;
  const store = createJsonStore<PluginDocument>(
    "plugins.json",
    emptyPluginDocument,
    normalizePluginDocument,
  );
  const document: PluginDocumentStore = {
    read: () => store.read(),
    write: (value) => store.write(value),
  };
  runtime = new PluginRuntime({
    baseDir: ensureDir(userDataPath("plugins")),
    document,
    cipher: safeStorageCipher(),
  });
  return runtime;
}

/**
 * Search every enabled plugin (or only the plugin-backed sources the caller
 * passes) and return rows ready to append to `sources_search_game`.
 */
export function searchWithPlugins(
  gameName: string,
  sources: readonly (string | PluginSearchSource)[] = [],
  options: PluginSearchOptions = {},
): Promise<PluginDownloadResult[]> {
  return getPluginRuntime().searchWithPlugins(gameName, sources, options);
}
