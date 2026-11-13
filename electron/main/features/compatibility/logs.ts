/**
 * Per-game Wine/Proton logs.
 *
 * The launcher this wave writes `<userData>/wine_logs/<gameId>.log`; Steam
 * launches drop `steam-<appid>.log` under `<userData>/wine_logs/<gameId>/`.
 * The reader shows whichever file was touched most recently, exactly like
 * `src-tauri/src/compatibility/wine.rs`.
 */
import fs from "node:fs";
import path from "node:path";
import { userDataPath } from "../../lib/paths";
import { getGame } from "../../state/libraryStore";
import type { WineLogResult } from "./types";

export function wineLogsRoot(): string {
  const dir = userDataPath("wine_logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function wineLogPathForGame(gameId: string): string {
  return path.join(wineLogsRoot(), `${gameId}.log`);
}

export function steamWineLogDirForGame(gameId: string): string {
  const dir = path.join(wineLogsRoot(), gameId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newestLogFile(dir: string): string | null {
  let best: { file: string; mtime: number } | null = null;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".log")) continue;
      const file = path.join(dir, entry.name);
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (!best || mtime > best.mtime) best = { file, mtime };
      } catch {
        /* vanished log */
      }
    }
  } catch {
    return null;
  }
  return best?.file ?? null;
}

export function getGameWineLogs(gameId: string): WineLogResult {
  const direct = wineLogPathForGame(gameId);
  const steamDir = steamWineLogDirForGame(gameId);
  const candidates = [direct, newestLogFile(steamDir)].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );

  let chosen: string | null = null;
  let chosenMtime = -1;
  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      const mtime = fs.statSync(candidate).mtimeMs;
      if (mtime > chosenMtime) {
        chosen = candidate;
        chosenMtime = mtime;
      }
    } catch {
      /* missing candidate */
    }
  }

  if (!chosen) {
    // Point at where the next launch would write a log.
    const appId = getGame(gameId)?.steamAppId;
    const fallback =
      typeof appId === "number" && Number.isFinite(appId)
        ? path.join(steamDir, `steam-${appId}.log`)
        : direct;
    return {
      gameId,
      logContent: "",
      exists: false,
      lastModified: null,
      sizeBytes: 0,
      logPath: fallback,
    };
  }

  try {
    const stat = fs.statSync(chosen);
    // Cap the IPC payload; a runaway Proton log must not stall the renderer.
    const MAX = 8 * 1024 * 1024;
    const length = Math.min(stat.size, MAX);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(chosen, "r");
    try {
      fs.readSync(fd, buffer, 0, length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const content = buffer.toString("utf8");
    return {
      gameId,
      logContent:
        stat.size > MAX
          ? `${content}\n\n[GameIndex] Log truncated at 8 MiB (file is ${stat.size} bytes).`
          : content,
      exists: true,
      lastModified: Math.floor(stat.mtimeMs),
      sizeBytes: stat.size,
      logPath: chosen,
    };
  } catch (error) {
    throw new Error(
      `Could not read the Wine log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function clearGameWineLogs(gameId: string): void {
  const direct = wineLogPathForGame(gameId);
  try {
    fs.rmSync(direct, { force: true });
  } catch (error) {
    throw new Error(
      `Could not clear the Wine log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const steamDir = path.join(wineLogsRoot(), gameId);
  try {
    fs.rmSync(steamDir, { recursive: true, force: true });
  } catch (error) {
    throw new Error(
      `Could not clear the Steam Proton log folder: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
