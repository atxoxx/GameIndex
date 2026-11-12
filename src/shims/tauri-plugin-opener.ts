/** `@tauri-apps/plugin-opener` shim (shell.openExternal / openPath). */
import { getBridge } from "./bridge";

function shell(
  kind: "openUrl" | "openPath" | "revealItemInDir",
  target: string,
): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return Promise.reject(new Error("[gameindex] shell needs Electron"));
  return bridge.shell(kind, target);
}

/** Open a URL in the user's default browser. */
export async function openUrl(url: string): Promise<void> {
  await shell("openUrl", url);
}

/** Open a file, folder, or URL with the OS default handler. */
export async function openPath(path: string): Promise<void> {
  await shell("openPath", path);
}

/** Show a file in the OS file manager. */
export async function revealItemInDir(path: string): Promise<void> {
  await shell("revealItemInDir", path);
}
