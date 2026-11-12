/**
 * Ubisoft Connect detection.
 *
 * Port of `src-tauri/src/uplay/cache.rs::scan_installed_uplay_games` and the
 * client probe in `src-tauri/src/uplay/mod.rs`.
 *
 * Windows-only: Ubisoft Connect stores each install as
 * `HKLM\SOFTWARE\ubisoft\Launcher\Installs\<uplayId>` with `InstallDir`.
 * The game's display name is the install folder's name (Playnite parity);
 * there is no local name catalogue.
 */
import fs from "node:fs";
import path from "node:path";
import { cleanRegistryPath, regEnumSubkeys, regQueryValues } from "./proc";
import { resolveExecutable } from "./exe";
import type { DetectedInstall, StoreScanResult } from "./types";

const UPLAY_INSTALL_KEYS = [
  "HKLM\\SOFTWARE\\ubisoft\\Launcher\\Installs",
  "HKLM\\SOFTWARE\\WOW6432Node\\ubisoft\\Launcher\\Installs",
  "HKLM\\SOFTWARE\\Ubisoft\\Launcher\\Installs",
] as const;

export interface UplayClientInfo {
  clientInstalled: boolean;
  clientPath: string;
}

export async function detectUplayClient(): Promise<UplayClientInfo> {
  for (const hive of [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  ]) {
    for (const subkey of await regEnumSubkeys(hive)) {
      const values = await regQueryValues(`${hive}\\${subkey}`);
      if (values.DisplayName?.trim() !== "Ubisoft Connect") continue;
      const installPath = cleanRegistryPath(values.InstallLocation);
      if (!installPath) continue;
      const exe = path.join(installPath, "UbisoftConnect.exe");
      if (fs.existsSync(exe)) {
        return { clientInstalled: true, clientPath: installPath };
      }
    }
  }
  const fallback = path.join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Ubisoft",
    "Ubisoft Game Launcher",
  );
  return {
    clientInstalled: fs.existsSync(path.join(fallback, "UbisoftConnect.exe")),
    clientPath: fs.existsSync(fallback) ? fallback : "",
  };
}

export async function scanUplay(): Promise<StoreScanResult> {
  const probed: string[] = [];
  const errors: string[] = [];
  const installs: DetectedInstall[] = [];
  const seen = new Set<string>();

  for (const key of UPLAY_INSTALL_KEYS) {
    const subkeys = await regEnumSubkeys(key);
    if (subkeys.length > 0) probed.push(key);
    for (const subkey of subkeys) {
      if (seen.has(subkey)) continue;
      const values = await regQueryValues(`${key}\\${subkey}`);
      const rawDir = cleanRegistryPath(values.InstallDir);
      if (!rawDir) continue;
      const installDir = rawDir.replace(/\//g, path.sep);
      let installed = false;
      try {
        installed = (await fs.promises.stat(installDir)).isDirectory();
      } catch {
        installed = false;
      }
      if (!installed) continue;
      seen.add(subkey);
      let name = path.basename(installDir);
      if (!name) name = `Ubisoft Game ${subkey}`;
      installs.push({
        store: "uplay",
        storeId: subkey,
        name,
        installDir,
        exePath: await resolveExecutable(installDir, name),
        installed: true,
        extra: { uplayGameId: subkey },
      });
    }
  }

  // Local product cache is a protobuf-net blob; it carries owned-but-not-
  // installed titles, which are deliberately not imported here (the renderer
  // owns the owned-library import). Availability still depends on it existing.
  const cachePath = path.join(
    process.env.LOCALAPPDATA ?? process.env.LocalAppData ?? "",
    "Ubisoft Game Launcher",
    "cache",
    "configuration",
    "configurations",
  );
  if (cachePath && fs.existsSync(cachePath)) probed.push(cachePath);

  return {
    store: "uplay",
    available: probed.length > 0,
    installs,
    probed,
    errors,
  };
}
