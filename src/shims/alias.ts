/**
 * Module aliases that map the removed `@tauri-apps/*` packages onto the local
 * shims. Shared by:
 *   - `vite.config.ts`      (browser-only dev / `build:web`)
 *   - `electron.vite.config.ts` (the Electron renderer bundle)
 *   - `vitest.config.ts`    (unit tests keep mocking the same specifiers)
 *   - `tsconfig.json`       (`paths`, hand-maintained below)
 *
 * Keeping one list means a new shim can never be wired into one build and
 * forgotten in another.
 */
import { fileURLToPath } from "node:url";

const shim = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

export interface ShimAlias {
  find: string;
  replacement: string;
}

export const tauriShimAliases: ShimAlias[] = [
  { find: "@tauri-apps/api/core", replacement: shim("./tauri-core.ts") },
  { find: "@tauri-apps/api/event", replacement: shim("./tauri-event.ts") },
  { find: "@tauri-apps/api/window", replacement: shim("./tauri-window.ts") },
  { find: "@tauri-apps/api/webview", replacement: shim("./tauri-webview.ts") },
  { find: "@tauri-apps/api/app", replacement: shim("./tauri-app.ts") },
  { find: "@tauri-apps/api/dpi", replacement: shim("./tauri-dpi.ts") },
  { find: "@tauri-apps/plugin-dialog", replacement: shim("./tauri-plugin-dialog.ts") },
  { find: "@tauri-apps/plugin-opener", replacement: shim("./tauri-plugin-opener.ts") },
  { find: "@tauri-apps/plugin-process", replacement: shim("./tauri-plugin-process.ts") },
  { find: "@tauri-apps/plugin-updater", replacement: shim("./tauri-plugin-updater.ts") },
];
