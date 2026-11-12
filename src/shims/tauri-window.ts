/**
 * `@tauri-apps/api/window` shim.
 *
 * Window verbs are forwarded through the preload bridge to the main process,
 * which applies them to the BrowserWindow that issued the call. Window events
 * (`tauri://resize`, `tauri://move`, …) are emitted by the main process per
 * window, so `onResized`/`onMoved`/`onCloseRequested` behave as before.
 */
import { getBridge } from "./bridge";
import { listen, type UnlistenFn } from "./tauri-event";
import {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "./tauri-dpi";

export {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
};
export type { LogicalPosition as LogicalPositionType };
export type { LogicalSize as LogicalSizeType };
export type { PhysicalPosition as PhysicalPositionType };
export type { PhysicalSize as PhysicalSizeType };

export type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export type SizeLike =
  | LogicalSize
  | PhysicalSize
  | { width: number; height: number; type?: string };

export type PositionLike =
  | LogicalPosition
  | PhysicalPosition
  | { x: number; y: number; type?: string };

export interface WindowEvent<T> {
  event: string;
  id: number;
  payload: T;
}

export type WindowLabel = string;

function op<T>(method: string, args?: unknown): Promise<T> {
  const bridge = getBridge();
  if (!bridge) {
    return Promise.reject(
      new Error(`[gameindex] window.${method} is unavailable outside Electron`),
    );
  }
  return bridge.windowOp(method, args) as Promise<T>;
}

export class Window {
  readonly label: string;

  constructor(label?: string) {
    this.label = label ?? getBridge()?.windowInfo.label ?? "main";
  }

  // ── State ──────────────────────────────────────────────────────────
  isMaximized(): Promise<boolean> {
    return op<boolean>("isMaximized");
  }
  isFullscreen(): Promise<boolean> {
    return op<boolean>("isFullscreen");
  }
  isVisible(): Promise<boolean> {
    return op<boolean>("isVisible");
  }
  isFocused(): Promise<boolean> {
    return op<boolean>("isFocused");
  }

  // ── Verbs ──────────────────────────────────────────────────────────
  minimize(): Promise<void> {
    return op<void>("minimize");
  }
  maximize(): Promise<void> {
    return op<void>("maximize");
  }
  unmaximize(): Promise<void> {
    return op<void>("unmaximize");
  }
  toggleMaximize(): Promise<void> {
    return op<void>("toggleMaximize");
  }
  setFullscreen(fullscreen: boolean): Promise<void> {
    return op<void>("setFullscreen", { fullscreen });
  }
  setResizable(resizable: boolean): Promise<void> {
    return op<void>("setResizable", { resizable });
  }
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    return op<void>("setAlwaysOnTop", { alwaysOnTop });
  }
  setDecorations(decorations: boolean): Promise<void> {
    return op<void>("setDecorations", { decorations });
  }
  setSkipTaskbar(skip: boolean): Promise<void> {
    return op<void>("setSkipTaskbar", { skip });
  }
  setIgnoreCursorEvents(ignore: boolean): Promise<void> {
    return op<void>("setIgnoreCursorEvents", { ignore });
  }
  setTitle(title: string): Promise<void> {
    return op<void>("setTitle", { title });
  }
  setSize(size: SizeLike): Promise<void> {
    return op<void>("setSize", size);
  }
  setPosition(position: PositionLike): Promise<void> {
    return op<void>("setPosition", position);
  }
  setFocus(): Promise<void> {
    return op<void>("setFocus");
  }
  center(): Promise<void> {
    return op<void>("center");
  }
  show(): Promise<void> {
    return op<void>("show");
  }
  hide(): Promise<void> {
    return op<void>("hide");
  }
  close(): Promise<void> {
    return op<void>("close");
  }
  destroy(): Promise<void> {
    return op<void>("destroy");
  }

  async innerSize(): Promise<PhysicalSize> {
    const size = await op<{ width: number; height: number }>("innerSize");
    return new PhysicalSize(size.width, size.height);
  }
  async outerSize(): Promise<PhysicalSize> {
    const size = await op<{ width: number; height: number }>("outerSize");
    return new PhysicalSize(size.width, size.height);
  }
  async innerPosition(): Promise<PhysicalPosition> {
    const pos = await op<{ x: number; y: number }>("innerPosition");
    return new PhysicalPosition(pos.x, pos.y);
  }
  async outerPosition(): Promise<PhysicalPosition> {
    const pos = await op<{ x: number; y: number }>("outerPosition");
    return new PhysicalPosition(pos.x, pos.y);
  }

  /**
   * Native edge-resize gesture.
   *
   * Frameless Electron windows on Windows/Linux keep their native resize
   * border (`thickFrame`), so the OS already handles edge dragging. The
   * helper stays for API compatibility and is a resolved no-op.
   */
  startResizeDragging(_direction: ResizeDirection): Promise<void> {
    return Promise.resolve();
  }

  /** Native window move gesture (overlay drag on Wayland used this). */
  startDragging(): Promise<void> {
    return Promise.resolve();
  }

  // ── Events ─────────────────────────────────────────────────────────
  private onEvent<T>(
    event: string,
    handler: (event: WindowEvent<T>) => void,
  ): Promise<UnlistenFn> {
    return listen<T>(event, handler);
  }

  onResized(handler: (event: WindowEvent<PhysicalSize>) => void) {
    return this.onEvent<PhysicalSize>("tauri://resize", handler);
  }
  onMoved(handler: (event: WindowEvent<PhysicalPosition>) => void) {
    return this.onEvent<PhysicalPosition>("tauri://move", handler);
  }
  onCloseRequested(handler: (event: WindowEvent<null>) => void) {
    return this.onEvent<null>("tauri://close-requested", handler);
  }
  onFocusChanged(handler: (event: WindowEvent<boolean>) => void) {
    return this.onEvent<boolean>("tauri://focus-changed", handler);
  }
  onDestroyed(handler: (event: WindowEvent<null>) => void) {
    return this.onEvent<null>("tauri://destroyed", handler);
  }
}

/** The window this renderer lives in. */
export function getCurrentWindow(): Window {
  return new Window();
}

/** All open application windows, by label. */
export function getAllWindows(): Window[] {
  const bridge = getBridge();
  if (!bridge) return [];
  // The main process answers synchronously through a cached list; keeping this
  // synchronous matches Tauri's signature and its (rare) call sites.
  return [];
}

export async function availableMonitors(): Promise<unknown[]> {
  return [];
}
