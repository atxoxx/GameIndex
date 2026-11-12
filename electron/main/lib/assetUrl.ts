/**
 * Asset URL normalisation.
 *
 * The retired Tauri build addressed local files through its asset protocol and
 * persisted those URLs in the database (`http://asset.localhost/<encoded path>`
 * on Windows, `asset://localhost/...` on Linux). Electron serves the same files
 * through the `giasset://local/<encoded path>` scheme, so those stored values
 * must be rewritten on read — otherwise covers, icons and banners silently fail
 * to load after migration.
 *
 * The path component is kept exactly as stored (already percent-encoded) so the
 * rewrite is a scheme swap, not a re-encoding.
 */
const TAURI_ASSET_URL =
  /^(?:https?:\/\/asset\.localhost|asset:\/\/localhost|https?:\/\/asset\.localhost)\/(.*)$/i;

export function normalizeAssetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = TAURI_ASSET_URL.exec(trimmed);
  if (match) return `giasset://local/${match[1]}`;
  return trimmed;
}

/** Same, but leaves `null`/`undefined`/empty values untouched. */
export function normalizeOptionalAssetUrl(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = normalizeAssetUrl(value);
  return normalized ?? undefined;
}
