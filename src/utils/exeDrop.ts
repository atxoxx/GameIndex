/**
 * Helpers for executables dropped onto the app from the OS file explorer.
 *
 * Dropped paths keep the host's separators (`\` on Windows, `/` on Linux),
 * so every comparison here works on segments rather than raw strings — the
 * same way `splitPath` does in `components/ImportModal.tsx`.
 */

const EXECUTABLE_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "sh",
  "appimage",
  "x86_64",
]);

/** True for paths the import flow can turn into a game entry. */
export function isImportableExecutablePath(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return EXECUTABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Directory holding `path`, keeping the leading separator of absolute paths. */
export function parentDirOf(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/);
  const absolute = parts[0] === "";
  const kept = parts.filter(Boolean);
  kept.pop();
  return (absolute ? sep : "") + kept.join(sep);
}

/**
 * Deepest directory containing every path.
 *
 * Used as the scan root for a multi-file drop so `ImportModal` groups one
 * entry per game folder instead of collapsing everything into a single
 * drive-level group. Returns "" when the paths share no folder (or live on
 * different drives), which makes the modal fall back to one group per file.
 */
export function commonParentDir(paths: string[]): string {
  if (paths.length === 0) return "";

  const dirs = paths.map((p) => parentDirOf(p).split(/[\\/]/).filter(Boolean));
  const first = dirs[0];
  let shared = first.length;
  for (const other of dirs.slice(1)) {
    let i = 0;
    while (i < shared && i < other.length && other[i].toLowerCase() === first[i].toLowerCase()) {
      i++;
    }
    shared = i;
  }
  if (shared === 0) return "";

  const sep = paths[0].includes("\\") ? "\\" : "/";
  const root = paths.every((p) => p.startsWith("/")) ? sep : "";
  return root + first.slice(0, shared).join(sep);
}
