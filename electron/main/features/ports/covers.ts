/**
 * Cover art for unofficial-port cards.
 *
 * Resolution order:
 *   1. SteamGridDB by title (works for console games, portrait grids, already
 *      rate-limited and cached by the metadata module).
 *   2. Steam store search -> library capsule, then header capsule as the
 *      renderer-side fallback.
 *
 * The wiki table has no images, so art is resolved lazily per visible card in
 * the renderer and cached for a month (a negative result is cached too - most
 * console titles simply are not on Steam).
 */
import { cached, cacheDelete } from "../metadata/cache";
import { sgdbGetAssets } from "../metadata/steamgriddb";
import { httpJson } from "../../lib/http";
import type { PortCover } from "../../../../src/types/port";

const COVER_TTL = 30 * 24 * 60 * 60_000;

const EMPTY: PortCover = {
  url: null,
  thumbUrl: null,
  fallbackUrl: null,
  source: null,
};

/** Strip disambiguation suffixes and trademark noise before searching. */
export function coverQuery(name: string): string {
  return name
    .replace(/\((?:[^()]*)\)/g, " ")
    .replace(/[™®©]/g, "")
    .replace(/\s*[-–—]\s*(?:recompiled|recomp|decompiled|decomp|remake|port)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(name: string): string {
  return `cover:${coverQuery(name).toLowerCase()}`;
}

interface SteamStoreSearchResponse {
  items?: { id?: number; name?: string }[];
}

async function steamCover(name: string): Promise<PortCover | null> {
  const query = coverQuery(name);
  if (!query) return null;
  try {
    const payload = await httpJson<SteamStoreSearchResponse>(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`,
      { timeoutMs: 8_000, retries: 0 },
    );
    const appId = payload.items?.[0]?.id;
    if (!appId) return null;
    const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
    return {
      url: `${base}/library_600x900.jpg`,
      thumbUrl: `${base}/library_600x900.jpg`,
      fallbackUrl: `${base}/header.jpg`,
      source: "steam",
    };
  } catch {
    return null;
  }
}

async function resolveCover(name: string): Promise<PortCover> {
  try {
    const assets = await sgdbGetAssets(null, coverQuery(name));
    if (assets?.gridUrl) {
      return {
        url: assets.gridUrl,
        thumbUrl: assets.gridThumbUrl || assets.gridUrl,
        fallbackUrl: assets.heroUrl || null,
        source: "steamgriddb",
      };
    }
  } catch {
    // Missing key or provider outage - try the keyless Steam search.
  }
  return (await steamCover(name)) ?? EMPTY;
}

/** Cached cover for one title. `force` re-resolves a previously missed one. */
export async function getPortCover(name: string, force = false): Promise<PortCover> {
  const title = coverQuery(name).slice(0, 160);
  if (!title) return EMPTY;
  const key = cacheKey(title);
  if (force) cacheDelete("ports", key);
  return cached<PortCover>("ports", key, COVER_TTL, () => resolveCover(title));
}

/** Batch variant used when a group of cards scrolls into view. */
export async function getPortCovers(names: string[]): Promise<Record<string, PortCover>> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 24);
  const entries = await Promise.all(
    unique.map(async (name) => [name, await getPortCover(name)] as const),
  );
  return Object.fromEntries(entries);
}
