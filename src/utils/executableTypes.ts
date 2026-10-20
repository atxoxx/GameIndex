/**
 * Program types the import pipeline can turn into a game entry.
 *
 * Covers native Windows binaries, batch / PowerShell launch scripts, and
 * Linux launcher formats. Keep in sync with `PROGRAM_EXTENSIONS` in
 * `src-tauri/src/media.rs`, which drives folder scanning.
 */
export const EXECUTABLE_EXTENSIONS = [
  "exe",
  "bat",
  "cmd",
  "com",
  "ps1",
  "sh",
  "appimage",
  "AppImage",
  "x86_64",
] as const;

/** Extensions for native file-picker filters. */
export const EXECUTABLE_DIALOG_FILTERS = [
  { name: "Executable", extensions: [...EXECUTABLE_EXTENSIONS] },
];

/** Lower-cased extension of `name` without the leading dot, or null. */
export function executableExtensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** True when `name` carries one of the importable program extensions. */
export function hasExecutableExtension(name: string): boolean {
  const ext = executableExtensionOf(name);
  return ext !== null && (EXECUTABLE_EXTENSIONS as readonly string[]).includes(ext);
}

/** Drop a trailing program extension from a file name. */
export function stripExecutableExtension(name: string): string {
  const ext = executableExtensionOf(name);
  if (!ext || !(EXECUTABLE_EXTENSIONS as readonly string[]).includes(ext)) {
    return name;
  }
  return name.slice(0, name.length - ext.length - 1);
}
