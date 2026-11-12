/**
 * Path helpers shared by the launch / watcher modules.
 *
 * Ported from `src-tauri/src/game_watcher/paths.rs`. Everything here works on
 * *strings* and is used for comparison only — stored exe paths are never
 * rewritten.
 */
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";

/** Current wall-clock time in Unix milliseconds (the clock the renderer uses). */
export function nowUnixMs(): number {
  return Date.now();
}

/**
 * Lower-cased, separator-normalised path for case-insensitive matching.
 * Windows folds `/` to `\`; POSIX folds `\` to `/`.
 */
export function normalizePathLower(value: string): string {
  if (!value) return "";
  const lower = value.toLowerCase();
  return IS_WINDOWS ? lower.replace(/\//g, "\\") : lower.replace(/\\/g, "/");
}

export function isPathSep(ch: string): boolean {
  return ch === "\\" || ch === "/";
}

/** Trim trailing separators from an already-normalised path. */
export function trimPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

/** Base name of a path, lower-cased (`"Game.exe"` → `"game.exe"`). */
export function baseNameLower(value: string): string {
  const norm = normalizePathLower(value);
  if (!norm) return "";
  const sep = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return norm.slice(sep + 1);
}

/** Lower-cased file stem of an exe path (`"C:\x\Game.exe"` → `"game"`). */
export function exeStemLower(value: string): string {
  const base = baseNameLower(value);
  if (!base) return "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Extract the game root directory from an executable path, walking up out of
 * common binary/helper subfolders (`bin`, `win64`, `launcher`, …) so a
 * launcher and the game it starts resolve to the same install tree.
 * Mirrors `get_game_root_dir`.
 */
export function getGameRootDir(exePath: string): string | null {
  if (!exePath) return null;
  try {
    if (path.isAbsolute(exePath) || /^[a-zA-Z]:[\\/]/.test(exePath)) {
      // `path.dirname` handles both separator styles on Windows.
      let current = path.dirname(exePath);
      const commonSubdirs = [
        "bin",
        "binaries",
        "win64",
        "win32",
        "x64",
        "x86",
        "release",
        "debug",
        "win-x64",
        "win-x86",
        "game",
        "retail",
        "launcher",
      ];
      for (let i = 0; i < 3; i += 1) {
        const name = current.split(/[\\/]/).filter(Boolean).pop() ?? "";
        if (commonSubdirs.includes(name.toLowerCase())) {
          const parent = path.dirname(current);
          if (parent && parent !== current) {
            current = parent;
            continue;
          }
        }
        break;
      }
      return current;
    }
  } catch {
    /* malformed path — fall through */
  }
  const sep = Math.max(exePath.lastIndexOf("/"), exePath.lastIndexOf("\\"));
  return sep > 0 ? exePath.slice(0, sep) : null;
}

/**
 * True when `candidateNorm` (normalised) really lives inside `dirNorm`.
 * The boundary check keeps `…\FooBar` from matching `…\Foo`.
 */
export function isInsideDir(candidateNorm: string, dirNorm: string): boolean {
  const dir = trimPathSeparators(dirNorm);
  if (!dir || !candidateNorm.startsWith(dir)) return false;
  const remainder = candidateNorm.slice(dir.length);
  return remainder === "" || isPathSep(remainder[0]) || remainder[0] === ":";
}

/** Absolute-looking path test that accepts both Windows and POSIX forms. */
export function looksAbsolute(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.startsWith("\\\\")) return true;
  return trimmed.startsWith("/");
}
