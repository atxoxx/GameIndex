/**
 * Minimal VDF helpers for Proton compatibility-tool manifests.
 *
 * Steam stores `compatibilitytool.vdf` / bare `*.vdf` manifests as quoted
 * key/value pairs with nested braces. The launcher only needs one key
 * (`install_path`), so a full VDF parser would be unnecessary weight.
 */

/**
 * First value for `key` in a VDF document.
 *
 * Handles both the compact one-line form and pretty-printed manifests:
 *
 * ```
 * "compatibilitytools" { "compat_tools" { "proton-x" {
 *   "install_path" "/usr/share/steam/compatibilitytools.d/proton-x"
 * } } }
 * ```
 */
export function parseVdfValue(raw: string, key: string): string | null {
  const parts = raw.split('"');
  for (let i = 1; i + 2 < parts.length; i += 2) {
    if (parts[i].trim() !== key) continue;
    const value = parts[i + 2].trim();
    if (value) return value;
  }
  return null;
}

/** First `install_path` value in a VDF document. */
export function parseVdfInstallPath(raw: string): string | null {
  return parseVdfValue(raw, "install_path");
}

