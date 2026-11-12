/** `@tauri-apps/plugin-process` shim. */
import { getBridge } from "./bridge";

function bridgeCall<T>(op: string): Promise<T> {
  const bridge = getBridge();
  if (!bridge) return Promise.reject(new Error("[gameindex] process needs Electron"));
  return bridge.windowOp(op) as Promise<T>;
}

/** Restart the application (used after a portable update). */
export async function relaunch(): Promise<void> {
  await bridgeCall("relaunch");
}

/** Exit the application. */
export async function exit(code?: number): Promise<void> {
  await bridgeCall(code === undefined ? "exit" : `exit:${code}`);
}
