/**
 * Artwork cache sweep for the Storage → Health center.
 *
 * Ported from `src-tauri/src/library_health.rs`. A scan is always read-only:
 * it returns every file under `<userData>/artwork` that no library row
 * references. `delete_orphaned_artwork` re-derives the reference set from the
 * live library before removing anything, so a stale renderer list can never
 * delete live artwork.
 */
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

import { userDataPath } from "../../lib/paths";
import { listGames } from "../../state/libraryStore";
import type { Game } from "../../../../src/types/game";

const ARTWORK_DIR = "artwork";

export interface OrphanArtwork {
  /** Relative to userData, e.g. `artwork/<id>/cover.png`. */
  relativePath: string;
  gameId: string;
  slot: string;
  sizeBytes: number;
  reason: "unreferencedGame" | "unreferencedSlot";
  /** Unix seconds, when the platform reports it. */
  modifiedAt?: number;
}

/** Same sanitizer `download_artwork` uses for on-disk game folders. */
export function safeArtworkComponent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Decode `%XX` sequences without throwing on malformed input. Asset-protocol
 * URLs percent-encode the whole Windows path, so a plain substring match would
 * flag every live file as orphaned.
 */
export function percentDecodeArtworkUrl(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    // Malformed escape — decode the valid runs manually.
  }
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];
    if (ch === "%" && index + 2 < input.length) {
      const value = Number.parseInt(input.slice(index + 1, index + 3), 16);
      if (Number.isFinite(value)) {
        bytes.push(value);
        index += 2;
        continue;
      }
    }
    bytes.push(...Buffer.from(ch, "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Map `safeArtworkComponent(game.id)` to every artwork URL that row uses. */
export function collectReferencedArtwork(games: Game[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const game of games) {
    const key = safeArtworkComponent(game.id).toLowerCase();
    const entry = map.get(key) ?? [];
    for (const url of [game.coverArtUrl, game.iconUrl, game.bannerUrl, game.logoUrl]) {
      if (typeof url !== "string" || !url) continue;
      entry.push(percentDecodeArtworkUrl(url).replace(/\\/g, "/").toLowerCase());
    }
    map.set(key, entry);
  }
  return map;
}

/** True when `relativePath` (`artwork/<dir>/<file>`) is still referenced. */
export function isArtworkReferenced(
  relativePath: string,
  referenced: Map<string, string[]>,
): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/");
  if (parts.length !== 3 || parts[0] !== ARTWORK_DIR) return false;
  const urls = referenced.get(parts[1]);
  if (!urls) return false;
  return urls.some((url) => url.includes(normalized));
}

/** Reject anything that is not exactly `artwork/<dir>/<file>`. */
export function isSafeArtworkPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length !== 3 || parts[0] !== ARTWORK_DIR) return false;
  return parts.every((part) => part.length > 0 && part !== "." && part !== ".." && !part.includes(":"));
}

/**
 * Pure sweep used by the command and the harness. Files are returned
 * size-descending so the UI offers the biggest wins first.
 */
export async function scanArtwork(
  artworkRoot: string,
  referenced: Map<string, string[]>,
): Promise<OrphanArtwork[]> {
  let dirs: fs.Dirent[];
  try {
    dirs = await fsp.readdir(artworkRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: OrphanArtwork[] = [];
  let visited = 0;
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(artworkRoot, dir.name);
    let files: fs.Dirent[];
    try {
      files = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    const dirKnown = referenced.has(dir.name.toLowerCase());
    for (const file of files) {
      visited += 1;
      if (visited % 200 === 0) await new Promise((resolve) => setImmediate(resolve));
      if (!file.isFile()) continue;
      const relativePath = `${ARTWORK_DIR}/${dir.name}/${file.name}`;
      if (isArtworkReferenced(relativePath, referenced)) continue;
      const full = path.join(dirPath, file.name);
      let sizeBytes = 0;
      let modifiedAt: number | undefined;
      try {
        const stat = await fsp.stat(full);
        sizeBytes = stat.size;
        modifiedAt = Math.floor(stat.mtimeMs / 1000);
      } catch {
        /* keep the entry; deletion will skip a vanished file */
      }
      const dot = file.name.lastIndexOf(".");
      out.push({
        relativePath,
        gameId: dir.name,
        slot: dot > 0 ? file.name.slice(0, dot) : file.name,
        sizeBytes,
        reason: dirKnown ? "unreferencedSlot" : "unreferencedGame",
        modifiedAt,
      });
    }
  }
  out.sort((a, b) => b.sizeBytes - a.sizeBytes || a.relativePath.localeCompare(b.relativePath));
  return out;
}

/** `scan_orphaned_artwork` — dry run, never deletes. */
export async function scanOrphanedArtwork(): Promise<OrphanArtwork[]> {
  const root = userDataPath(ARTWORK_DIR);
  try {
    const stat = await fsp.stat(root);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  const referenced = collectReferencedArtwork(listGames());
  return scanArtwork(root, referenced);
}

async function pruneEmptyFolder(folder: string, artworkRoot: string): Promise<void> {
  if (path.resolve(folder) === path.resolve(artworkRoot)) return;
  try {
    const entries = await fsp.readdir(folder);
    if (entries.length === 0) await fsp.rmdir(folder);
  } catch {
    /* not empty or already gone */
  }
}

/** `delete_orphaned_artwork` — returns bytes reclaimed. */
export async function deleteOrphanedArtwork(relativePaths: string[]): Promise<number> {
  const root = userDataPath(ARTWORK_DIR);
  const rootResolved = path.resolve(root);
  const referenced = collectReferencedArtwork(listGames());
  let freed = 0;

  for (const relativePath of relativePaths) {
    if (typeof relativePath !== "string" || !isSafeArtworkPath(relativePath)) continue;
    const normalized = relativePath.replace(/\\/g, "/");
    if (isArtworkReferenced(normalized, referenced)) continue;
    const components = normalized.split("/").slice(1);
    const full = path.resolve(root, ...components);
    if (!full.startsWith(rootResolved + path.sep)) continue;
    try {
      const stat = await fsp.stat(full);
      if (!stat.isFile()) continue;
      await fsp.unlink(full);
      freed += stat.size;
      await pruneEmptyFolder(path.dirname(full), rootResolved);
    } catch {
      /* file already gone or locked — report only what was actually freed */
    }
  }
  return freed;
}
