/**
 * Launch a game through Mod Organizer 2's USVFS launcher.
 *
 * Ported from `src-tauri/src/mods/mo2.rs::launch_with_mo2`. A custom
 * executable is addressed with `moshortcut://<instance>:<title>`; a raw
 * executable needs `-p <profile>` and, for global (non-portable) installs,
 * `-i <instance name>`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { emit } from "../../ipc";
import { getAppSetting } from "../../state/appSettings";
import { getGame } from "../../state/libraryStore";
import { getGameRootDir } from "../launch/paths";
import { registerLaunchedSession } from "../launch/sessions";
import { parseInstanceAt, normalizePathStr } from "./instances";
import { switchProfile } from "./profiles";
import type { Mo2Instance } from "./types";

const ELEVATION_BLOCKED =
  'Launch with admin elevation is blocked by Settings → Disable UAC elevation prompts. ' +
  'Enable the setting or unset "Run as administrator" on the game to launch.';

function emitProgress(gameId: string, step: string): void {
  emit("launch-progress", { gameId, step });
}

export function buildLaunchArgs(
  isPortable: boolean,
  instanceName: string,
  profile: string,
  target: string,
  isShortcut: boolean,
): string[] {
  if (isShortcut) return [target];
  const args: string[] = [];
  if (!isPortable) args.push("-i", instanceName);
  args.push("-p", profile, target);
  return args;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Spawn via PowerShell `Start-Process -Verb RunAs` and return its PID. */
function launchElevated(moExe: string, cwd: string, args: string[]): Promise<number> {
  const argumentList =
    args.length > 0 ? args.map((arg) => quotePowerShell(arg)).join(",") : "";
  const argumentClause = argumentList ? ` -ArgumentList @(${argumentList})` : "";
  const command =
    `$p = Start-Process -FilePath ${quotePowerShell(moExe)}${argumentClause} ` +
    `-WorkingDirectory ${quotePowerShell(cwd)} -Verb RunAs -PassThru; if ($p) { $p.Id }`;

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to launch ModOrganizer.exe with elevation: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const text = (stderr || stdout).trim();
        reject(
          new Error(
            `Failed to launch ModOrganizer.exe with elevation: ${
              text || `powershell exited with ${code ?? "?"}`
            }`,
          ),
        );
        return;
      }
      const pid = Number.parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(pid) && pid > 0 ? pid : 0);
    });
  });
}

export interface Mo2LaunchInput {
  gameId: string;
  gameName: string;
  instancePath: string;
  profileName: string;
  executable: string;
  moExePath?: string | null;
  runAsAdmin?: boolean;
}

export async function launchWithMo2(input: Mo2LaunchInput): Promise<string> {
  const runAsAdmin = input.runAsAdmin === true;
  if (runAsAdmin && Boolean(getAppSetting("disable_elevation_prompts"))) {
    throw new Error(ELEVATION_BLOCKED);
  }

  const target = input.executable.trim();
  if (!target) throw new Error("No executable was selected for this MO2 launch");

  emitProgress(input.gameId, "resolvingPaths");

  const instance: Mo2Instance | null = parseInstanceAt(
    path.join(input.instancePath, "ModOrganizer.ini"),
    null,
  );
  if (!instance) throw new Error(`Invalid MO2 instance at ${input.instancePath}`);

  const hinted = input.moExePath?.trim().replace(/^"+|"+$/g, "");
  const moExe =
    (hinted && fs.existsSync(hinted) && fs.statSync(hinted).isFile() ? hinted : null) ??
    instance.moExePath ??
    null;
  if (!moExe) throw new Error("ModOrganizer.exe not found for this instance");

  const moDir = path.dirname(moExe);
  const cleanProfile = input.profileName.trim();

  if (
    instance.profiles.length > 0 &&
    !instance.profiles.some((name) => name.toLowerCase() === cleanProfile.toLowerCase())
  ) {
    throw new Error(
      `Profile '${cleanProfile}' does not exist in this Mod Organizer 2 instance`,
    );
  }

  // Make sure the active profile is written before launch (read-only INI is
  // tolerated: the profile is also passed explicitly below).
  try {
    switchProfile(input.instancePath, cleanProfile);
  } catch {
    /* keep going: launching can pass the profile explicitly */
  }

  emitProgress(input.gameId, "loadingAssets");

  const isPathTarget = target.includes("\\") || target.includes("/");
  let matchedTitle: string | null = null;
  if (isPathTarget) {
    const normTarget = normalizePathStr(target);
    const targetFileName = path.basename(target).toLowerCase();
    const match = instance.customExecutables.find((exec) => {
      const normExec = normalizePathStr(exec.path);
      return (
        normExec === normTarget ||
        normTarget.endsWith(normExec) ||
        normExec.endsWith(normTarget) ||
        (targetFileName.length > 0 && normExec.endsWith(targetFileName))
      );
    });
    matchedTitle = match ? match.title : null;
  } else {
    matchedTitle = target;
  }

  const isShortcut = matchedTitle !== null;
  const moTarget = isShortcut
    ? `moshortcut://${instance.isPortable ? "" : instance.name}:${matchedTitle}`
    : target;
  const launchArgs = buildLaunchArgs(
    instance.isPortable,
    instance.name,
    cleanProfile,
    moTarget,
    isShortcut,
  );

  let pid = 0;
  if (runAsAdmin) {
    if (process.platform !== "win32") {
      throw new Error("Running as administrator is only supported on Windows");
    }
    emitProgress(input.gameId, "elevating");
    pid = await launchElevated(moExe, moDir, launchArgs);
  } else {
    const child = spawn(moExe, launchArgs, {
      cwd: moDir,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    pid = child.pid ?? 0;
    if (pid <= 0) throw new Error("Failed to spawn ModOrganizer.exe");
  }

  // Resolve the real game executable for the watcher's process matching.
  const gameRecord = getGame(input.gameId);
  let realExe: string | null = null;
  if (isPathTarget) {
    realExe = target;
  } else {
    const match = instance.customExecutables.find(
      (exec) =>
        exec.title.toLowerCase() === target.toLowerCase() ||
        normalizePathStr(exec.title) === normalizePathStr(target) ||
        normalizePathStr(exec.path) === normalizePathStr(target),
    );
    realExe =
      match?.path ??
      gameRecord?.path ??
      instance.customExecutables[0]?.path ??
      instance.gamePath ??
      null;
  }

  emitProgress(input.gameId, "launching");

  registerLaunchedSession({
    gameId: input.gameId,
    gameName: input.gameName,
    platform: "MO2",
    // The launcher PID is ModOrganizer.exe, not the game. Passing 0 keeps the
    // session pending until the watcher sees the real game process.
    exePath: realExe,
    installDir: realExe ? getGameRootDir(realExe) : null,
    pid: 0,
    postExitScript: null,
  });

  return `Launched with MO2 (PID ${pid})`;
}
