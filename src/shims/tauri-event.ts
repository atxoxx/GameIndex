/**
 * `@tauri-apps/api/event` shim.
 *
 * Events flow through the preload bridge (`gi:event` IPC channel). The payload
 * shape matches Tauri's `Event<T>` so existing handlers keep type-checking.
 */
import { getBridge, type UnlistenFn } from "./bridge";

export type { UnlistenFn };

export interface Event<T> {
  /** Event name. */
  event: string;
  /** Monotonic id, only unique within this renderer. */
  id: number;
  payload: T;
}

let nextEventId = 1;

export async function listen<T>(
  event: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  const bridge = getBridge();
  if (!bridge) return () => {};
  const id = nextEventId++;
  return bridge.listen(event, (payload) => {
    handler({ event, id, payload: payload as T });
  });
}

export async function once<T>(
  event: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  let disposed = false;
  let unlisten: UnlistenFn = () => {};
  unlisten = await listen<T>(event, (payload) => {
    if (disposed) return;
    disposed = true;
    unlisten();
    handler(payload);
  });
  if (disposed) unlisten();
  return () => {
    disposed = true;
    unlisten();
  };
}

/** Broadcast an event to every window and the main process. */
export async function emit(event: string, payload?: unknown): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  await bridge.emit(event, payload);
}

/** Targeted emit. There is no per-webview routing any more; broadcast. */
export async function emitTo(
  _target: unknown,
  event: string,
  payload?: unknown,
): Promise<void> {
  await emit(event, payload);
}

export interface Options {
  target?: unknown;
}
