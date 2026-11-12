/**
 * `@tauri-apps/api/core` shim.
 *
 * `invoke` is the single RPC entry point: the renderer asks the preload bridge,
 * which forwards the command name + arguments to the Electron main process
 * (`electron/main/ipc.ts`), where `electron/main/commands` owns the registry.
 *
 * `convertFileSrc` maps a filesystem path onto the privileged `giasset://`
 * protocol registered by the main process — the equivalent of Tauri's asset
 * protocol.
 */
import { getBridge, isElectronRuntime } from "./bridge";
import { listen } from "./tauri-event";

export type InvokeArgs =
  | Record<string, unknown>
  | number[]
  | ArrayBuffer
  | Uint8Array
  | undefined;

export interface InvokeOptions {
  headers?: Record<string, string>;
}

const ASSET_ORIGIN = "giasset://local";

/**
 * Bi-directional message channel, mirroring Tauri's `Channel<T>`.
 *
 * The main process can push messages to an invoking caller by sending the
 * `__gi_channel:<id>` event to that web contents.
 */
export class Channel<T = unknown> {
  readonly id: number;
  onmessage: (message: T) => void = () => {};

  constructor(onmessage?: (message: T) => void) {
    if (onmessage) this.onmessage = onmessage;
    this.id = transformCallback((message) => {
      this.onmessage(message as T);
    });
  }

  toJSON(): { __giChannel: number } {
    return { __giChannel: this.id };
  }
}

let nextChannelId = 1;

/** Register a callback the main process can reach by numeric id. */
export function transformCallback(
  callback: (payload: unknown) => void,
  once = false,
): number {
  const id = nextChannelId++;
  const event = `__gi_channel:${id}`;
  void listen(event, (received) => {
    callback(received.payload);
    if (once) {
      // Tauri's one-shot channels are only used by internals we no longer
      // have; a no-op teardown keeps the surface compatible.
    }
  });
  return id;
}

/** Walk arguments, replacing Channel instances with a serializable marker. */
function serialize(value: unknown): unknown {
  if (value instanceof Channel) return { __giChannel: value.id };
  if (Array.isArray(value)) return value.map(serialize);
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serialize(entry);
    }
    return out;
  }
  return value;
}

/** True inside the Electron shell. */
export function isTauri(): boolean {
  return isElectronRuntime();
}

export async function invoke<T>(
  cmd: string,
  args?: InvokeArgs,
  _options?: InvokeOptions,
): Promise<T> {
  const bridge = getBridge();
  if (!bridge) {
    throw new Error(
      `[gameindex] cannot invoke "${cmd}" outside the Electron shell`,
    );
  }
  return (await bridge.invoke(cmd, serialize(args))) as T;
}

/**
 * Convert an absolute filesystem path into a URL the renderer can load.
 *
 * The `giasset://` scheme is registered as standard + secure by the main
 * process and streamed from disk, so images/video/audio keep working (range
 * requests included).
 */
export function convertFileSrc(filePath: string, _protocol = "asset"): string {
  const normalized = filePath.replace(/\\/g, "/");
  return `${ASSET_ORIGIN}/${encodeURIComponent(normalized)}`;
}

/** Path used by the preload when it needs the raw asset origin. */
export const __ASSET_ORIGIN = ASSET_ORIGIN;
