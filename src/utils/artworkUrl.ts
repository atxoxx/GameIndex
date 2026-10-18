import { convertFileSrc } from "@tauri-apps/api/core";
import { type Game, resolveSteamAppId } from "../types/game";

/**
 * True iff a stored artwork URL can actually be rendered by the webview:
 * base64 data URLs, asset-protocol URLs, or (for legacy remote rows) a
 * plain http(s) URL. Raw `file://` URLs are blocked by the webview
 * (WebView2 refuses file: subresource loads from a tauri:// page), so
 * they are NOT considered usable here — callers should convert them with
 * `toWebviewAssetUrl` first.
 */
export function isUsableImageUrl(u: string | undefined | null): boolean {
  if (!u) return false;
  return (
    u.startsWith("data:") ||
    u.startsWith("asset:") ||
    u.startsWith("asset.localhost/") ||
    u.startsWith("http://asset.localhost/") ||
    u.startsWith("https://asset.localhost/") ||
    /^https?:\/\//i.test(u)
  );
}

/**
 * Convert a `file://` URL (what the backend `artwork_asset_url` command
 * returns) into an asset-protocol URL the webview is allowed to load.
 * Any other URL is returned unchanged.
 */
export function toWebviewAssetUrl(u: string): string {
  if (!u.startsWith("file://")) return u;
  // `Url::from_file_path` percent-encodes the path; undo that before
  // handing the absolute path to `convertFileSrc` (which re-encodes).
  // The path component starts after `file://`: on Windows it is
  // `/C:/...` (the leading slash is a URL artifact), on unix `/home/...`
  // (the leading slash belongs to the path).
  const decoded = decodeURIComponent(u.slice("file://".length));
  const path =
    decoded.startsWith("/") && /^\/[A-Za-z]:\//.test(decoded)
      ? decoded.slice(1)
      : decoded;
  return convertFileSrc(path);
}

/** Artwork display fields stored on a Game row. */
const ARTWORK_FIELDS = ["coverArtUrl", "iconUrl", "bannerUrl", "logoUrl"] as const;

/**
 * Repair legacy rows: before the asset protocol was enabled, artwork URLs
 * were persisted as `file://` URLs which the webview refuses to load.
 * Convert those back to loadable asset-protocol URLs on load.
 */
export function normalizeGameArtworkUrls(game: Game): Game {
  let changed = false;
  const next = { ...game };
  for (const field of ARTWORK_FIELDS) {
    const value = next[field];
    if (typeof value === "string" && value.startsWith("file://")) {
      next[field] = toWebviewAssetUrl(value);
      changed = true;
    }
  }
  return changed ? next : game;
}

/**
 * Safely resolve any stored artwork URL or local filesystem path into
 * a URL loadable by the Tauri webview.
 * - Leaves http(s), data:, and asset-protocol URLs untouched.
 * - Converts file:// URLs via `toWebviewAssetUrl`.
 * - Converts bare absolute filesystem paths via `convertFileSrc`.
 * - Returns null for falsy / whitespace-only inputs.
 */
export function safeArtworkUrl(u: string | undefined | null): string | null {
  if (!u || typeof u !== "string") return null;
  const trimmed = u.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("file://")) {
    return toWebviewAssetUrl(trimmed);
  }
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("asset:") ||
    trimmed.startsWith("asset.localhost/") ||
    trimmed.startsWith("http://asset.localhost/") ||
    trimmed.startsWith("https://asset.localhost/") ||
    /^https?:\/\//i.test(trimmed)
  ) {
    return trimmed;
  }
  try {
    return convertFileSrc(trimmed);
  } catch {
    return trimmed;
  }
}

const THUMB_BASENAME = /^(cover|banner|hero)\.([a-z0-9]+)$/i;

/**
 * Rewrite a disk-backed grid artwork URL to its downscaled `_thumb.webp`
 * sibling (e.g. `.../cover.jpg` → `.../cover_thumb.webp`), the variant the
 * backend writes alongside the full-resolution file, or a `library_600x900_2x`
 * Steam CDN poster to its 1x sibling — a 1200×1800 bitmap decoded into a
 * ~200px grid card is exactly the image-cache waste WebKitGTK is worst at.
 * Returns null when no smaller variant exists.
 */
export function thumbVariantUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string") return null;
  const steamThumb = /^https:\/\/[^/]*steamstatic\.com\/steam\/apps\/(\d+)\/library_600x900_2x\.jpg$/i.exec(
    url
  );
  if (steamThumb) {
    return `https://cdn.akamai.steamstatic.com/steam/apps/${steamThumb[1]}/library_600x900.jpg`;
  }
  const isLocalAsset =
    url.startsWith("asset:") ||
    url.startsWith("asset.localhost/") ||
    url.startsWith("http://asset.localhost/") ||
    url.startsWith("https://asset.localhost/") ||
    /^[a-zA-Z]:[\\/]/.test(url) ||
    url.startsWith("/");
  if (!isLocalAsset) return null;
  // `convertFileSrc` percent-encodes the whole path on Windows, so a separator
  // can be `/`, `\`, `%2F` (1 char) or `%5C` (3 chars). Track where the last
  // one actually ends so the basename is sliced at the right offset.
  const separators: ReadonlyArray<readonly [number, number]> = [
    [url.lastIndexOf("/"), 1],
    [url.lastIndexOf("\\"), 1],
    [url.lastIndexOf("%5C"), 3],
    [url.lastIndexOf("%2F"), 3],
  ];
  let sepEnd = 0;
  for (const [start, len] of separators) {
    if (start >= 0 && start + len > sepEnd) sepEnd = start + len;
  }
  const base = url.slice(sepEnd);
  if (!THUMB_BASENAME.test(base)) return null;
  return `${url.slice(0, sepEnd)}${base.replace(/\.[a-z0-9]+$/i, "_thumb.webp")}`;
}

/**
 * Resolve an official clear logo URL for a game, checking `game.logoUrl`
 * first, and falling back to the canonical Steam CDN logo if the game
 * has a known Steam AppID.
 */
export function resolveGameLogo(game?: Game | null): string | null {
  if (!game) return null;
  if (game.logoUrl) {
    const safe = safeArtworkUrl(game.logoUrl);
    if (safe) return safe;
  }
  const steamAppId = resolveSteamAppId(game);
  if (steamAppId) {
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/logo.png`;
  }
  return null;
}
