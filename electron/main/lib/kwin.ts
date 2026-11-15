/**
 * Best-effort "keep above" for the in-game HUD on KDE Wayland.
 *
 * Electron's `setAlwaysOnTop` is a no-op on native Wayland. KWin exposes a
 * scripting D-Bus interface that can set `keepAbove` on matching windows, so
 * when the session is KDE/Wayland we install a tiny script that keeps the
 * overlay window above games and the launcher. Other desktops are untouched
 * (X11/Windows already honour `setAlwaysOnTop`).
 *
 * The script is re-applied when the HUD is shown again (throttled): a KWin
 * restart or a compositor reload otherwise drops the rule silently.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT_NAME = "gameindex-overlay-keepabove";
const REAPPLY_THROTTLE_MS = 30_000;

function isKdeWayland(): boolean {
  if (process.platform !== "linux") return false;
  const desktop = (
    process.env.XDG_CURRENT_DESKTOP ??
    process.env.XDG_SESSION_DESKTOP ??
    ""
  ).toLowerCase();
  const wayland =
    process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland";
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

/**
 * Call a KWin scripting method. KDE ships `qdbus6` on Plasma 6 and `qdbus` on
 * Plasma 5; trying both keeps the integration working across generations.
 * Resolves `true` when any binary accepted the call.
 */
function dbusCall(
  method: string,
  args: string[],
  timeout = 2500,
): Promise<boolean> {
  const binaries = ["qdbus6", "qdbus"];
  return new Promise((resolve) => {
    const tryNext = (index: number) => {
      if (index >= binaries.length) {
        resolve(false);
        return;
      }
      execFile(
        binaries[index],
        ["org.kde.KWin", "/Scripting", `org.kde.kwin.Scripting.${method}`, ...args],
        { timeout, windowsHide: true },
        (error) => {
          if (error) tryNext(index + 1);
          else resolve(true);
        },
      );
    };
    tryNext(0);
  });
}

let installed = false;
let lastApplied = 0;

async function installScript(): Promise<boolean> {
  try {
    const file = path.join(os.tmpdir(), `${SCRIPT_NAME}.js`);
    fs.writeFileSync(file, scriptSource(), "utf8");
    const unloaded = await dbusCall("unloadScript", [SCRIPT_NAME]);
    const loaded = await dbusCall("loadScript", [file, SCRIPT_NAME]);
    const started = await dbusCall("start", []);
    if (loaded || unloaded || started) {
      lastApplied = Date.now();
      console.info("[overlay] installed KWin keep-above rule for the HUD");
      return true;
    }
    return false;
  } catch (error) {
    console.warn("[overlay] could not install the KWin keep-above rule:", error);
    return false;
  }
}

/** Install the KWin keep-above script once per app run. */
export async function ensureKwinOverlayKeepAbove(): Promise<void> {
  if (installed || !isKdeWayland()) return;
  installed = true;
  await installScript();
}

/**
 * Re-apply the rule after a compositor restart / HUD re-show. Throttled so a
 * hotkey burst cannot spawn a qdbus process per press.
 */
export async function reapplyKwinOverlayKeepAbove(): Promise<void> {
  if (!isKdeWayland()) return;
  if (Date.now() - lastApplied < REAPPLY_THROTTLE_MS) return;
  await installScript();
}
