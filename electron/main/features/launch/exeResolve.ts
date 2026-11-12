/**
 * Executable resolution heuristics.
 *
 * Ported from `src-tauri/src/game_watcher/resolve.rs`: pick the most likely
 * game binary inside an install directory. Used to fill in a Steam game's exe
 * path when the library row only knows the install dir, so the watcher can do
 * exact-path matching instead of relying on directory prefixes.
 */
import path from "node:path";
import { isSkipName } from "./processes";
import { walkDirectory } from "./walk";

export interface ExeCandidate {
  path: string;
  sizeBytes: number;
  depth: number;
}

const PRUNE_DIRS = new Set([
  "redist",
  "redistributables",
  "__installer",
  "support",
  "directx",
  "dotnet",
  "vcredist",
]);

function shouldDescend(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith(".") || lower.startsWith("_")) return false;
  return !PRUNE_DIRS.has(lower);
}

/** Every plausible game executable under `installDir` (depth ≤ 4). */
export async function scanExeCandidates(
  installDir: string,
  options: { limit?: number } = {},
): Promise<ExeCandidate[]> {
  const limit = options.limit ?? 400;
  const candidates: ExeCandidate[] = [];
  await walkDirectory(installDir, {
    maxDepth: 4,
    shouldDescend,
    onFile: (filePath, size, _mtimeMs, depth) => {
      if (candidates.length >= limit) return;
      if (!filePath.toLowerCase().endsWith(".exe")) return;
      const stem = path.basename(filePath, path.extname(filePath));
      if (isSkipName(stem)) return;
      candidates.push({ path: filePath, sizeBytes: size, depth });
    },
  });
  return candidates;
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

/**
 * Score candidates: exact name match (+200), word overlap (+10 each), depth
 * penalty (−5 per level below the root), size as the tiebreaker.
 */
export function scoreExeCandidates(
  candidates: ExeCandidate[],
  gameName: string,
): string | null {
  if (candidates.length === 0) return null;
  const nameLower = gameName.toLowerCase();
  const gameWords = words(gameName);

  const scored = candidates.map((candidate) => {
    const stem = path.basename(candidate.path, path.extname(candidate.path)).toLowerCase();
    let score = 0;
    if (stem === nameLower) score += 200;
    const stemWords = words(stem);
    for (const gameWord of gameWords) {
      for (const stemWord of stemWords) {
        if (stemWord.includes(gameWord) || gameWord.includes(stemWord)) score += 10;
      }
    }
    score = Math.max(0, score - Math.max(0, candidate.depth - 1) * 5);
    return { candidate, score };
  });

  scored.sort(
    (a, b) => b.score - a.score || b.candidate.sizeBytes - a.candidate.sizeBytes,
  );
  return scored[0]?.candidate.path ?? null;
}

/** Resolve the main game executable for an install directory. */
export async function resolveGameExe(
  installDir: string,
  gameName: string,
): Promise<string | null> {
  return scoreExeCandidates(await scanExeCandidates(installDir), gameName);
}
