/**
 * "Which library game is running?" for the in-game overlay.
 *
 * Ported from `src-tauri/src/overlay_detect.rs`. Read-only: it never starts a
 * session or records playtime; the overlay polls it when it has no tracked
 * session. Matches by full executable path, then by image name, then by
 * install-directory prefix (launcher hand-offs). Returns `null` when nothing
 * matches.
 */
import path from "node:path";

import { isSkipName, listProcessesDetailed } from "../launch/processes";
import type { ProcessInfo } from "../launch/types";
import { listGames } from "../../state/libraryStore";
import type { Game } from "../../../../src/types/game";

export interface DetectedGame {
  gameId: string;
  name: string;
  pid: number;
}

interface DetectTarget {
  id: string;
  name: string;
  exePath: string;
  installDir: string;
  romGame: boolean;
}

function normalize(value: string): string {
  const lower = value.trim().toLowerCase();
  return process.platform === "win32"
    ? lower.replace(/\//g, "\\")
    : lower.replace(/\\/g, "/");
}

function basenameLower(value: string): string {
  const normalized = normalize(value);
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return normalized.slice(separator + 1);
}

function installDirOf(exePath: string): string {
  const normalized = exePath.trim();
  if (!normalized) return "";
  return normalize(path.dirname(normalized));
}

function isInsideDir(candidate: string, dir: string): boolean {
  if (!candidate || !dir) return false;
  const prefix = dir.replace(/[\\/]+$/, "");
  if (!candidate.startsWith(prefix)) return false;
  const rest = candidate.slice(prefix.length);
  return rest.length > 0 && (rest[0] === "\\" || rest[0] === "/");
}

function buildTargets(games: Game[]): DetectTarget[] {
  const targets: DetectTarget[] = [];
  for (const game of games) {
    const configured = game.detectedExe || game.path || "";
    if (!configured) continue;
    const exePath = configured;
    targets.push({
      id: game.id,
      name: game.name,
      exePath,
      installDir: installDirOf(exePath),
      romGame: Boolean(game.emulatorId),
    });
  }
  return targets;
}

function matchesExact(process: ProcessInfo, target: DetectTarget): boolean {
  if (!process.exePath || !target.exePath) return false;
  return normalize(process.exePath) === normalize(target.exePath);
}

function matchesInstallDir(process: ProcessInfo, target: DetectTarget): boolean {
  if (!process.exePath || !target.installDir || target.romGame) return false;
  return isInsideDir(normalize(process.exePath), target.installDir);
}

/** Pure matcher exported for the harness. */
export function matchDetectedGame(
  processes: ProcessInfo[],
  games: Game[],
  selfPid = process.pid,
): DetectedGame | null {
  const targets = buildTargets(games);
  if (targets.length === 0) return null;
  const live = processes.filter((entry) => entry.pid > 0 && entry.pid !== selfPid);

  // Pass 1: exact executable path. Prefer ordinary games over ROM rows.
  for (const process of live) {
    const target =
      targets.find((entry) => !entry.romGame && matchesExact(process, entry)) ??
      targets.find((entry) => matchesExact(process, entry));
    if (target) return { gameId: target.id, name: target.name, pid: process.pid };
  }

  // Pass 2: image name when the OS withheld the full path. Only accept an
  // unambiguous name; two games with `game.exe` must not be guessed.
  const byName = new Map<string, DetectTarget[]>();
  for (const target of targets) {
    const name = basenameLower(target.exePath);
    if (!name) continue;
    const list = byName.get(name) ?? [];
    list.push(target);
    byName.set(name, list);
  }
  for (const process of live) {
    if (isSkipName(process.name)) continue;
    const name = basenameLower(process.name);
    const candidates = byName.get(name) ?? [];
    const target = candidates.length === 1 ? candidates[0] : null;
    if (target) return { gameId: target.id, name: target.name, pid: process.pid };
  }

  // Pass 3: launcher hand-off — a sibling exe inside the install tree.
  for (const process of live) {
    if (isSkipName(process.name)) continue;
    const target = targets.find((entry) => matchesInstallDir(process, entry));
    if (target) return { gameId: target.id, name: target.name, pid: process.pid };
  }

  return null;
}

/** `overlay_detect_game` — current library game + pid, or `null`. */
export async function overlayDetectGame(): Promise<DetectedGame | null> {
  const games = listGames();
  if (games.length === 0) return null;
  const processes = await listProcessesDetailed();
  const matched = matchDetectedGame(processes, games);
  if (!matched) return null;
  // The WMI snapshot exposes a path for most game processes; if it does not,
  // the name match above is still a valid library hit. Never emit anything:
  // the overlay polls this command.
  return matched;
}
