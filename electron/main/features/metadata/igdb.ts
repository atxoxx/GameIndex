/**
 * IGDB (Twitch API) access.
 *
 * Ported from `src-tauri/src/game_scraper/igdb.rs` and
 * `store_search.rs`. The OAuth token is client-credentials and lives for
 * ~60 days; it is cached on disk so a relaunch does not spend another token
 * request. Every POST is serialized through a 250 ms gate and capped at a
 * small in-flight window, mirroring IGDB's free-tier 4 req/s limit.
 */
import { getSecret } from "../../lib/secrets";
import { httpJson, httpText } from "../../lib/http";
import { cached, cacheGet, cacheSet, TTL } from "./cache";
import {
  cleanGameName,
  extractYear,
  formatUnixTimestamp,
  MIN_TITLE_SIMILARITY,
  normalizeTitle,
  stripYearMarker,
  titleSimilarity,
} from "./text";

export interface MetadataImages {
  icon: string | null;
  cover: string | null;
  hero: string | null;
  banner: string | null;
  logo: string | null;
}

export interface TimeToBeatShape {
  hastily?: number;
  normally?: number;
  completely?: number;
  mainExtra?: number;
  allStyles?: number;
  hltb?: unknown;
}

export interface MetadataResult {
  title: string;
  description: string | null;
  developer: string | null;
  publisher: string | null;
  releaseDate: string | null;
  genres: string[];
  images: MetadataImages;
  sourceUrl: string;
  sourceName: string;
  storyline?: string;
  igdbRating?: number;
  criticRating?: number;
  themes?: string[];
  gameModes?: string[];
  playerPerspectives?: string[];
  screenshots?: string[];
  videos?: string[];
  websites?: string[];
  timeToBeat?: TimeToBeatShape;
  similarGames?: { id: number; name: string; coverUrl: string | null }[];
  releases?: { platform: string; dateStr: string; region: string }[];
  alternativeNames?: string[];
  collection?: string;
  collectionId?: number;
  igdbId?: number;
  franchise?: string;
  gameCategory?: string;
  releaseStatus?: string;
  languageSupports?: { language: string; supportType: string }[];
  isVr?: boolean;
}

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

interface IgdbName {
  name: string;
}

interface IgdbImage {
  url?: string;
}

interface IgdbGameRaw {
  id: number;
  name: string;
  slug: string;
  summary?: string | null;
  storyline?: string | null;
  first_release_date?: number;
  rating?: number;
  aggregated_rating?: number;
  cover?: IgdbImage | null;
  genres?: IgdbName[];
  themes?: IgdbName[];
  game_modes?: IgdbName[];
  player_perspectives?: IgdbName[];
  platforms?: IgdbName[];
  involved_companies?: {
    company?: IgdbName;
    developer?: boolean;
    publisher?: boolean;
  }[];
  screenshots?: IgdbImage[];
  artworks?: IgdbImage[];
  videos?: { video_id?: string }[];
  websites?: { url?: string }[];
  similar_games?: { id: number; name: string; cover?: IgdbImage | null }[];
  release_dates?: {
    platform?: IgdbName | null;
    human?: string | null;
    region?: number | null;
  }[];
  game_type?: number;
  status?: number;
  collections?: { id: number; name: string }[];
  franchises?: IgdbName[];
  alternative_names?: IgdbName[];
  language_supports?: {
    language?: IgdbName;
    language_support_type?: IgdbName;
  }[];
  total_rating_count?: number;
  hypes?: number;
  follows?: number;
}

const API = "https://api.igdb.com/v4";

export const IGDB_GAME_FIELDS =
  "name, slug, summary, storyline, first_release_date, rating, aggregated_rating, " +
  "cover.url, screenshots.url, artworks.url, videos.video_id, videos.name, " +
  "genres.name, themes.name, game_modes.name, player_perspectives.name, platforms.name, " +
  "involved_companies.developer, involved_companies.publisher, involved_companies.company.name, " +
  "websites.url, websites.category, similar_games.name, similar_games.cover.url, " +
  "release_dates.platform.name, release_dates.human, release_dates.region, " +
  "game_type, status, collections.id, collections.name, franchises.name, alternative_names.name, " +
  "language_supports.language.name, language_supports.language_support_type.name";

export function igdbCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = getSecret("TWITCH_CLIENT_ID") ?? getSecret("IGDB_CLIENT_ID");
  const clientSecret = getSecret("TWITCH_CLIENT_SECRET") ?? getSecret("IGDB_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function requireIgdbCredentials(): { clientId: string; clientSecret: string } {
  const credentials = igdbCredentials();
  if (!credentials) {
    throw new Error(
      "IGDB is not configured — add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET " +
        "(or IGDB_CLIENT_ID / IGDB_CLIENT_SECRET) to .env and rebuild.",
    );
  }
  return credentials;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let tokenMemo: CachedToken | null = null;
let tokenFailureUntil = 0;

async function fetchToken(): Promise<CachedToken> {
  const { clientId, clientSecret } = requireIgdbCredentials();
  if (tokenFailureUntil > Date.now()) {
    throw new Error("IGDB token fetch skipped — cooling down after a previous failure.");
  }
  const url =
    "https://id.twitch.tv/oauth2/token" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    "&grant_type=client_credentials";
  try {
    const response = await httpText(url, {
      method: "POST",
      headers: { "content-length": "0" },
      timeoutMs: 15_000,
      retries: 1,
    });
    if (!response.ok) {
      throw new Error(
        `Twitch token request failed with HTTP ${response.status}: ${response.text.slice(0, 200)}`,
      );
    }
    let body: { access_token?: string; expires_in?: number };
    try {
      body = JSON.parse(response.text) as { access_token?: string; expires_in?: number };
    } catch {
      throw new Error("Twitch token response was not valid JSON.");
    }
    if (!body.access_token || !body.expires_in) {
      throw new Error("Twitch token response did not include an access token.");
    }
    const token: CachedToken = {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(60, body.expires_in - 60) * 1000,
    };
    tokenMemo = token;
    cacheSet("igdb", "token", token);
    tokenFailureUntil = 0;
    return token;
  } catch (error) {
    tokenFailureUntil = Date.now() + 30_000;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`IGDB authentication failed — check the Twitch credentials. ${message}`);
  }
}

async function getToken(): Promise<string> {
  const now = Date.now();
  if (tokenMemo && tokenMemo.expiresAt > now) return tokenMemo.token;
  const disk = cacheGet<CachedToken>("igdb", "token", 60 * 24 * 60 * 60_000);
  if (disk && disk.expiresAt > now) {
    tokenMemo = disk;
    return disk.token;
  }
  return (await fetchToken()).token;
}

/** Serialize POST starts to one every 250 ms (IGDB 4 req/s). */
let gateTail: Promise<void> = Promise.resolve();
let lastStart = 0;

async function igdbGate(): Promise<void> {
  const previous = gateTail;
  let release!: () => void;
  gateTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const wait = Math.max(0, lastStart + 250 - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastStart = Date.now();
  release();
}

async function igdbPost<T>(endpoint: string, body: string): Promise<T> {
  const { clientId } = requireIgdbCredentials();
  const token = await getToken();
  await igdbGate();
  return httpJson<T>(`${API}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
      Accept: "application/json",
    },
    body,
    timeoutMs: 20_000,
    retries: 1,
  });
}

async function igdbQueryGames(body: string): Promise<IgdbGameRaw[]> {
  return igdbPost<IgdbGameRaw[]>("games", body);
}

/** IGDB image URLs arrive protocol-relative and at thumbnail size. */
function imageUrl(raw: string | undefined, size: "cover" | "720p" | "logo"): string | null {
  if (!raw) return null;
  const clean = raw.startsWith("//") ? `https:${raw}` : raw;
  if (size === "cover") return clean.replace("t_thumb", "t_cover_big");
  if (size === "logo") return clean.replace("t_thumb", "t_logo_med");
  return clean.replace("t_thumb", "t_720p");
}

function mapCategory(type: number | undefined): string {
  return (
    [
      "Main Game",
      "DLC / Add-on",
      "Expansion",
      "Bundle",
      "Standalone Expansion",
      "Mod",
      "Episode",
      "Season",
      "Remake",
      "Remaster",
      "Expanded Game",
      "Port",
      "Fork",
      "Pack",
      "Playable Prototype",
    ][type ?? 0] ?? "Unknown"
  );
}

function mapStatus(status: number | undefined): string {
  return (
    { 0: "Released", 2: "Alpha", 3: "Beta", 4: "Early Access", 5: "Offline", 6: "Cancelled" }[
      status ?? 0
    ] ?? "Unknown"
  );
}

function detectVr(title: string, genres: string[], platforms: string[]): boolean {
  if (/\bvr\b/i.test(title)) return true;
  const haystack = [...genres, ...platforms].join(" ").toLowerCase();
  return (
    haystack.includes("virtual reality") ||
    haystack.includes("vr only") ||
    haystack.includes("vr support") ||
    haystack.includes("steamvr") ||
    haystack.includes("oculus") ||
    haystack.includes("playstation vr")
  );
}

const REGION_NAMES: Record<number, string> = {
  1: "Europe",
  2: "North America",
  3: "Australia",
  4: "New Zealand",
  5: "Japan",
  6: "China",
  7: "Asia",
  8: "Worldwide",
  9: "Korea",
  10: "Brazil",
};

/** Map one IGDB row into the renderer's `GameMetadataResult` shape. */
export function mapIgdbGame(game: IgdbGameRaw): MetadataResult {
  const developers: string[] = [];
  const publishers: string[] = [];
  for (const company of game.involved_companies ?? []) {
    const name = company.company?.name;
    if (!name) continue;
    if (company.developer) developers.push(name);
    if (company.publisher) publishers.push(name);
  }

  const screenshots = (game.screenshots ?? [])
    .map((shot) => imageUrl(shot.url, "720p"))
    .filter((url): url is string => Boolean(url));
  const artworks = (game.artworks ?? [])
    .map((art) => imageUrl(art.url, "720p"))
    .filter((url): url is string => Boolean(url));

  let logo: string | null = null;
  for (const art of game.artworks ?? []) {
    if (art.url?.includes("/t_logo")) {
      logo = imageUrl(art.url, "logo");
      break;
    }
  }
  if (!logo) {
    for (const site of game.websites ?? []) {
      const match = site.url?.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (match) {
        logo = `https://cdn.cloudflare.steamstatic.com/steam/apps/${match[1]}/logo.png`;
        break;
      }
    }
  }

  const genres = (game.genres ?? []).map((genre) => genre.name);
  const platformNames = (game.platforms ?? []).map((platform) => platform.name);
  const websites = [...new Set((game.websites ?? []).map((site) => site.url).filter(Boolean))] as string[];

  return {
    title: game.name,
    description: game.summary ?? null,
    developer: developers.length ? developers.join("; ") : null,
    publisher: publishers.length ? publishers.join("; ") : null,
    releaseDate: game.first_release_date ? formatUnixTimestamp(game.first_release_date) : null,
    genres,
    images: {
      icon: null,
      cover: imageUrl(game.cover?.url, "cover"),
      hero: artworks[0] ?? screenshots[0] ?? null,
      banner: screenshots[0] ?? artworks[0] ?? null,
      logo,
    },
    sourceUrl: `https://www.igdb.com/games/${game.slug}`,
    sourceName: "IGDB",
    storyline: game.storyline ?? undefined,
    igdbRating: game.rating ?? undefined,
    criticRating: game.aggregated_rating ?? undefined,
    themes: game.themes?.map((theme) => theme.name),
    gameModes: game.game_modes?.map((mode) => mode.name),
    playerPerspectives: game.player_perspectives?.map((view) => view.name),
    screenshots: screenshots.length ? screenshots : undefined,
    videos: (game.videos ?? [])
      .map((video) => (video.video_id ? `https://www.youtube.com/watch?v=${video.video_id}` : null))
      .filter((url): url is string => Boolean(url)),
    websites: websites.length ? websites : undefined,
    similarGames: game.similar_games?.map((similar) => ({
      id: similar.id,
      name: similar.name,
      coverUrl: imageUrl(similar.cover?.url, "cover"),
    })),
    releases: game.release_dates?.map((release) => ({
      platform: release.platform?.name ?? "Unknown",
      dateStr: release.human ?? "Unknown",
      region: REGION_NAMES[release.region ?? 0] ?? "Global",
    })),
    alternativeNames: game.alternative_names?.map((alias) => alias.name),
    collection: game.collections?.[0]?.name,
    collectionId: game.collections?.[0]?.id,
    igdbId: game.id,
    franchise: game.franchises?.length
      ? game.franchises.map((franchise) => franchise.name).join("; ")
      : undefined,
    gameCategory: mapCategory(game.game_type),
    releaseStatus: mapStatus(game.status),
    languageSupports: game.language_supports
      ?.map((support) => {
        const language = support.language?.name;
        const supportType = support.language_support_type?.name;
        return language && supportType ? { language, supportType } : null;
      })
      .filter((entry): entry is { language: string; supportType: string } => Boolean(entry)),
    isVr: detectVr(game.name, genres, platformNames),
  };
}

interface QualityKey {
  yearMatch: boolean;
  released: boolean;
  mainGame: boolean;
  hasCover: boolean;
  hasDate: boolean;
  rating: number;
}

function qualityKey(yearHint: string | null, result: MetadataResult): QualityKey {
  return {
    yearMatch: Boolean(yearHint && result.releaseDate?.startsWith(yearHint)),
    released: result.releaseStatus === "Released",
    mainGame: result.gameCategory === "Main Game",
    hasCover: result.images.cover !== null,
    hasDate: result.releaseDate !== null,
    rating: result.igdbRating ?? 0,
  };
}

function compareQuality(a: QualityKey, b: QualityKey): number {
  const pairs: [boolean, boolean][] = [
    [a.yearMatch, b.yearMatch],
    [a.released, b.released],
    [a.mainGame, b.mainGame],
    [a.hasCover, b.hasCover],
    [a.hasDate, b.hasDate],
  ];
  for (const [left, right] of pairs) {
    if (left !== right) return left ? 1 : -1;
  }
  return a.rating - b.rating;
}

/** Search IGDB by name, ranked by title similarity then entry quality. */
export async function searchIgdb(gameName: string): Promise<MetadataResult[]> {
  const cleaned = cleanGameName(gameName);
  const stripped = stripYearMarker(cleaned) || cleaned;
  const yearHint = extractYear(gameName);
  const escaped = stripped.replace(/"/g, '\\"');
  const body = `search "${escaped}"; fields ${IGDB_GAME_FIELDS}; limit 8;`;

  const games = await cached("igdb", `search:${normalizeTitle(gameName)}`, TTL.igdb, () =>
    igdbQueryGames(body),
  );
  const mapped = games.map(mapIgdbGame);
  const score = (result: MetadataResult) =>
    Math.max(
      titleSimilarity(gameName, result.title),
      titleSimilarity(cleaned, result.title),
      titleSimilarity(stripped, result.title),
    );

  return mapped
    .map((result) => ({ result, score: score(result) }))
    .filter(({ score: value }) => value >= MIN_TITLE_SIMILARITY)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return compareQuality(qualityKey(yearHint, a.result), qualityKey(yearHint, b.result));
    })
    .map(({ result }) => result)
    .filter(
      (result, index, all) =>
        all.findIndex((candidate) => candidate.title.toLowerCase() === result.title.toLowerCase()) ===
        index,
    );
}

/** Full IGDB row for a numeric id. `null` when the id no longer exists. */
export async function fetchIgdbGameById(id: number): Promise<MetadataResult | null> {
  const body = `fields ${IGDB_GAME_FIELDS}; where id = ${Math.trunc(id)}; limit 1;`;
  const games = await cached("igdb", `game:${id}`, TTL.igdb, () => igdbQueryGames(body));
  return games.length ? mapIgdbGame(games[0]) : null;
}

/** Appid → IGDB game id via the exact `external_games` bridge. */
export async function resolveSteamToIgdb(appids: number[]): Promise<Map<number, number>> {
  const unique = [...new Set(appids.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const uids = unique.map((id) => `"${id}"`).join(",");
  const body =
    `fields game,uid,external_game_source; where uid = (${uids}) & ` +
    "(external_game_source = 1 | category = 1); limit 500; offset 0;";
  const rows = await cached("igdb", `steam-map:${unique.join(",")}`, TTL.igdb, () =>
    igdbPost<{ game?: number; uid?: string; external_game_source?: number }[]>(
      "external_games",
      body,
    ),
  );
  const map = new Map<number, number>();
  for (const row of rows) {
    if ((row.external_game_source ?? 1) !== 1 || !row.uid || !row.game) continue;
    const appid = Number.parseInt(row.uid, 10);
    if (Number.isFinite(appid)) map.set(appid, row.game);
  }
  return map;
}

/** Exact IGDB lookup for a Steam appid. */
export async function fetchIgdbGameBySteamAppid(appid: number): Promise<MetadataResult | null> {
  const map = await resolveSteamToIgdb([appid]);
  const igdbId = map.get(appid);
  return igdbId ? fetchIgdbGameById(igdbId) : null;
}

export async function fetchIgdbPlatforms(): Promise<{ id: number; name: string }[]> {
  requireIgdbCredentials();
  return cached("igdb", "platforms", TTL.igdb, async () => {
    const rows = await igdbPost<{ id?: number; name?: string }[]>(
      "platforms",
      "fields name; sort name asc; limit 500;",
    );
    return rows
      .filter((row): row is { id: number; name: string } =>
        typeof row.id === "number" && typeof row.name === "string",
      )
      .map((row) => ({ id: row.id, name: row.name }));
  });
}

const STORE_SUMMARY_FIELDS =
  "name,slug,summary,first_release_date,rating,aggregated_rating,cover.url," +
  "artworks.url,genres.name,platforms.name,total_rating_count,hypes,follows,websites.url,game_type";

function mapIgdbSummary(game: IgdbGameRaw): StoreGameSummary {
  const cover = imageUrl(game.cover?.url, "cover");
  let logo: string | null = null;
  for (const art of game.artworks ?? []) {
    if (art.url?.includes("/t_logo")) {
      logo = art.url.startsWith("//") ? `https:${art.url}` : art.url;
      break;
    }
  }
  const websites = [...new Set((game.websites ?? []).map((site) => site.url).filter(Boolean))] as string[];
  return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    summary: game.summary ?? null,
    rating: game.rating ?? null,
    aggregatedRating: game.aggregated_rating ?? null,
    coverUrl: cover,
    logoUrl: logo,
    genres: (game.genres ?? []).map((genre) => genre.name),
    platforms: (game.platforms ?? []).map((platform) => platform.name),
    firstReleaseDate: game.first_release_date ? formatUnixTimestamp(game.first_release_date) : null,
    totalRatingCount: game.total_rating_count ?? 0,
    hypes: game.hypes ?? 0,
    follows: game.follows ?? 0,
    websites: websites.length ? websites : undefined,
  };
}

function categoryWhereSort(category: string): { where: string; sort: string } {
  const now = Math.floor(Date.now() / 1000);
  switch (category) {
    case "trending":
      return { where: "hypes > 0", sort: "hypes desc" };
    case "popular":
      return { where: "total_rating_count > 5", sort: "total_rating_count desc" };
    case "top":
    case "top_rated":
      return { where: "aggregated_rating > 70", sort: "aggregated_rating desc" };
    case "coming_soon":
      return {
        where: `hypes > 0 & first_release_date > ${now} & first_release_date < ${now + 60 * 60 * 24 * 30 * 6}`,
        sort: "hypes desc",
      };
    case "new_releases":
      return {
        where: `first_release_date < ${now + 60 * 60 * 24} & first_release_date > ${now - 60 * 60 * 24 * 30}`,
        sort: "first_release_date desc",
      };
    default:
      return { where: "", sort: "total_rating_count desc" };
  }
}

export interface StoreGamesQuery {
  category?: string;
  query?: string;
  offset?: number;
  limit?: number;
  genres?: string[];
  platforms?: number[];
  yearMin?: number | null;
  yearMax?: number | null;
  ratingMin?: number | null;
  sort?: string | null;
}

const GENRE_IDS: Record<string, number> = {
  "Point-and-click": 2,
  Fighting: 4,
  Shooter: 5,
  Music: 7,
  Platform: 8,
  Puzzle: 9,
  Racing: 10,
  "Real Time Strategy (RTS)": 11,
  "Role-playing (RPG)": 12,
  Simulator: 13,
  Sport: 14,
  Strategy: 15,
  "Turn-based strategy (TBS)": 16,
  Tactical: 24,
  "Hack and slash/Beat 'em up": 25,
  "Quiz/Trivia": 26,
  Pinball: 30,
  Adventure: 31,
  Indie: 32,
  Arcade: 33,
  "Visual Novel": 34,
  "Card & Board Game": 35,
  MOBA: 36,
};

/** IGDB-backed store catalogue page (used by `fetch_store_games`). */
export async function fetchIgdbStoreGames(query: StoreGamesQuery): Promise<StoreGameSummary[]> {
  requireIgdbCredentials();
  const category = query.category ?? "all";
  const limit = Math.min(Math.max(1, query.limit ?? 24), 50);
  const offset = Math.max(0, query.offset ?? 0);
  const { where: baseWhere, sort: categorySort } = categoryWhereSort(category);
  const clauses: string[] = [];
  if (baseWhere) clauses.push(baseWhere);

  const sortMap: Record<string, string> = {
    popularity: "total_rating_count desc",
    rating: "rating desc",
    trending: "hypes desc",
    follows: "follows desc",
    release_new: "first_release_date desc",
    release_old: "first_release_date asc",
    name: "name asc",
    name_desc: "name desc",
  };
  const sort = query.sort && sortMap[query.sort] ? sortMap[query.sort] : categorySort;

  if (query.genres?.length) {
    const ids = query.genres.map((name) => GENRE_IDS[name]).filter((id): id is number => Boolean(id));
    if (ids.length) clauses.push(`genres = (${ids.join(",")})`);
  }
  if (query.platforms?.length) clauses.push(`platforms = (${query.platforms.join(",")})`);
  if (query.yearMin != null) {
    clauses.push(`first_release_date >= ${Date.UTC(query.yearMin, 0, 1) / 1000}`);
  }
  if (query.yearMax != null) {
    clauses.push(`first_release_date <= ${Date.UTC(query.yearMax, 11, 31, 23, 59, 59) / 1000}`);
  }
  if (query.ratingMin != null) clauses.push(`rating >= ${query.ratingMin}`);

  const where = clauses.join(" & ");
  const text = query.query?.trim()
    ? `search "${query.query.trim().replace(/"/g, '\\"')}";`
    : where
      ? `where ${where};`
      : "";
  const body = `fields ${STORE_SUMMARY_FIELDS}; ${text} sort ${sort}; limit ${limit}; offset ${offset};`;
  const rows = await igdbQueryGames(body);
  return rows.map(mapIgdbSummary);
}

/** Enrich an ordered list of Steam appids into IGDB store summaries. */
export async function enrichSteamAppIds(appids: number[], limit: number): Promise<StoreGameSummary[]> {
  if (appids.length === 0) return [];
  const idMap = await resolveSteamToIgdb(appids);
  const ordered: number[] = [];
  const seen = new Set<number>();
  for (const appid of appids) {
    const id = idMap.get(appid);
    if (id && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  if (ordered.length === 0) return [];
  const take = ordered.slice(0, Math.min(ordered.length, limit + 5));
  const body =
    `fields ${STORE_SUMMARY_FIELDS}; where id = (${take.join(",")}); limit 50; offset 0;`;
  const rows = await igdbQueryGames(body);
  const byId = new Map(rows.map((row) => [row.id, mapIgdbSummary(row)]));
  const results: StoreGameSummary[] = [];
  for (const id of take) {
    const summary = byId.get(id);
    if (summary) results.push(summary);
    if (results.length >= limit) break;
  }
  return results;
}

// ── Store spotlight ────────────────────────────────────────────────────

function extractSteamSearchAppIds(html: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const match of html.matchAll(/data-ds-appid="(\d+)"/g)) {
    const id = Number.parseInt(match[1], 10);
    if (Number.isFinite(id) && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

async function steamSearchRail(url: string): Promise<number[]> {
  try {
    const response = await httpText(url, { timeoutMs: 15_000, retries: 1 });
    if (!response.ok) return [];
    const payload = JSON.parse(response.text) as { results_html?: string };
    return extractSteamSearchAppIds(payload.results_html ?? "");
  } catch {
    return [];
  }
}

/**
 * Store hero rails. Hot/trending/top-seller categories use live Steam charts
 * and are enriched with IGDB metadata; IGDB catalogue sorts are the fallback.
 */
export async function fetchSpotlightGames(
  category: string,
  limit = 15,
): Promise<StoreGameSummary[]> {
  requireIgdbCredentials();
  const capped = Math.min(Math.max(1, limit), 30);
  return cached("igdb", `spotlight:${category}:${capped}`, 15 * 60_000, async () => {
    try {
      if (category === "hot") {
        const response = await httpText(
          "https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/",
          { timeoutMs: 15_000, retries: 1 },
        );
        if (response.ok) {
          const data = JSON.parse(response.text) as {
            response?: { ranks?: { appid?: number }[] };
          };
          const appids = (data.response?.ranks ?? [])
            .slice(0, 50)
            .map((rank) => rank.appid)
            .filter((id): id is number => typeof id === "number");
          const enriched = await enrichSteamAppIds(appids, capped);
          if (enriched.length) return enriched;
        }
      }

      if (category === "weekly" || category === "top_sellers") {
        const appids = await steamSearchRail(
          "https://store.steampowered.com/search/results/?query=&start=0&count=50&filter=topsellers&infinite=1",
        );
        const enriched = await enrichSteamAppIds(appids, capped);
        if (enriched.length) return enriched;
      }

      if (category === "trending") {
        const appids = await steamSearchRail(
          "https://store.steampowered.com/search/results/?query=&start=0&count=50&filter=popularnew&infinite=1",
        );
        const enriched = await enrichSteamAppIds(appids, capped);
        if (enriched.length) return enriched;
      }

      if (category === "coming_soon") {
        const appids = await steamSearchRail(
          "https://store.steampowered.com/search/results/?query=&start=0&count=50&filter=popularwishlist&infinite=1",
        );
        const enriched = await enrichSteamAppIds(appids, capped);
        if (enriched.length) return enriched;
      }

      if (category === "top_rated") {
        const body =
          `fields ${STORE_SUMMARY_FIELDS}; where aggregated_rating >= 85 & ` +
          `total_rating_count >= 20 & cover != null; sort aggregated_rating desc; ` +
          `limit ${capped}; offset 0;`;
        const rows = await igdbQueryGames(body);
        if (rows.length) return rows.map(mapIgdbSummary);
      }
    } catch (error) {
      console.warn(`[metadata] spotlight ${category} failed, falling back:`, error);
    }

    const fallbackCategory =
      category === "top_rated" ? "top" : category === "coming_soon" ? "coming_soon" : "popular";
    return fetchIgdbStoreGames({ category: fallbackCategory, limit: capped });
  });
}

