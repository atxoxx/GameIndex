/**
 * Pure helpers for the updater (no Electron imports) so they can be unit-tested.
 */

function versionParts(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** Numeric semver comparison, tolerant of `-electron`/`-tauri` suffixes. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(current);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** `GameIndex_electron_2.4.1_x64_portable.exe` → `2.4.1`. */
export function portableVersionFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  return /_(\d+\.\d+\.\d+)_x64_portable\.exe$/i.exec(name)?.[1] ?? null;
}

/** Strip the `sha256:` prefix GitHub puts in front of asset digests. */
export function digestToSha256(digest: string | null | undefined): string | null {
  if (!digest) return null;
  const value = digest.trim().toLowerCase();
  const raw = value.startsWith("sha256:") ? value.slice(7) : value;
  return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}
