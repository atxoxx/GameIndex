/**
 * Store catalogue cache.
 *
 * The Rust build split the renderer's `<app_data>/store_cache.json` blob into
 * `store_cache` / `store_detail` tables. This wave keeps the JSON document
 * (the renderer still round-trips the whole blob through
 * `save_store_cache` / `load_store_cache`) and implements the catalogue
 * commands on top of it, so the Store page browses and searches offline from
 * whatever was cached last time.
 *
 * Nothing here fabricates catalogue data: a category with no cached snapshot
 * returns `[]`, and a detail with no cached entry returns `null` — the same
 * empty states the renderer already renders.
 */
import { storeCacheCodec } from "../../state/db/codecs";
import { createSqliteStore } from "../../state/sqliteStore";
import { fetchIgdbGameBySlug, fetchIgdbStoreGames } from "../metadata/igdb";
import type { GameMetadataResult, StoreGameSummary } from "../../../../src/types/game";
import { argNumber, argString, argStringArray } from "./types";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export interface StoreCacheDocument {
  categories: Record<string, CacheEntry<StoreGameSummary[]>>;
  detailCache: Record<string, CacheEntry<GameMetadataResult>>;
}

function emptyCache(): StoreCacheDocument {
  return { categories: {}, detailCache: {} };
}

const cacheStore = createSqliteStore<StoreCacheDocument>({
  domain: "store_cache",
  document: "store-cache",
  createDefault: emptyCache,
  normalize: (value) => {
    const categories: Record<string, CacheEntry<StoreGameSummary[]>> = {};
    const detailCache: Record<string, CacheEntry<GameMetadataResult>> = {};
    if (value.categories && typeof value.categories === "object") {
      for (const [key, entry] of Object.entries(value.categories)) {
        if (!entry || typeof entry !== "object") continue;
        const data = (entry as CacheEntry<StoreGameSummary[]>).data;
        if (!Array.isArray(data)) continue;
        categories[key] = {
          data,
          fetchedAt: Number((entry as CacheEntry<StoreGameSummary[]>).fetchedAt) || 0,
        };
      }
    }
    if (value.detailCache && typeof value.detailCache === "object") {
      for (const [key, entry] of Object.entries(value.detailCache)) {
        if (!entry || typeof entry !== "object") continue;
        const data = (entry as CacheEntry<GameMetadataResult>).data;
        if (!data || typeof data !== "object") continue;
        detailCache[key] = {
          data,
          fetchedAt: Number((entry as CacheEntry<GameMetadataResult>).fetchedAt) || 0,
        };
      }
    }
    return { categories, detailCache };
  },
  codec: storeCacheCodec,
});

/** Raw JSON string the renderer hydrates from (`load_store_cache`). */
export function loadStoreCacheRaw(): string {
  try {
    return JSON.stringify(cacheStore.read());
  } catch (error) {
    console.error("[store-cache] could not serialise cache:", error);
    return JSON.stringify(emptyCache());
  }
}

/** Replace the whole cache from the renderer's blob (`save_store_cache`). */
export function saveStoreCacheRaw(data: string): void {
  if (typeof data !== "string" || data.trim() === "") {
    throw new Error(
      "save_store_cache needs the serialised store cache — the renderer sent an empty payload.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error(
      `save_store_cache could not parse the payload as JSON — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("save_store_cache expected a JSON object with `categories`/`detailCache`.");
  }
  const document = parsed as Partial<StoreCacheDocument>;
  const categories: Record<string, CacheEntry<StoreGameSummary[]>> = {};
  const detailCache: Record<string, CacheEntry<GameMetadataResult>> = {};
  const now = Date.now();

  if (document.categories && typeof document.categories === "object") {
    for (const [key, entry] of Object.entries(document.categories)) {
      if (!entry || typeof entry !== "object") continue;
      const data = (entry as CacheEntry<StoreGameSummary[]>).data;
      if (!Array.isArray(data)) continue;
      // Drop malformed rows instead of poisoning the browse grid.
      categories[key] = {
        data: data.filter(
          (row): row is StoreGameSummary => !!row && typeof row.slug === "string",
        ),
        fetchedAt: Number((entry as CacheEntry<StoreGameSummary[]>).fetchedAt) || now,
      };
    }
  }
  if (document.detailCache && typeof document.detailCache === "object") {
    for (const [key, entry] of Object.entries(document.detailCache)) {
      if (!entry || typeof entry !== "object") continue;
      const data = (entry as CacheEntry<GameMetadataResult>).data;
      if (!data || typeof data !== "object") continue;
      detailCache[key] = {
        data,
        fetchedAt: Number((entry as CacheEntry<GameMetadataResult>).fetchedAt) || now,
      };
    }
  }

  cacheStore.write({ categories, detailCache });
}

function allCachedSummaries(): StoreGameSummary[] {
  const document = cacheStore.read();
  const bySlug = new Map<string, StoreGameSummary>();
  for (const entry of Object.values(document.categories)) {
    for (const game of entry.data) {
      if (game && typeof game.slug === "string" && !bySlug.has(game.slug)) {
        bySlug.set(game.slug, game);
      }
    }
  }
  return [...bySlug.values()];
}

interface Filters {
  genres: string[];
  platforms: number[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  sort: string | null;
}

function parseFilters(args: Record<string, unknown>): Filters {
  const genres = argStringArray(args.genres).map((genre) => genre.toLowerCase());
  const platformsRaw = Array.isArray(args.platforms) ? args.platforms : [];
  const platforms: number[] = [];
  for (const value of platformsRaw) {
    const n = Number(value);
    if (Number.isFinite(n)) platforms.push(n);
  }
  return {
    genres,
    platforms,
    yearMin: argNumber(args, "yearMin", "year_min"),
    yearMax: argNumber(args, "yearMax", "year_max"),
    ratingMin: argNumber(args, "ratingMin", "rating_min"),
    sort: argString(args, "sort") || null,
  };
}

function releaseYear(game: StoreGameSummary): number | null {
  if (!game.firstReleaseDate) return null;
  const date = new Date(game.firstReleaseDate);
  const year = date.getFullYear();
  return Number.isFinite(year) ? year : null;
}

function matchesFilters(game: StoreGameSummary, filters: Filters): boolean {
  if (filters.genres.length > 0) {
    const genres = game.genres.map((genre) => genre.toLowerCase());
    if (!filters.genres.some((genre) => genres.includes(genre))) return false;
  }
  // Platform filters arrive as IGDB numeric ids; cached summaries only carry
  // platform names, so the filter is intentionally a no-op rather than
  // dropping every row.
  if (filters.yearMin !== null || filters.yearMax !== null) {
    const year = releaseYear(game);
    if (year === null) return false;
    if (filters.yearMin !== null && year < filters.yearMin) return false;
    if (filters.yearMax !== null && year > filters.yearMax) return false;
  }
  if (filters.ratingMin !== null) {
    const rating = game.aggregatedRating ?? game.rating ?? 0;
    if (rating < filters.ratingMin) return false;
  }
  return true;
}

function sortGames(games: StoreGameSummary[], sort: string | null): StoreGameSummary[] {
  const copy = [...games];
  switch (sort) {
    case "rating":
      copy.sort(
        (a, b) => (b.aggregatedRating ?? b.rating ?? 0) - (a.aggregatedRating ?? a.rating ?? 0),
      );
      break;
    case "trending":
      copy.sort((a, b) => (b.hypes ?? 0) - (a.hypes ?? 0));
      break;
    case "follows":
      copy.sort((a, b) => (b.follows ?? 0) - (a.follows ?? 0));
      break;
    case "release_new":
      copy.sort((a, b) => (b.firstReleaseDate ?? "").localeCompare(a.firstReleaseDate ?? ""));
      break;
    case "release_old":
      copy.sort((a, b) => (a.firstReleaseDate ?? "9999").localeCompare(b.firstReleaseDate ?? "9999"));
      break;
    case "name":
      copy.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "name_desc":
      copy.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "popularity":
    default:
      copy.sort((a, b) => (b.totalRatingCount ?? 0) - (a.totalRatingCount ?? 0));
      break;
  }
  return copy;
}

function page<T>(rows: T[], offset: number, limit: number): T[] {
  const start = Math.max(0, offset);
  const size = limit > 0 ? limit : 20;
  return rows.slice(start, start + size);
}

/** `fetch_store_games`: cached category page, filtered and paged locally. */
const CATALOGUE_TTL_MS = 10 * 60_000;

/** Cache key for one IGDB catalogue page (every facet in the query). */
function catalogueKey(
  kind: "cat" | "search",
  name: string,
  filters: Filters,
  offset: number,
  limit: number,
): string {
  return [
    kind,
    name,
    filters.genres.join("+"),
    filters.platforms.join("+"),
    filters.yearMin ?? "",
    filters.yearMax ?? "",
    filters.ratingMin ?? "",
    filters.sort ?? "",
    offset,
    limit,
  ].join("|");
}

function storeCacheWrite(key: string, rows: StoreGameSummary[]): void {
  try {
    cacheStore.update((doc) => {
      doc.categories[key] = { data: rows, fetchedAt: Date.now() };
      return doc;
    });
  } catch (error) {
    console.warn("[store] could not persist the catalogue cache:", error);
  }
}

/** IGDB marks `logoUrl` optional; the renderer contract requires null. */
function fromIgdb(rows: Awaited<ReturnType<typeof fetchIgdbStoreGames>>): StoreGameSummary[] {
  return rows.map((row) => ({ ...row, logoUrl: row.logoUrl ?? null }));
}

export async function fetchStoreGames(
  args: Record<string, unknown>,
): Promise<StoreGameSummary[]> {
  const category = argString(args, "category") || "all";
  const offset = argNumber(args, "offset") ?? 0;
  const limit = argNumber(args, "limit") ?? 20;
  const filters = parseFilters(args);
  const key = catalogueKey("cat", category, filters, offset, limit);

  const cached = cacheStore.read().categories[key];
  if (cached && Date.now() - cached.fetchedAt < CATALOGUE_TTL_MS) {
    return cached.data;
  }

  try {
    // IGDB needs the genre *names* as the sidebar sends them; `filters.genres`
    // is lower-cased for local matching only.
    const rows = fromIgdb(await fetchIgdbStoreGames({
      category,
      offset,
      limit,
      genres: argStringArray(args.genres),
      platforms: filters.platforms,
      yearMin: filters.yearMin,
      yearMax: filters.yearMax,
      ratingMin: filters.ratingMin,
      sort: filters.sort,
    }));
    storeCacheWrite(key, rows);
    return rows;
  } catch (error) {
    console.warn(
      "[store] IGDB catalogue fetch failed:",
      error instanceof Error ? error.message : error,
    );
    // Offline/failed: serve the last successful page, else the cached pool.
    if (cached?.data?.length) return cached.data;
    return page(sortGames(allCachedSummaries().filter((g) => matchesFilters(g, filters)), filters.sort), offset, limit);
  }
}

interface ScoredGame {
  game: StoreGameSummary;
  score: number;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

/** Token-coverage score against name, slug, summary, genres and aliases. */
function scoreGame(game: StoreGameSummary, tokens: string[]): number {
  const name = game.name.toLowerCase();
  const haystack = [
    name,
    game.slug,
    game.summary ?? "",
    game.genres.join(" "),
    game.platforms.join(" "),
    (game.themes ?? []).join(" "),
    (game.alternativeNames ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (!tokens.some((token) => haystack.includes(token))) return 0;

  let score = 0;
  for (const token of tokens) {
    if (name === token) score += 3;
    else if (name.startsWith(token)) score += 2;
    else if (name.includes(token)) score += 1.5;
    else if (game.slug.includes(token)) score += 1;
    else if (haystack.includes(token)) score += 0.4;
  }
  // Normalise by token count so a many-word query is not automatically
  // preferred over a tight match.
  return score / tokens.length;
}

/** `search_store_games`: local search over every cached category page. */
export async function searchStoreGames(
  args: Record<string, unknown>,
): Promise<StoreGameSummary[]> {
  const query = argString(args, "query").trim();
  if (!query) return [];
  const offset = argNumber(args, "offset") ?? 0;
  const limit = argNumber(args, "limit") ?? 20;
  const filters = parseFilters(args);
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const key = catalogueKey("search", query.toLowerCase(), filters, offset, limit);
  const cached = cacheStore.read().categories[key];
  if (cached && Date.now() - cached.fetchedAt < CATALOGUE_TTL_MS) {
    return cached.data;
  }

  try {
    const rows = fromIgdb(await fetchIgdbStoreGames({
      query,
      offset,
      limit: limit + 10,
      genres: argStringArray(args.genres),
      platforms: filters.platforms,
      yearMin: filters.yearMin,
      yearMax: filters.yearMax,
      ratingMin: filters.ratingMin,
      sort: filters.sort,
    }));
    // IGDB's `search` clause ignores facets, so apply them locally.
    const pageRows = page(
      rows.filter((game) => matchesFilters(game, filters)),
      offset,
      limit,
    );
    storeCacheWrite(key, pageRows);
    return pageRows;
  } catch (error) {
    console.warn(
      "[store] IGDB search failed, using the cached catalogue:",
      error instanceof Error ? error.message : error,
    );
  }

  // Offline fallback: score everything already cached.
  const scored: ScoredGame[] = [];
  for (const game of allCachedSummaries()) {
    if (!matchesFilters(game, filters)) continue;
    const score = scoreGame(game, tokens);
    if (score < 0.3) continue;
    scored.push({ game, score });
  }

  scored.sort(
    (a, b) => b.score - a.score || (b.game.totalRatingCount ?? 0) - (a.game.totalRatingCount ?? 0),
  );
  return page(
    scored.map((entry) => entry.game),
    offset,
    limit,
  );
}

/** `get_store_game_detail`: cached detail payload, or `null`. */
export async function getStoreGameDetail(
  slug: string,
): Promise<GameMetadataResult | null> {
  if (!slug) return null;
  const cached = cacheStore.read().detailCache[slug];
  if (cached && Date.now() - cached.fetchedAt < CATALOGUE_TTL_MS) {
    return cached.data;
  }
  try {
    const fetched = await fetchIgdbGameBySlug(slug);
    if (!fetched) return cached?.data ?? null;
    const data = fetched as unknown as GameMetadataResult;
    cacheStore.update((doc) => {
      doc.detailCache[slug] = { data, fetchedAt: Date.now() };
      return doc;
    });
    return data;
  } catch (error) {
    console.warn(
      "[store] IGDB detail fetch failed:",
      error instanceof Error ? error.message : error,
    );
    return cached?.data ?? null;
  }
}

/** `get_random_store_games`: random cached summaries (never invented rows). */
export function getRandomStoreGames(limit: number): StoreGameSummary[] {
  const all = allCachedSummaries();
  const size = Math.min(Math.max(1, Math.trunc(limit) || 10), all.length);
  if (size <= 0) return [];
  const pool = [...all];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, size);
}

/** Cache stats, used by the scan report and diagnostics. */
export function storeCacheStats(): {
  categories: number;
  games: number;
  details: number;
  newestFetch: number;
} {
  const document = cacheStore.read();
  let games = 0;
  let newestFetch = 0;
  for (const entry of Object.values(document.categories)) {
    games += entry.data.length;
    newestFetch = Math.max(newestFetch, entry.fetchedAt);
  }
  return {
    categories: Object.keys(document.categories).length,
    games,
    details: Object.keys(document.detailCache).length,
    newestFetch,
  };
}
