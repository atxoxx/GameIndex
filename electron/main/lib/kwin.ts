/**
 * Best-effort "keep above" for the in-game HUD on KDE Wayland.
 *
 * Electron's `setAlwaysOnTop` is a no-op on native Wayland. KWin exposes a
 * scripting D-Bus interface that can set `keepAbove` on matching windows, so
 * when the session is KDE/Wayland we install a tiny script that keeps the
 * overlay window above games and the launcher. Other desktops are untouched
 * (X11/Windows already honour `setAlwaysOnTop`).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT_NAME = "gameindex-overlay-keepabove";

function isKdeWayland(): boolean {
  if (process.platform !== "linux") return false;
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? "").toLowerCase();
  const wayland = process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland";
  return Boolean(wayland) && desktop.includes("kde");
}

function scriptSource(): string {
  return `const ws = (typeof workspace !== "undefined") ? workspace : (typeof Workspace !== "undefined" ? Workspace : null);
function giApply(w) {
  if (!w) return;
  if (w.caption === "GameIndex Overlay") {
    w.keepAbove = true;
    w.skipTaskbar = true;
    w.noBorder = true;
  }
}
if (ws) {
  const list = ws.windowList ? ws.windowList() : (ws.clientList ? ws.clientList() : []);
  list.forEach(giApply);
  if (ws.windowAdded && ws.windowAdded.connect) ws.windowAdded.connect(giApply);
  if (ws.clientAdded && ws.clientAdded.connect) ws.clientAdded.connect(giApply);
}
`;
}

function dbusCall(method: string, args: string[], timeout = 2500): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      "qdbus6",
      ["org.kde.KWin", "/Scripting", `org.kde.kwin.Scripting.${method}`, ...args],
      { timeout, windowsHide: true },
      () => resolve(),
    );
  });
}

let installed = false;

/** Install the KWin keep-above script once per app run. */
export async function ensureKwinOverlayKeepAbove(): Promise<void> {
  if (installed || !isKdeWayland()) return;
  installed = true;
  try {
    const file = path.join(os.tmpdir(), `${SCRIPT_NAME}.js`);
    fs.writeFileSync(file, scriptSource(), "utf8");
    await dbusCall("unloadScript", [SCRIPT_NAME]);
    await dbusCall("loadScript", [file, SCRIPT_NAME]);
    await dbusCall("start", []);
    console.info("[overlay] installed KWin keep-above rule for the HUD");
  } catch (error) {
    console.warn("[overlay] could not install the KWin keep-above rule:", error);
  }
}
