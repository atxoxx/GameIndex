/**
 * Linux login autostart.
 *
 * Electron's `app.setLoginItemSettings` only exists on Windows/macOS, so the
 * Linux build previously persisted the toggle and did nothing. The freedesktop
 * convention is a desktop entry in `$XDG_CONFIG_HOME/autostart` (usually
 * `~/.config/autostart`), which every GNOME/KDE/XFCE session (and SteamOS)
 * reads at login.
 *
 * The entry points at the AppImage when the app runs from one: the mounted
 * path in `/tmp/.mount_*` changes on every launch and disappears on exit, so
 * `process.execPath` would create a dead entry.
 */
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DESKTOP_FILE = "gameindex.desktop";

function configHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return xdg;
  return path.join(os.homedir(), ".config");
}

export function linuxAutostartPath(): string {
  return path.join(configHome(), "autostart", DESKTOP_FILE);
}

/** True when the login entry is installed. */
export function linuxAutostartEnabled(): boolean {
  try {
    return fs.existsSync(linuxAutostartPath());
  } catch {
    return false;
  }
}

/** `Exec=` value: the AppImage itself when there is one, quoted for spaces. */
function execValue(): string | null {
  const appImage = process.env.APPIMAGE?.trim();
  const executable = appImage && fs.existsSync(appImage) ? appImage : process.execPath;
  if (!executable) return null;
  return executable.includes(" ") ? `"${executable}"` : executable;
}

/**
 * Install or remove the autostart entry. Returns the file path it wrote (or
 * would have written) so a failed write can be logged by the caller.
 */
export function setLinuxAutostart(enabled: boolean): string {
  const file = linuxAutostartPath();

  if (!enabled) {
    try {
      fs.rmSync(file, { force: true });
    } catch (error) {
      console.warn("[autostart] could not remove the desktop entry:", error);
    }
    return file;
  }

  if (!app.isPackaged) {
    // A dev build's execPath is the Electron binary, which would start a
    // blank Electron session instead of GameIndex.
    console.warn("[autostart] skipping desktop entry for an unpackaged build");
    return file;
  }

  const exec = execValue();
  if (!exec) {
    console.warn("[autostart] no executable path available for the desktop entry");
    return file;
  }

  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=GameIndex",
    "Comment=A unified game library application",
    `Exec=${exec}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "Categories=Game;",
    "",
  ].join("\n");

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, entry, "utf8");
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o644);
  } catch (error) {
    console.warn("[autostart] could not write the desktop entry:", error);
  }
  return file;
}
