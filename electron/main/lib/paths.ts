/**
 * Filesystem locations shared by every backend port.
 *
 * Keep all user-facing data under `app.getPath("userData")` so a future
 * uninstall / backup story has one root, and all thrown-away data under
 * `cachePath()`.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export function userDataPath(...parts: string[]): string {
  return path.join(app.getPath("userData"), ...parts);
}

export function cachePath(...parts: string[]): string {
  return path.join(app.getPath("userData"), "cache", ...parts);
}

export function tempPath(...parts: string[]): string {
  return path.join(app.getPath("temp"), "gameindex", ...parts);
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Where the SQLite databases live (one file per domain, like the Rust split). */
export const DB_DIR = "db";

export function dbPath(name: string): string {
  return ensureDir(userDataPath(DB_DIR)) && path.join(userDataPath(DB_DIR), name);
}

/** True when the Tauri-era app data directory exists (import source). */
export function legacyAppDataDir(): string | null {
  const candidates = [
    path.join(app.getPath("appData"), "com.gameindex.app"),
    path.join(app.getPath("appData"), "GameIndex"),
    path.join(app.getPath("appData"), "gameindex"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}
