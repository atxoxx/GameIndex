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
