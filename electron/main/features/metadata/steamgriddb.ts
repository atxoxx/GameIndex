/**
 * SteamGridDB v2 artwork.
 *
 * Ported from `src-tauri/src/steamgriddb.rs`. Requires
 * `STEAMGRIDDB_API_KEY`; without it the commands return an empty result (the
 * library keeps whatever art it already has) rather than throwing — artwork
 * is an enhancement, not a requirement.
 *
 * Every HTTP call is paced (300 ms) because the free tier is small, and
 * per-target results (including "this game has no art") are cached for 7
 * days on disk.
 */
import { getSecret } from "../../lib/secrets";
import { httpText } from "../../lib/http";
import { cacheGet, cacheSet, TTL } from "./cache";
import { normalizeTitle } from "./text";

const API = "https://www.steamgriddb.com/api/v2";
const MIN_GAP_MS = 300;
const PAGE_SIZE = 50;
const MAX_ALL_PAGES = 6;

export interface SgdbAssets {
  gridUrl: string | null;
  gridMime: string | null;
  gridThumbUrl?: string | null;
  gridAnimatedUrl: string | null;
  gridAnimatedMime: string | null;
  heroUrl: string | null;
  heroMime: string | null;
  heroAnimatedUrl: string | null;
  heroAnimatedMime: string | null;
  iconUrl: string | null;
  iconMime: string | null;
  logoUrl: string | null;
  logoMime: string | null;
}

export interface SgdbArtworkItem {
  url: string;
  thumbUrl?: string | null;
  mime: string;
  width: number;
  height: number;
  score: number;
  animated?: boolean;
}

export interface SgdbAllAssets {
  grids: SgdbArtworkItem[];
  heroes: SgdbArtworkItem[];
  icons: SgdbArtworkItem[];
  logos: SgdbArtworkItem[];
}

export interface SgdbGameSuggestion {
  id: number;
  name: string;
  releaseDate?: number | null;
  verified: boolean;
}

interface RawArtwork {
  url?: string;
  thumb?: string;
  mime?: string;
  width?: number;
  height?: number;
  score?: number;
  downloads?: number;
}

interface SearchItem {
  id: number;
  name: string;
  release_date?: number | null;
  verified?: boolean;
}

type Kind = "grids" | "heroes" | "icons" | "logos";
type Target = { kind: "steam"; id: number } | { kind: "game"; id: number };

export function sgdbKey(): string | null {
  const key = getSecret("STEAMGRIDDB_API_KEY");
  return key && key.trim() ? key.trim() : null;
}

function requireSgdbKey(): string {
  const key = sgdbKey();
  if (!key) {
    throw new Error(
      "SteamGridDB is not configured — add STEAMGRIDDB_API_KEY to .env and rebuild.",
    );
  }
  return key;
}

let lastRequest = 0;

async function throttle(): Promise<void> {
  const wait = Math.max(0, lastRequest + MIN_GAP_MS - Date.now());
  lastRequest = Date.now() + wait;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function apiGet<T>(path: string, key: string): Promise<T | null> {
  await throttle();
  try {
    const response = await httpText(`${API}/${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      timeoutMs: 15_000,
      retries: 1,
    });
    if (!response.ok) return null;
    return JSON.parse(response.text) as T;
  } catch {
    return null;
  }
}

function targetPath(target: Target, kind: Kind): string {
  return `${kind}/${target.kind}/${target.id}`;
}

function cacheKey(prefix: string, target: Target): string {
  return `${prefix}:${target.kind}:${target.id}`;
}

function isRenderableMime(mime: string | undefined): boolean {
  if (!mime) return true;
  return (
    mime.startsWith("image/png") ||
    mime.startsWith("image/apng") ||
    mime.startsWith("image/jpeg") ||
    mime.startsWith("image/webp") ||
    mime.startsWith("image/gif") ||
    mime.startsWith("image/avif") ||
    mime.startsWith("image/svg+xml") ||
    mime.startsWith("image/x-icon") ||
    mime.startsWith("image/vnd.microsoft.icon") ||
    mime.startsWith("image/ico")
  );
}

function isRenderableArt(art: RawArtwork): boolean {
  if (isRenderableMime(art.mime)) return true;
  const url = (art.url ?? "").split("?")[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|ico)$/.test(url);
}

function pickBest(items: RawArtwork[]): RawArtwork | null {
  const sorted = [...items].sort((a, b) => {
    const renderable = Number(isRenderableArt(b)) - Number(isRenderableArt(a));
    if (renderable !== 0) return renderable;
    const score = (b.score ?? 0) - (a.score ?? 0);
    if (score !== 0) return score;
    return (b.downloads ?? 0) - (a.downloads ?? 0);
  });
  return sorted[0] ?? null;
}

interface SgdbApiResponse {
  success?: boolean;
  data?: RawArtwork[];
}

interface SearchResponse {
  success?: boolean;
  data?: SearchItem[];
}

async function fetchKind(
  key: string,
  target: Target,
  kind: Kind,
  types: "animated" | "static",
): Promise<RawArtwork | null> {
  const response = await apiGet<SgdbApiResponse>(
    `${targetPath(target, kind)}?types=${types}&nsfw=false&humor=false&epilepsy=false`,
    key,
  );
  if (!response?.success || !response.data?.length) return null;
  return pickBest(response.data);
}

async function fetchAllPages(
  key: string,
  target: Target,
  kind: Kind,
  types: "animated" | "static",
): Promise<RawArtwork[]> {
  const all: RawArtwork[] = [];
  for (let page = 0; page < MAX_ALL_PAGES; page += 1) {
    const response = await apiGet<SgdbApiResponse>(
      `${targetPath(target, kind)}?types=${types}&nsfw=false&humor=false&epilepsy=false&page=${page}`,
      key,
    );
    if (!response?.success || !response.data) break;
    all.push(...response.data);
    if (response.data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Title matching must not let a bare word answer a longer query: "Stalker"
 * would otherwise satisfy "S.T.A.L.K.E.R.: GAMMA". Every query word has to be
 * present in the candidate, and the candidate with the fewest extra words
 * wins.
 */
function bestMatch(items: SearchItem[], query: string): SearchItem | null {
  const normalized = normalizeTitle(query);
  if (!normalized) return null;
  const exact = items.find((item) => normalizeTitle(item.name) === normalized);
  if (exact) return exact;
  const queryTokens = normalized.split(" ").filter(Boolean);
  let best: { extra: number; item: SearchItem } | null = null;
  for (const item of items) {
    const tokens = normalizeTitle(item.name).split(" ").filter(Boolean);
    const coversAll = queryTokens.every((token) => tokens.includes(token));
    if (!coversAll) continue;
    const extra = Math.max(0, tokens.length - queryTokens.length);
    if (!best || extra < best.extra) best = { extra, item };
  }
  return best?.item ?? items[0] ?? null;
}

async function searchGameId(key: string, gameName: string): Promise<number | null> {
  const term = gameName.trim();
  if (!term) return null;
  const cacheKeyName = `search:${normalizeTitle(term)}`;
  const cachedId = cacheGet<number | null>("sgdb", cacheKeyName, TTL.sgdb);
  if (cachedId !== undefined) return cachedId;

  let hits = await autocomplete(key, term);
  if (hits.length === 0) {
    const normalized = normalizeTitle(term);
    if (normalized && normalized !== term.toLowerCase()) hits = await autocomplete(key, normalized);
  }
  const id = bestMatch(hits, term)?.id ?? null;
  cacheSet("sgdb", cacheKeyName, id);
  return id;
}

async function autocomplete(key: string, term: string): Promise<SearchItem[]> {
  const response = await apiGet<SearchResponse>(
    `search/autocomplete/${encodeURIComponent(term)}`,
    key,
  );
  return response?.success && Array.isArray(response.data) ? response.data : [];
}

function hasArt(assets: SgdbAssets): boolean {
  return Boolean(
    assets.gridUrl ||
      assets.gridAnimatedUrl ||
      assets.heroUrl ||
      assets.heroAnimatedUrl ||
      assets.iconUrl ||
      assets.logoUrl,
  );
}

function hasAnyAllAssets(assets: SgdbAllAssets): boolean {
  return Boolean(
    assets.grids.length || assets.heroes.length || assets.icons.length || assets.logos.length,
  );
}

async function fetchAssets(key: string, target: Target): Promise<SgdbAssets> {
  const [gridAnimated, gridStatic, heroAnimated, heroStatic, icon, logo] = await Promise.all([
    fetchKind(key, target, "grids", "animated"),
    fetchKind(key, target, "grids", "static"),
    fetchKind(key, target, "heroes", "animated"),
    fetchKind(key, target, "heroes", "static"),
    fetchKind(key, target, "icons", "static"),
    fetchKind(key, target, "logos", "static"),
  ]);
  return {
    gridUrl: gridStatic?.url ?? null,
    gridMime: gridStatic?.mime ?? null,
    gridThumbUrl: gridStatic?.thumb ?? null,
    gridAnimatedUrl: gridAnimated?.url ?? null,
    gridAnimatedMime: gridAnimated?.mime ?? null,
    heroUrl: heroStatic?.url ?? null,
    heroMime: heroStatic?.mime ?? null,
    heroAnimatedUrl: heroAnimated?.url ?? null,
    heroAnimatedMime: heroAnimated?.mime ?? null,
    iconUrl: icon?.url ?? null,
    iconMime: icon?.mime ?? null,
    logoUrl: logo?.url ?? null,
    logoMime: logo?.mime ?? null,
  };
}

function toArtworkItems(items: RawArtwork[], animated: boolean): SgdbArtworkItem[] {
  const out: SgdbArtworkItem[] = [];
  for (const item of items) {
    if (!item.url || !isRenderableArt(item)) continue;
    const isAnimated =
      animated ||
      Boolean(item.mime?.includes("apng") || item.mime?.includes("gif")) ||
      item.url.endsWith(".apng") ||
      item.url.endsWith(".gif");
    out.push({
      url: item.url,
      thumbUrl: item.thumb ?? null,
      mime: item.mime ?? "",
      width: item.width ?? 0,
      height: item.height ?? 0,
      score: item.score ?? 0,
      animated: isAnimated,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function allAssets(key: string, target: Target): Promise<SgdbAllAssets> {
  const [gridStatic, gridAnimated, heroStatic, heroAnimated, icons, logos] = await Promise.all([
    fetchAllPages(key, target, "grids", "static"),
    fetchAllPages(key, target, "grids", "animated"),
    fetchAllPages(key, target, "heroes", "static"),
    fetchAllPages(key, target, "heroes", "animated"),
    fetchAllPages(key, target, "icons", "static"),
    fetchAllPages(key, target, "logos", "static"),
  ]);
  return {
    grids: toArtworkItems([...gridStatic, ...gridAnimated], false),
    heroes: toArtworkItems([...heroStatic, ...heroAnimated], false),
    icons: toArtworkItems(icons, false),
    logos: toArtworkItems(logos, false),
  };
}

/** Best grid/hero/icon/logo for a game, by appid then by name. */
export async function sgdbGetAssets(
  steamAppId: number | null | undefined,
  gameName: string | null | undefined,
): Promise<SgdbAssets | null> {
  const key = requireSgdbKey();
  if (!key) return null;

  if (steamAppId && steamAppId > 0) {
    const target: Target = { kind: "steam", id: steamAppId };
    const cacheName = cacheKey("assets", target);
    const hit = cacheGet<SgdbAssets | null>("sgdb", cacheName, TTL.sgdb);
    if (hit !== undefined) {
      if (hit && hasArt(hit)) return hit;
    } else {
      const assets = await fetchAssets(key, target);
      cacheSet("sgdb", cacheName, assets);
      if (hasArt(assets)) return assets;
    }
  }

  const name = gameName?.trim();
  if (!name) return null;
  const gameId = await searchGameId(key, name);
  if (!gameId) return null;
  const target: Target = { kind: "game", id: gameId };
  const cacheName = cacheKey("assets", target);
  const hit = cacheGet<SgdbAssets | null>("sgdb", cacheName, TTL.sgdb);
  if (hit !== undefined) return hit && hasArt(hit) ? hit : null;
  const assets = await fetchAssets(key, target);
  cacheSet("sgdb", cacheName, assets);
  return hasArt(assets) ? assets : null;
}

/** Batch variant used by grids: cached entries returned, cold ones fetched 6 at a time. */
export async function sgdbGetAssetsBatch(
  steamAppIds: number[],
): Promise<Record<string, SgdbAssets>> {
  const key = requireSgdbKey();
  const resolved: Record<string, SgdbAssets> = {};
  const seen = new Set<number>();
  const cold: number[] = [];

  for (const appId of steamAppIds) {
    if (!Number.isFinite(appId) || appId <= 0 || seen.has(appId)) continue;
    seen.add(appId);
    const target: Target = { kind: "steam", id: appId };
    const cacheName = cacheKey("assets", target);
    const hit = cacheGet<SgdbAssets | null>("sgdb", cacheName, TTL.sgdb);
    if (hit === undefined) cold.push(appId);
    else if (hit && hasArt(hit)) resolved[String(appId)] = hit;
  }

  if (!key || cold.length === 0) return resolved;

  let index = 0;
  const workers = Array.from({ length: Math.min(6, cold.length) }, async () => {
    while (index < cold.length) {
      const appId = cold[index];
      index += 1;
      const target: Target = { kind: "steam", id: appId };
      const assets = await fetchAssets(key, target);
      cacheSet("sgdb", cacheKey("assets", target), assets);
      if (hasArt(assets)) resolved[String(appId)] = assets;
    }
  });
  await Promise.all(workers);
  return resolved;
}

/** Every upload for the edit modal's media picker. */
export async function sgdbGetAllAssets(
  steamAppId: number | null | undefined,
  gameName: string | null | undefined,
  sgdbGameId: number | null | undefined,
): Promise<SgdbAllAssets | null> {
  const key = requireSgdbKey();

  if (sgdbGameId && sgdbGameId > 0) {
    const target: Target = { kind: "game", id: sgdbGameId };
    const cacheName = cacheKey("all", target);
    const hit = cacheGet<SgdbAllAssets | null>("sgdb", cacheName, TTL.sgdb);
    if (hit !== undefined) return hit && hasAnyAllAssets(hit) ? hit : null;
    if (!key) return null;
    const assets = await allAssets(key, target);
    cacheSet("sgdb", cacheName, assets);
    return hasAnyAllAssets(assets) ? assets : null;
  }

  if (steamAppId && steamAppId > 0) {
    const target: Target = { kind: "steam", id: steamAppId };
    const cacheName = cacheKey("all", target);
    const hit = cacheGet<SgdbAllAssets | null>("sgdb", cacheName, TTL.sgdb);
    if (hit !== undefined) {
      if (hit && hasAnyAllAssets(hit)) return hit;
    } else if (key) {
      const assets = await allAssets(key, target);
      cacheSet("sgdb", cacheName, assets);
      if (hasAnyAllAssets(assets)) return assets;
    }
  }

  const name = gameName?.trim();
  if (!name || !key) return null;
  const gameId = await searchGameId(key, name);
  if (!gameId) return null;
  const target: Target = { kind: "game", id: gameId };
  const cacheName = cacheKey("all", target);
  const hit = cacheGet<SgdbAllAssets | null>("sgdb", cacheName, TTL.sgdb);
  if (hit !== undefined) return hit && hasAnyAllAssets(hit) ? hit : null;
  const assets = await allAssets(key, target);
  cacheSet("sgdb", cacheName, assets);
  return hasAnyAllAssets(assets) ? assets : null;
}

/** Autocomplete used by the media picker's suggestion dropdown. */
export async function sgdbSearchGames(query: string): Promise<SgdbGameSuggestion[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const key = requireSgdbKey();
  return cachedSearch(key, term);
}

async function cachedSearch(key: string, term: string): Promise<SgdbGameSuggestion[]> {
  const cacheName = `suggest:${term.toLowerCase()}`;
  const hit = cacheGet<SgdbGameSuggestion[]>("sgdb", cacheName, TTL.sgdb);
  if (hit !== undefined) return hit;
  const items = (await autocomplete(key, term)).slice(0, 8).map((item) => ({
    id: item.id,
    name: item.name,
    releaseDate: item.release_date && item.release_date > 0 ? item.release_date : null,
    verified: Boolean(item.verified),
  }));
  cacheSet("sgdb", cacheName, items);
  return items;
}
