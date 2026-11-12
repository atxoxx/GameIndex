/**
 * `@tauri-apps/api/webview` shim.
 *
 * Embedded webviews are real `WebContentsView`s owned by the main process
 * (`electron/main/surfaces/webviews.ts`). Exactly like the Tauri build, the
 * React code creates one through a command (`create_preview_webview`) and then
 * looks the instance up by label, then drives bounds/visibility through this
 * class.
 */
import { getBridge } from "./bridge";
import { listen, type UnlistenFn } from "./tauri-event";
import type { SizeLike, PositionLike } from "./tauri-window";

export type { SizeLike as WebviewSize, PositionLike as WebviewPosition };

function bridgeOp<T>(op: string, args?: unknown): Promise<T> {
  const bridge = getBridge();
  if (!bridge) {
    return Promise.reject(
      new Error(`[gameindex] webview.${op} is unavailable outside Electron`),
    );
  }
  return bridge.webviewOp(op, args) as Promise<T>;
}

export interface WebviewEvent<T> {
  event: string;
  id: number;
  payload: T;
}

export class Webview {
  readonly label: string;

  constructor(_window?: unknown, label?: string, _options?: unknown) {
    this.label = label ?? `webview-${Math.random().toString(36).slice(2, 9)}`;
  }

  /** Look up a webview the main process already created. */
  static async getByLabel(label: string): Promise<Webview | null> {
    const exists = await bridgeOp<boolean>("exists", { label }).catch(() => false);
    return exists ? new Webview(undefined, label) : null;
  }

  static async getAll(): Promise<Webview[]> {
    const labels = await bridgeOp<string[]>("list").catch(() => []);
    return labels.map((label) => new Webview(undefined, label));
  }

  static async getCurrent(): Promise<Webview> {
    return getCurrentWebview();
  }

  setPosition(position: PositionLike): Promise<void> {
    return bridgeOp<void>("setPosition", { label: this.label, position });
  }

  setSize(size: SizeLike): Promise<void> {
    return bridgeOp<void>("setSize", { label: this.label, size });
  }

  setZoom(scale: number): Promise<void> {
    return bridgeOp<void>("setZoom", { label: this.label, scale });
  }

  show(): Promise<void> {
    return bridgeOp<void>("show", { label: this.label });
  }

  hide(): Promise<void> {
    return bridgeOp<void>("hide", { label: this.label });
  }

  close(): Promise<void> {
    return bridgeOp<void>("close", { label: this.label });
  }

  navigate(url: string): Promise<void> {
    return bridgeOp<void>("navigate", { label: this.label, url });
  }

  /** OS file drag-and-drop targeting this webview. */
  onDragDropEvent(
    handler: (event: {
      event: string;
      id: number;
      payload: { type: "enter" | "over" | "drop" | "leave"; paths: string[] };
    }) => void,
  ): Promise<UnlistenFn> {
    const bridge = getBridge();
    if (!bridge) return Promise.resolve(() => {});
    return Promise.resolve(
      bridge.onDragDrop((payload) => {
        handler({ event: "tauri://drag-drop", id: 0, payload });
      }),
    );
  }

  /** Mirrors Tauri's one-shot lifecycle events (`tauri://created`). */
  once<T>(event: string, handler: (event: WebviewEvent<T>) => void): Promise<UnlistenFn> {
    // Creation already succeeded (the command that made this view resolved),
    // so report it on the next microtask; error subscriptions stay live.
    if (event === "tauri://created") {
      const timer = setTimeout(
        () => handler({ event, id: 0, payload: null as T }),
        0,
      );
      return Promise.resolve(() => clearTimeout(timer));
    }
    return listen<T>(`__gi_webview:${this.label}:${event}`, handler);
  }
}

/** The webview occupying this window (there is one per window now). */
export function getCurrentWebview(): Webview {
  return new Webview(undefined, getBridge()?.windowInfo.label ?? "main");
}

/** Convenience wrapper for OS file-drop events in a webview. */
export async function onDragDropEvent(
  handler: (state: {
    type: "enter" | "over" | "drop" | "leave";
    paths: string[];
  }) => void,
): Promise<UnlistenFn> {
  const bridge = getBridge();
  if (!bridge) return () => {};
  return bridge.onDragDrop(handler);
}
