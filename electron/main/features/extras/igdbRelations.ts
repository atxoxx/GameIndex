/**
 * IGDB-backed collection members and relation graphs for the store page,
 * plus a local-library fallback for offline builds.
 *
 * Ported from `src-tauri/src/game_scraper/relations.rs` for the IGDB path.
 * The fallback exists because IGDB needs Twitch credentials; the Store page's
 * Game Relations card should still show the user's own series/collection
 * neighbours when those are absent.
 *
 * Cache: 6 hours for both collections and relation graphs.
 */
import { getSecret } from "../../lib/secrets";
import { httpText } from "../../lib/http";
import { listGames } from "../../state/libraryStore";
import type { Game } from "../../../../src/types/game";
import { cacheLookup, cacheStore, EXTRA_TTL } from "./cache";

const API = "https://api.igdb.com/v4";

export interface StoreGameSummary {
  id: number;
  name: string;
  slug: string;
  summary: string | null;
  rating: number | null;
  aggregatedRating: number | null;
  coverUrl: string | null;
  logoUrl?: string | null;
  genres: string[];
  platforms: string[];
  firstReleaseDate: string | null;
  totalRatingCount: number;
  hypes: number;
  follows?: number;
  websites?: string[];
}

export interface RelatedGameEntry {
  id: number;
  name: string;
  coverUrl?: string | null;
  releaseYear?: number | null;
  rating?: number | null;
}

export interface RelationGameGroup {
  id: number;
  name: string;
  games: RelatedGameEntry[];
}

export interface GameRelationsResult {
  franchiseGroups: RelationGameGroup[];
  collectionGroups: RelationGameGroup[];
  similarGames: RelatedGameEntry[];
  developerGames: RelatedGameEntry[];
  publisherGames: RelatedGameEntry[];
}

// ── IGDB transport ─────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}

async function igdbToken(): Promise<{ token: string; clientId: string } | null> {
  const clientId = getSecret("TWITCH_CLIENT_ID") ?? getSecret("IGDB_CLIENT_ID");
  const clientSecret = getSecret("TWITCH_CLIENT_SECRET") ?? getSecret("IGDB_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const hit = cacheLookup<CachedToken>("igdb-token");
  if (hit && hit.value.expiresAt > Date.now()) {
    return { token: hit.value.token, clientId };
  }

  const url =
    "https://id.twitch.tv/oauth2/token" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    "&grant_type=client_credentials";
  const response = await httpText(url, {
    method: "POST",
    headers: { "content-length": "0" },
    timeoutMs: 15_000,
    retries: 1,
  });
  if (!response.ok) {
    throw new Error(
      `IGDB authentication failed (HTTP ${response.status}) — check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.`,
    );
  }
  const body = JSON.parse(response.text) as { access_token?: string; expires_in?: number };
  if (!body.access_token || !body.expires_in) {
    throw new Error("IGDB authentication returned no access token.");
  }
  const token: CachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, body.expires_in - 60) * 1000,
  };
  cacheStore("igdb-token", token);
  return { token: token.token, clientId };
}

let gateTail: Promise<void> = Promise.resolve();
let lastStart = 0;

async function igdbPost(body: string): Promise<unknown[]> {
  const credentials = await igdbToken();
  if (!credentials) throw new Error("IGDB is not configured — add Twitch credentials to .env.");

  const previous = gateTail;
  let release!: () => void;
  gateTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  const wait = Math.max(0, lastStart + 250 - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastStart = Date.now();
  release();

  const response = await httpText(`${API}/games`, {
    method: "POST",
    headers: {
      "Client-ID": credentials.clientId,
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "text/plain",
    },
    body,
    timeoutMs: 20_000,
    retries: 1,
  });
  if (!response.ok) {
    throw new Error(
      `IGDB request failed (HTTP ${response.status}) — ${response.text.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(response.text) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

// ── Mapping ────────────────────────────────────────────────────────────

interface RawIgdbName {
  name?: string;
}

interface RawIgdbGame {
  id?: number;
  name?: string;
  slug?: string;
  summary?: string | null;
  first_release_date?: number;
  rating?: number;
  aggregated_rating?: number;
  cover?: { url?: string } | null;
  artworks?: { url?: string }[] | null;
  genres?: RawIgdbName[] | null;
  platforms?: RawIgdbName[] | null;
  total_rating_count?: number;
  hypes?: number;
  follows?: number;
  websites?: { url?: string }[] | null;
}

function normalizeIgdbImage(url: string | undefined, size: "cover" | "logo"): string | null {
  if (!url) return null;
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  if (size === "cover") return absolute.replace("t_thumb", "t_cover_big");
  return absolute;
}

function formatReleaseDate(seconds: number | undefined): string | null {
  if (!Number.isFinite(seconds) || (seconds as number) < 0) return null;
  const date = new Date((seconds as number) * 1000);
  const iso = date.toISOString();
  return (seconds as number) % 86_400 === 0 ? iso.slice(0, 10) : iso;
}

function mapSummary(raw: RawIgdbGame): StoreGameSummary {
  const websites: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw.websites ?? []) {
    const url = entry.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    websites.push(url);
  }
  const artworkLogo = (raw.artworks ?? [])
    .map((entry) => entry.url)
    .find((url) => url?.includes("/t_logo"));
  return {
    id: raw.id ?? 0,
    name: raw.name ?? "",
    slug: raw.slug ?? "",
    summary: raw.summary ?? null,
    rating: raw.rating ?? null,
    aggregatedRating: raw.aggregated_rating ?? null,
    coverUrl: normalizeIgdbImage(raw.cover?.url, "cover"),
    logoUrl: normalizeIgdbImage(artworkLogo, "logo"),
    genres: (raw.genres ?? []).map((entry) => entry.name ?? "").filter(Boolean),
    platforms: (raw.platforms ?? []).map((entry) => entry.name ?? "").filter(Boolean),
    firstReleaseDate: formatReleaseDate(raw.first_release_date),
    totalRatingCount: raw.total_rating_count ?? 0,
    hypes: raw.hypes ?? 0,
    follows: raw.follows ?? 0,
    websites: websites.length ? websites : undefined,
  };
}

interface RawRelationGame {
  id?: number;
  name?: string;
  cover?: { url?: string } | null;
  first_release_date?: number;
  rating?: number;
  involved_companies?: RawRelationCompany[] | null;
}

interface RawRelationCompany {
  company?: { id?: number };
  developer?: boolean;
  publisher?: boolean;
}

function relationEntry(raw: RawRelationGame): RelatedGameEntry {
  const year = raw.first_release_date
    ? Number.parseInt(formatReleaseDate(raw.first_release_date)?.slice(0, 4) ?? "", 10)
    : NaN;
  return {
    id: raw.id ?? 0,
    name: raw.name ?? "",
    coverUrl: normalizeIgdbImage(raw.cover?.url, "cover"),
    releaseYear: Number.isFinite(year) ? year : null,
    rating: raw.rating ?? null,
  };
}

// ── Local-library fallback ─────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toLocalEntry(game: Game): RelatedGameEntry {
  return {
    id: game.igdbId ?? 0,
    name: game.name,
    coverUrl: game.coverSourceUrl && /^https?:/i.test(game.coverSourceUrl) ? game.coverSourceUrl : null,
    releaseYear: game.releaseDate ? Number.parseInt(game.releaseDate.slice(0, 4), 10) || null : null,
    rating: typeof game.igdbRating === "number" ? game.igdbRating : null,
  };
}

function toLocalSummary(game: Game): StoreGameSummary {
  return {
    id: game.igdbId ?? 0,
    name: game.name,
    slug: slugify(game.name),
    summary: game.description ?? null,
    rating: typeof game.igdbRating === "number" ? game.igdbRating : null,
    aggregatedRating: typeof game.criticRating === "number" ? game.criticRating : null,
    coverUrl: game.coverSourceUrl && /^https?:/i.test(game.coverSourceUrl) ? game.coverSourceUrl : null,
    logoUrl: game.logoSourceUrl && /^https?:/i.test(game.logoSourceUrl) ? game.logoSourceUrl : null,
    genres: game.genres ?? [],
    platforms: game.platform ? [game.platform] : [],
    firstReleaseDate: game.releaseDate ?? null,
    totalRatingCount: 0,
    hypes: 0,
    websites: game.websites,
  };
}

function localRelations(igdbId: number): GameRelationsResult {
  const empty: GameRelationsResult = {
    franchiseGroups: [],
    collectionGroups: [],
    similarGames: [],
    developerGames: [],
    publisherGames: [],
  };
  const games = listGames();
  const seed = games.find((game) => game.igdbId === igdbId);
  if (!seed) return empty;
  const others = games.filter((game) => game.id !== seed.id);

  const franchise = seed.franchise
    ? others.filter((game) => game.franchise === seed.franchise)
    : [];
  const collection = seed.collection
    ? others.filter((game) => game.collection === seed.collection)
    : [];
  const developer = seed.developer
    ? others.filter((game) =>
        (game.developer ?? "")
          .split(/[;,]/)
          .map((value) => value.trim().toLowerCase())
          .includes(seed.developer!.trim().toLowerCase()),
      )
    : [];
  const publisher = seed.publisher
    ? others.filter((game) =>
        (game.publisher ?? "")
          .split(/[;,]/)
          .map((value) => value.trim().toLowerCase())
          .includes(seed.publisher!.trim().toLowerCase()),
      )
    : [];
  const seedGenres = new Set((seed.genres ?? []).map((genre) => genre.toLowerCase()));
  const similar = others
    .map((game) => ({
      game,
      overlap: (game.genres ?? []).filter((genre) => seedGenres.has(genre.toLowerCase())).length,
    }))
    .filter((entry) => entry.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 12)
    .map((entry) => toLocalEntry(entry.game));

  return {
    franchiseGroups: seed.franchise
      ? [{ id: 0, name: seed.franchise, games: franchise.slice(0, 24).map(toLocalEntry) }]
      : [],
    collectionGroups: seed.collection
      ? [{ id: 0, name: seed.collection, games: collection.slice(0, 24).map(toLocalEntry) }]
      : [],
    similarGames: similar,
    developerGames: developer.slice(0, 12).map(toLocalEntry),
    publisherGames: publisher.slice(0, 12).map(toLocalEntry),
  };
}

// ── Public commands ────────────────────────────────────────────────────

function positiveInt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/** `get_collection_games` — IGDB members, or local matches when offline. */
export async function getCollectionGames(
  rawCollectionId: unknown,
  rawLimit: unknown,
): Promise<StoreGameSummary[]> {
  const collectionId = positiveInt(rawCollectionId);
  if (!collectionId) return [];
  const limit = Math.min(50, Math.max(1, Math.floor(Number(rawLimit) || 50)));
  const key = `igdb-collection:${collectionId}:${limit}`;
  const hit = cacheLookup<StoreGameSummary[]>(key);
  if (hit && Date.now() - hit.at < EXTRA_TTL.igdbCollection) return hit.value;

  try {
    const raw = await igdbPost(
      "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url," +
        "artworks.url,genres.name,platforms.name,total_rating_count,hypes,follows,websites.url;" +
        `where collections = (${collectionId}); sort first_release_date asc; limit ${limit}; offset 0;`,
    );
    const games = (raw as RawIgdbGame[]).map(mapSummary);
    cacheStore(key, games);
    return games;
  } catch {
    const local = listGames()
      .filter((game) => game.collectionId === collectionId)
      .slice(0, limit)
      .map(toLocalSummary);
    if (local.length > 0) cacheStore(key, local);
    return local.length > 0 ? local : (hit?.value ?? []);
  }
}

interface RawRelationSeed {
  id?: number;
  franchises?: { id?: number; name?: string }[];
  collections?: { id?: number; name?: string }[];
  involved_companies?: RawRelationCompany[];
  similar_games?: RawRelationGame[];
}

function companyIds(companies: RawRelationCompany[] | undefined): {
  developers: number[];
  publishers: number[];
} {
  const developers = new Set<number>();
  const publishers = new Set<number>();
  for (const company of companies ?? []) {
    const id = company.company?.id;
    if (!id) continue;
    if (company.developer) developers.add(id);
    if (company.publisher) publishers.add(id);
  }
  return { developers: [...developers], publishers: [...publishers] };
}

async function fetchRelationGroup(
  field: "franchises" | "collections",
  id: number,
  name: string,
  seedId: number,
): Promise<RelationGameGroup> {
  const raw = (await igdbPost(
    "fields name,cover.url,first_release_date,rating;" +
      `where ${field} = (${id}); sort first_release_date asc; limit 24;`,
  )) as RawRelationGame[];
  return {
    id,
    name,
    games: raw.filter((game) => game.id !== seedId).map(relationEntry),
  };
}

async function igdbRelations(igdbId: number): Promise<GameRelationsResult> {
  const seedRaw = (await igdbPost(
    "fields name,franchises.id,franchises.name,collections.id,collections.name," +
      "involved_companies.company.id,involved_companies.developer,involved_companies.publisher," +
      "similar_games.id,similar_games.name,similar_games.cover.url," +
      `similar_games.first_release_date,similar_games.rating; where id = ${igdbId}; limit 1;`,
  )) as RawRelationSeed[];
  const seed = seedRaw[0];
  if (!seed) throw new Error(`IGDB returned no game for id ${igdbId}.`);

  const result: GameRelationsResult = {
    franchiseGroups: [],
    collectionGroups: [],
    similarGames: (seed.similar_games ?? [])
      .filter((game) => game.id !== seed.id)
      .slice(0, 12)
      .map(relationEntry),
    developerGames: [],
    publisherGames: [],
  };

  for (const collection of (seed.collections ?? []).slice(0, 6)) {
    if (!collection.id) continue;
    try {
      result.collectionGroups.push(
        await fetchRelationGroup("collections", collection.id, collection.name ?? "", seed.id ?? 0),
      );
    } catch {
      /* one failed group must not blank the card */
    }
  }
  for (const franchise of (seed.franchises ?? []).slice(0, 6)) {
    if (!franchise.id) continue;
    try {
      result.franchiseGroups.push(
        await fetchRelationGroup("franchises", franchise.id, franchise.name ?? "", seed.id ?? 0),
      );
    } catch {
      /* one failed group must not blank the card */
    }
  }

  const { developers, publishers } = companyIds(seed.involved_companies);
  const companyIdsAll = [...new Set([...developers, ...publishers])];
  if (companyIdsAll.length > 0) {
    const raw = (await igdbPost(
      "fields name,cover.url,first_release_date,rating,involved_companies.company.id," +
        "involved_companies.developer,involved_companies.publisher;" +
        `where involved_companies.company = (${companyIdsAll.join(",")}) & rating != null;` +
        "sort rating desc; limit 24;",
    )) as RawRelationGame[];
    const developerSet = new Set(developers);
    const publisherSet = new Set(publishers);
    for (const game of raw.filter((entry) => entry.id !== seed.id)) {
      const involved = game.involved_companies ?? [];
      const isDeveloper = involved.some(
        (company) => company.developer && company.company?.id !== undefined && developerSet.has(company.company.id),
      );
      const isPublisher = involved.some(
        (company) => company.publisher && company.company?.id !== undefined && publisherSet.has(company.company.id),
      );
      if (isDeveloper && result.developerGames.length < 12) result.developerGames.push(relationEntry(game));
      if (isPublisher && result.publisherGames.length < 12) result.publisherGames.push(relationEntry(game));
    }
  }

  return result;
}

/** `get_game_relations` — IGDB graph, with a library-derived fallback. */
export async function getGameRelations(rawIgdbId: unknown): Promise<GameRelationsResult> {
  const igdbId = positiveInt(rawIgdbId);
  if (!igdbId) {
    return {
      franchiseGroups: [],
      collectionGroups: [],
      similarGames: [],
      developerGames: [],
      publisherGames: [],
    };
  }
  const key = `igdb-relations:${igdbId}`;
  const hit = cacheLookup<GameRelationsResult>(key);
  if (hit && Date.now() - hit.at < EXTRA_TTL.igdbRelations) return hit.value;

  try {
    const result = await igdbRelations(igdbId);
    const hasContent =
      result.franchiseGroups.length > 0 ||
      result.collectionGroups.length > 0 ||
      result.similarGames.length > 0 ||
      result.developerGames.length > 0 ||
      result.publisherGames.length > 0;
    if (hasContent) cacheStore(key, result);
    return hasContent ? result : localRelations(igdbId);
  } catch {
    const local = localRelations(igdbId);
    const hasContent =
      local.franchiseGroups.length > 0 ||
      local.collectionGroups.length > 0 ||
      local.similarGames.length > 0 ||
      local.developerGames.length > 0 ||
      local.publisherGames.length > 0;
    if (hasContent) cacheStore(key, local);
    return hasContent ? local : (hit?.value ?? local);
  }
}
