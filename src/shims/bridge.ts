/**
 * The Electron preload bridge contract.
 *
 * Everything the renderer used to get from Tauri (`invoke`, `listen`, window
 * verbs, dialogs, the asset protocol) now goes through the object the preload
 * script installs on `window.__giBridge`. The modules in this directory are
 * aliased over the old `@tauri-apps/*` package ids (see `alias.ts`), so the
 * application code keeps importing the same symbols and does not need to
 * change.
 *
 * Outside Electron (plain `npm run dev` in a browser, jsdom tests) the bridge
 * is absent and every helper degrades to a rejected promise or a no-op, which
 * is the same behaviour the app had when those Tauri APIs were unavailable.
 */

export type UnlistenFn = () => void;

export type DropState =
  | { type: "enter"; paths: string[] }
  | { type: "over"; paths: string[] }
  | { type: "drop"; paths: string[] }
  | { type: "leave"; paths: string[] };

export interface BridgeWindowInfo {
  label: string;
  /** Electron's native window id (BrowserWindow.id). */
  id: number;
}

export interface GiBridge {
  readonly isElectron: true;
  readonly windowInfo: BridgeWindowInfo;

  /** Call a backend command registered in `electron/main/commands`. */
  invoke(cmd: string, args?: unknown): Promise<unknown>;

  /** Subscribe to a main-process event. Mirrors Tauri's `listen`. */
  listen(event: string, handler: (payload: unknown) => void): Promise<UnlistenFn>;

  /** Broadcast an event to every window (and the main process). */
  emit(event: string, payload?: unknown): Promise<void>;

  /** Run a window verb against the window that issued the call. */
  windowOp(method: string, args?: unknown): Promise<unknown>;

  /** Native dialog helpers. */
  dialog(
    kind: "open" | "save" | "message" | "ask" | "confirm",
    options?: unknown,
  ): Promise<unknown>;

  /** Shell helpers. */
  shell(
    kind: "openUrl" | "openPath" | "revealItemInDir",
    target: string,
  ): Promise<void>;

  /** Embedded webview (WebContentsView) helpers. */
  webviewOp(op: string, args?: unknown): Promise<unknown>;

  /** OS file drag-and-drop, with real absolute paths. */
  onDragDrop(handler: (state: DropState) => void): UnlistenFn;

  /** Clipboard write used by a few share/copy affordances. */
  writeClipboardText(text: string): Promise<void>;
}

declare global {
  interface Window {
    __giBridge?: GiBridge;
    /** Kept so `"__TAURI__" in window` feature gates keep working. */
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function getBridge(): GiBridge | null {
  if (typeof window === "undefined") return null;
  return window.__giBridge ?? null;
}

export function requireBridge(): GiBridge {
  const bridge = getBridge();
  if (!bridge) {
    throw new Error(
      "[gameindex] Electron bridge unavailable — run the app through `npm run dev:electron`.",
    );
  }
  return bridge;
}

/** True inside the Electron shell (used by `isTauri()` in the shim). */
export function isElectronRuntime(): boolean {
  return getBridge() !== null;
}
