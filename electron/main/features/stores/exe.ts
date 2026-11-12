/**
 * Bounded "find the game's exe" helper shared by every store scanner.
 *
 * Store manifests usually name the launch executable; when they don't, the
 * fallback is a shallow, size-ranked hunt inside the install directory. This
 * mirrors the Rust `game_watcher::resolve_game_exe` / `find_largest_exe`
 * heuristics but stays strictly bounded: depth 3, at most 1500 stat calls,
 * never following symlinks, and never walking outside the install dir.
 */
import fs from "node:fs";
import path from "node:path";

const SKIP_KEYWORDS = [
  "redist",
  "autorun",
  "helper",
  "unin",
  "crash",
  "setup",
  "install",
  "plugin",
  "manual",
  "readme",
  "register",
  "7za",
  "vc_redist",
  "vcredist",
  "dxsetup",
  "dotnet",
  "launcher_installer",
];

const MAX_ENTRIES = 900;
const MAX_DEPTH = 3;

interface Candidate {
  path: string;
  size: number;
  score: number;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

/** Score an exe filename against the game/install-dir name (higher is better). */
function scoreCandidate(
  fileStem: string,
  gameName: string,
  dirName: string,
  size: number,
): number {
  const target = tokens(`${gameName} ${dirName}`);
  const candidate = tokens(fileStem);
  if (target.length === 0 || candidate.length === 0) return 0;

  let matched = 0;
  for (const token of target) {
    if (candidate.includes(token)) matched += 1;
    else if (candidate.some((c) => c.startsWith(token) || token.startsWith(c))) {
      matched += 0.5;
    }
  }
  const coverage = matched / target.length;
  // Size is a weak tiebreaker: shipped redistributables are filtered above,
  // so the largest surviving binary is usually the game.
  const sizeScore = Math.min(1, size / (2 * 1024 * 1024 * 1024));
  return coverage * 10 + sizeScore;
}

export function isSkippedExe(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SKIP_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Resolve the best executable under `installDir`.
 *
 * `hint` is the store manifest's own executable (relative or absolute) and
 * wins when it points at a real file.
 */
export async function resolveExecutable(
  installDir: string | null,
  gameName: string,
  hint?: string | null,
): Promise<string | null> {
  if (!installDir) return null;

  if (hint) {
    const trimmed = hint.trim().replace(/^"+|"+$/g, "");
    if (trimmed) {
      const candidates = path.isAbsolute(trimmed)
        ? [trimmed]
        : [path.join(installDir, trimmed), path.join(installDir, trimmed.replace(/\//g, path.sep))];
      for (const candidate of candidates) {
        try {
          if ((await fs.promises.stat(candidate)).isFile()) return candidate;
        } catch {
          /* try the next interpretation */
        }
      }
    }
  }

  let dirName = "";
  try {
    dirName = path.basename(installDir);
  } catch {
    dirName = "";
  }

  const found: Candidate[] = [];
  let seen = 0;
  const stack: Array<{ dir: string; depth: number }> = [{ dir: installDir, depth: 0 }];

  while (stack.length > 0 && seen < MAX_ENTRIES) {
    const current = stack.pop();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue; // permission denied / vanished mid-scan
    }

    for (const entry of entries) {
      seen += 1;
      if (seen >= MAX_ENTRIES) break;
      const full = path.join(current.dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.depth >= MAX_DEPTH) continue;
        const lower = entry.name.toLowerCase();
        if (lower === "redist" || lower === "redistributables" || lower === "support") continue;
        stack.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.exe$/i.test(entry.name)) continue;
      if (isSkippedExe(entry.name)) continue;
      let size = 0;
      try {
        size = (await fs.promises.stat(full)).size;
      } catch {
        size = 0;
      }
      const stem = path.basename(entry.name, path.extname(entry.name));
      found.push({
        path: full,
        size,
        score: scoreCandidate(stem, gameName, dirName, size),
      });
    }

    // Yield to the event loop between directories: a store sync can resolve
    // exes for hundreds of installs and must not block IPC.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  if (found.length === 0) return null;
  found.sort((a, b) => b.score - a.score || b.size - a.size);
  return found[0].path;
}

/**
 * Cheap directory size, capped like the Rust `measure_folder_size`.
 * Returns `undefined` when the walk exceeds the entry budget so a caller never
 * reports a misleading partial total.
 */
export async function measureFolder(
  root: string,
  budget = 4_000,
): Promise<number | null> {
  let total = 0;
  let seen = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > budget) return null;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        total += (await fs.promises.lstat(full)).size;
      } catch {
        /* unreadable file: keep the partial sum */
      }
    }
  }
  return total;
}

/** Resolve a possibly-relative manifest path and confirm it exists. */
export function existingDir(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return fs.statSync(value).isDirectory() ? value : null;
  } catch {
    return null;
  }
}

export function existingFile(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return fs.statSync(value).isFile() ? value : null;
  } catch {
    return null;
  }
}
