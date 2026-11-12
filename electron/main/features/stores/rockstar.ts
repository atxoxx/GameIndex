/**
 * Rockstar Games Launcher detection.
 *
 * Port of `src-tauri/src/rockstar/mod.rs`. Rockstar has no cloud library API,
 * so this is a pure local scan: the launcher embeds `uninstall=<titleId>` in
 * the uninstall entry's `UninstallString`, and the curated catalogue below
 * (verbatim from Playnite) maps that token to a display name and primary
 * executable.
 */
import fs from "node:fs";
import path from "node:path";
import {
  cleanRegistryPath,
  regEnumSubkeys,
  regQueryValues,
  UNINSTALL_HIVES,
} from "./proc";
import { resolveExecutable } from "./exe";
import type { DetectedInstall, StoreScanResult } from "./types";

interface RockstarGame {
  name: string;
  executable: string;
  titleId: string;
}

const GAMES: RockstarGame[] = [
  { name: "Grand Theft Auto V", executable: "PlayGTAV.exe", titleId: "gta5" },
  { name: "Grand Theft Auto V Enhanced", executable: "GTA5_Enhanced_BE.exe", titleId: "gta5_gen9" },
  { name: "Red Dead Redemption", executable: "RDR.exe", titleId: "rdr" },
  { name: "Red Dead Redemption 2", executable: "RDR2.exe", titleId: "rdr2" },
  { name: "L.A. Noire", executable: "LANoire.exe", titleId: "lanoire" },
  { name: "Max Payne 3", executable: "MaxPayne3.exe", titleId: "mp3" },
  { name: "L.A. Noire: The VR Case Files", executable: "LANoireVR.exe", titleId: "lanoirevr" },
  { name: "Grand Theft Auto: San Andreas", executable: "gta_sa.exe", titleId: "gtasa" },
  { name: "Grand Theft Auto III", executable: "gta3.exe", titleId: "gta3" },
  { name: "Grand Theft Auto: Vice City", executable: "gta-vc.exe", titleId: "gtavc" },
  { name: "Bully: Scholarship Edition", executable: "Bully.exe", titleId: "bully" },
  { name: "Grand Theft Auto IV", executable: "GTAIV.exe", titleId: "gta4" },
  {
    name: "Grand Theft Auto III: The Definitive Edition",
    executable: "Gameface/Binaries/Win64/LibertyCity.exe",
    titleId: "gta3unreal",
  },
  {
    name: "Grand Theft Auto: Vice City – The Definitive Edition",
    executable: "Gameface/Binaries/Win64/ViceCity.exe",
    titleId: "gtavcunreal",
  },
  {
    name: "Grand Theft Auto: San Andreas – The Definitive Edition",
    executable: "Gameface/Binaries/Win64/SanAndreas.exe",
    titleId: "gtasaunreal",
  },
];

const LAUNCHER_DISPLAY_NAME = "Rockstar Games Launcher";

function gameByTitleId(titleId: string): RockstarGame | null {
  const lower = titleId.toLowerCase();
  return GAMES.find((game) => game.titleId === lower) ?? null;
}

export interface RockstarClientInfo {
  clientInstalled: boolean;
  clientPath: string;
}

export async function detectRockstarClient(): Promise<RockstarClientInfo> {
  for (const hive of UNINSTALL_HIVES) {
    for (const subkey of await regEnumSubkeys(hive)) {
      const values = await regQueryValues(`${hive}\\${subkey}`);
      if (values.DisplayName?.trim() !== LAUNCHER_DISPLAY_NAME) continue;
      const installPath = cleanRegistryPath(values.InstallLocation);
      if (!installPath) continue;
      const exe = path.join(installPath, "Launcher.exe");
      if (fs.existsSync(exe)) {
        return { clientInstalled: true, clientPath: installPath };
      }
    }
  }
  return { clientInstalled: false, clientPath: "" };
}

export async function scanRockstar(): Promise<StoreScanResult> {
  const installs: DetectedInstall[] = [];
  const probed: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const uninstallPattern = /(?:Launcher|uninstall)\.exe.+uninstall=(.+)$/i;

  for (const hive of UNINSTALL_HIVES) {
    const subkeys = await regEnumSubkeys(hive);
    for (const subkey of subkeys) {
      const values = await regQueryValues(`${hive}\\${subkey}`);
      const uninstallString = values.UninstallString ?? "";
      if (!uninstallString) continue;
      const match = uninstallString.match(uninstallPattern);
      if (!match) continue;
      const titleId = match[1].trim();
      const game = gameByTitleId(titleId);
      if (!game || seen.has(game.titleId)) continue;

      const installDir = cleanRegistryPath(values.InstallLocation);
      let installed = false;
      if (installDir) {
        try {
          installed = (await fs.promises.stat(installDir)).isDirectory();
        } catch {
          installed = false;
        }
      }
      if (!installed) continue;
      seen.add(game.titleId);
      probed.push(`${hive}\\${subkey}`);

      const hinted = path.join(installDir, game.executable);
      const exePath = fs.existsSync(hinted)
        ? hinted
        : await resolveExecutable(installDir, game.name);
      installs.push({
        store: "rockstar",
        storeId: game.titleId,
        name: game.name,
        installDir,
        exePath,
        installed: true,
        extra: { rockstarTitleId: game.titleId },
      });
    }
  }

  return {
    store: "rockstar",
    available: installs.length > 0 || (await detectRockstarClient()).clientInstalled,
    installs,
    probed,
    errors,
  };
}

/** Launch an installed title through the launcher (DRM/social-club bootstrap). */
export async function launchRockstarTitle(
  titleId: string,
): Promise<number> {
  const { execFile } = await import("node:child_process");
  const client = await detectRockstarClient();
  if (!client.clientInstalled) {
    throw new Error(
      "Rockstar Games Launcher is not installed — install it, or launch the game from its exe.",
    );
  }
  const scan = await scanRockstar();
  const game = scan.installs.find((entry) => entry.storeId === titleId.toLowerCase());
  if (!game?.installDir) {
    throw new Error(`Rockstar title '${titleId}' is not installed on this machine.`);
  }
  const child = execFile(
    path.join(client.clientPath, "Launcher.exe"),
    ["-launchTitleInFolder", game.installDir],
    { windowsHide: false },
  );
  child.unref();
  return child.pid ?? 0;
}

export { GAMES as ROCKSTAR_GAMES };
