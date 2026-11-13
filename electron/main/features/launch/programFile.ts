/**
 * Decide whether a scanned file is a real launchable program.
 *
 * The old predicate (`extension in allowlist || executable bit`) treated every
 * file on an NTFS/exFAT/SMB mount as a program, because those filesystems
 * report mode 0755 for every entry. This module keeps the extension allowlist
 * and only uses the execute bit as a hint that the content is worth probing.
 */
import { programSignature } from "./walk";

/** Extensions the importer can turn into a game entry. */
export const PROGRAM_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "com",
  "ps1",
  "sh",
  "appimage",
  "x86_64",
]);

/**
 * Assets/resources that can never be launched. Skips the content probe for
 * the overwhelming majority of files in a game tree.
 */
export const NON_PROGRAM_EXTENSIONS = new Set([
  "dll", "so", "dylib", "pdb", "lib", "a", "o", "obj",
  "pak", "pck", "dat", "vpk", "assets", "bundle", "resource",
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "svg", "tga", "dds",
  "json", "xml", "cfg", "ini", "txt", "md", "log", "yaml", "yml", "toml",
  "zip", "7z", "rar", "tar", "gz", "xz", "bz2", "cab",
  "mp4", "webm", "mkv", "avi", "mp3", "wav", "ogg", "flac", "opus",
  "ttf", "otf", "woff", "woff2", "pdf", "html", "htm", "css", "js", "map",
]);

export function isProgramExtension(extension: string): boolean {
  return PROGRAM_EXTENSIONS.has(extension.toLowerCase());
}

/** Lowercase extension without the dot, or "" for an extensionless file. */
export function extensionOf(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  const separator = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastDot > separator + 1 ? filePath.slice(lastDot + 1).toLowerCase() : "";
}

/**
 * True when `filePath` is safe to offer as an importable program.
 *
 * `executable` is the filesystem execute bit (always false on Windows). It is
 * only a hint: the content signature decides for extensionless binaries, and
 * the extension allowlist decides everywhere else.
 */
export async function isLaunchableFile(
  filePath: string,
  executable: boolean,
): Promise<boolean> {
  const extension = extensionOf(filePath);
  if (isProgramExtension(extension)) return true;

  // A `.dll`, `.png` or `.txt` stays a resource even if the mount claims it
  // is executable.
  if (!executable || NON_PROGRAM_EXTENSIONS.has(extension)) return false;

  const signature = await programSignature(filePath);
  if (signature === "elf" || signature === "script" || signature === "macho") {
    return true;
  }
  // A PE image without an extension is a renamed `.exe`; a PE with another
  // extension (`.dll`, `.sys`) is not a launchable game binary.
  return signature === "pe" && extension === "";
}
