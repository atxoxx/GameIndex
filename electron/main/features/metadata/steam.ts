/**
 * Steam store / community endpoints.
 *
 * Ported from `game_scraper/steam_store.rs`, `game_scraper/reviews/steam.rs`
 * and `steam_stats.rs`. No API key is needed for any of these endpoints.
 */
import { httpText } from "../../lib/http";
import { cacheGet, cacheSet, TTL } from "./cache";
import type { MetadataResult } from "./igdb";
import { cleanGameName, titleSimilarity, MIN_TITLE_SIMILARITY } from "./text";

const STORE_API = "https://store.steampowered.com/api";
const REVIEWS_API = "https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/";
const PLAYER_COUNT_API =
  "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/";

export interface SteamAppDetails {
  name: string;
  developers: string[];
  publishers: string[];
  shortDescription: string | null;
  releaseDate: string | null;
  genres: string[];
  categories: string[];
  headerImage: string | null;
  capsuleImage: string | null;
  isFree: boolean;
  priceCents: number | null;
  currency: string | null;
}

interface RawAppDetails {
  name?: string;
  developers?: string[];
  publishers?: string[];
  short_description?: string;
  release_date?: { date?: string };
  genres?: { description?: string }[];
  categories?: { description?: string }[];
  header_image?: string;
  capsule_image?: string;
  is_free?: boolean;
  price_overview?: { currency?: string; final?: number };
}

function parseAppDetails(raw: RawAppDetails): SteamAppDetails {
  return {
    name: raw.name ?? "",
    developers: raw.developers ?? [],
    publishers: raw.publishers ?? [],
    shortDescription: raw.short_description?.trim() || null,
    releaseDate: raw.release_date?.date?.trim() || null,
    genres: (raw.genres ?? []).map((genre) => genre.description ?? "").filter(Boolean),
    categories: (raw.categories ?? [])
      .map((category) => category.description ?? "")
      .filter(Boolean),
    headerImage: raw.header_image ?? null,
    capsuleImage: raw.capsule_image ?? null,
    isFree: Boolean(raw.is_free),
    priceCents: raw.price_overview?.final && raw.price_overview.final > 0
      ? raw.price_overview.final
      : null,
    currency: raw.price_overview?.currency ?? null,
  };
}

async function fetchJson(url: string, timeoutMs = 15_000): Promise<unknown | null> {
  try {
    const response = await httpText(url, { timeoutMs, retries: 1 });
    if (!response.ok) return null;
    return JSON.parse(response.text) as unknown;
  } catch {
    return null;
  }
}

/** Steam `appdetails` for one appid (`null` = Steam has no store page). */
export async function fetchSteamAppDetails(appId: number): Promise<SteamAppDetails | null> {
  const key = `appdetails:${appId}`;
  const hit = cacheGet<SteamAppDetails | null>("steam", key, TTL.steamDetails);
  if (hit !== undefined) return hit;
  const payload = (await fetchJson(`${STORE_API}/appdetails?appids=${appId}&cc=us&l=en`)) as
    | Record<string, { success?: boolean; data?: RawAppDetails }>
    | null;
  const wrapper = payload?.[String(appId)];
  const details = wrapper?.success && wrapper.data ? parseAppDetails(wrapper.data) : null;
  cacheSet("steam", key, details);
  return details;
}

interface SteamSearchItem {
  id?: number;
  name?: string;
  tiny_image?: string;
}

/** Steam store search (used by metadata search and review appid resolution). */
export async function steamStoreSearch(term: string): Promise<SteamSearchItem[]> {
  const payload = (await fetchJson(
    `${STORE_API}/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=us`,
  )) as { items?: SteamSearchItem[] } | null;
  return Array.isArray(payload?.items) ? payload.items : [];
}

/** Find the Steam appid for a title; all query words must appear in the name. */
export async function lookupSteamAppId(gameName: string): Promise<number | null> {
  const cleaned = cleanGameName(gameName) || gameName;
  const items = await steamStoreSearch(cleaned);
  if (items.length === 0) return null;
  const words = gameName
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean);
  const byWords = items.find((item) => {
    const name = (item.name ?? "").toLowerCase();
    return words.every((word) => name.includes(word));
  });
  if (byWords?.id) return byWords.id;
  const best = items
    .map((item) => ({
      item,
      score: titleSimilarity(gameName, item.name ?? ""),
    }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score >= MIN_TITLE_SIMILARITY ? (best.item.id ?? null) : null;
}

/** Community tags from Steam's public app-hover endpoint. */
export async function fetchSteamUserTags(appId: number): Promise<string[]> {
  try {
    const response = await httpText(`https://store.steampowered.com/apphoverpublic/${appId}?l=english`, {
      timeoutMs: 12_000,
      retries: 1,
    });
    if (!response.ok) return [];
    const tags: string[] = [];
    const seen = new Set<string>();
    for (const match of response.text.matchAll(/<div[^>]*class="[^"]*app_tag[^"]*"[^>]*>([^<]+)<\/div>/g)) {
      const tag = match[1]
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
      const lower = tag.toLowerCase();
      if (tag && !seen.has(lower)) {
        seen.add(lower);
        tags.push(tag);
      }
    }
    return tags;
  } catch {
    return [];
  }
}

export async function fetchSteamGenresAndTags(appId: number): Promise<string[]> {
  const [details, tags] = await Promise.all([fetchSteamAppDetails(appId), fetchSteamUserTags(appId)]);
  const genres: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const lower = value.toLowerCase();
    if (!value || seen.has(lower)) return;
    seen.add(lower);
    genres.push(value);
  };
  for (const genre of details?.genres ?? []) push(genre);
  for (const category of details?.categories ?? []) {
    const lower = category.toLowerCase();
    if (lower.includes("player") || lower.includes("co-op") || lower.includes("pvp") || lower.includes("vr")) {
      push(category);
    }
  }
  for (const tag of tags) push(tag);
  return genres;
}

/** Direct Steam metadata by appid (the appid-pinned fallback path). */
export async function fetchSteamGameByAppId(appId: number): Promise<MetadataResult | null> {
  const details = await fetchSteamAppDetails(appId);
  if (!details) return null;
  const tags = await fetchSteamUserTags(appId);
  const genres = [...details.genres];
  const seen = new Set(genres.map((genre) => genre.toLowerCase()));
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      genres.push(tag);
    }
  }
  for (const category of details.categories) {
    const lower = category.toLowerCase();
    if (
      (lower.includes("player") || lower.includes("co-op") || lower.includes("pvp") || lower.includes("vr")) &&
      !seen.has(lower)
    ) {
      seen.add(lower);
      genres.push(category);
    }
  }
  return {
    title: details.name,
    description: details.shortDescription,
    developer: details.developers[0] ?? null,
    publisher: details.publishers[0] ?? null,
    releaseDate: details.releaseDate,
    genres,
    images: {
      icon: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`,
      cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
      hero:
        details.capsuleImage ??
        details.headerImage ??
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      banner: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
      logo: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png`,
    },
    sourceUrl: `https://store.steampowered.com/app/${appId}`,
    sourceName: "Steam",
    isVr: /\bvr\b/i.test(details.name) || genres.some((genre) => genre.toLowerCase().includes("vr")),
  };
}

/** Name search → best Steam metadata (used by `search_game_metadata`). */
export async function searchSteam(gameName: string): Promise<MetadataResult | null> {
  const items = await steamStoreSearch(cleanGameName(gameName) || gameName);
  if (items.length === 0) return null;
  let best: { item: SteamSearchItem; score: number } | null = null;
  for (const item of items) {
    if (!item.id) continue;
    const score = Math.max(
      titleSimilarity(gameName, item.name ?? ""),
      titleSimilarity(cleanGameName(gameName), item.name ?? ""),
    );
    if (!best || score > best.score) best = { item, score };
  }
  if (!best || best.score < MIN_TITLE_SIMILARITY) return null;
  const appId = best.item.id;
  if (appId == null) return null;
  const result = await fetchSteamGameByAppId(appId);
  if (result && best.item.tiny_image) result.images.icon = best.item.tiny_image;
  return result;
}

// ── Live player count ──────────────────────────────────────────────────

let playerCountMemo = new Map<number, { count: number | null; at: number }>();

/** Concurrent Steam players (`null` = Steam has no data for the appid). */
export async function getSteamPlayerCount(appId: number): Promise<number | null> {
  const memo = playerCountMemo.get(appId);
  if (memo && Date.now() - memo.at < TTL.playerCount) return memo.count;
  const key = `players:${appId}`;
  const disk = cacheGet<number | null>("steam", key, TTL.playerCount);
  if (disk !== undefined) {
    playerCountMemo.set(appId, { count: disk, at: Date.now() });
    return disk;
  }
  const payload = (await fetchJson(`${PLAYER_COUNT_API}?appid=${appId}`, 10_000)) as
    | { response?: { player_count?: number; result?: number } }
    | null;
  const count =
    payload?.response?.result === 1 && typeof payload.response.player_count === "number"
      ? payload.response.player_count
      : null;
  cacheSet("steam", key, count);
  if (playerCountMemo.size > 128) {
    const oldest = [...playerCountMemo.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) playerCountMemo.delete(oldest[0]);
  }
  playerCountMemo.set(appId, { count, at: Date.now() });
  return count;
}

export interface SteamPlayerHistoryPoint {
  timestamp: number;
  count: number;
}

export interface SteamPlayerHistory {
  appId: number;
  points: SteamPlayerHistoryPoint[];
  current: number;
  peakInRange: number;
  peakInRangeAt: number | null;
  peakAllTime: number;
  peakAllTimeAt: number | null;
  averageInRange: number;
  previousAverageInRange: number | null;
  sampleCount: number;
  downsampled: boolean;
}

const MAX_HISTORY_POINTS = 180;

/** Long-range CCU history from steamcharts.com, downsampled to ≤180 points. */
export async function getSteamPlayerHistory(
  appId: number,
  rangeDays: number,
): Promise<SteamPlayerHistory> {
  const seriesKey = `history-raw:${appId}`;
  let raw = cacheGet<[number, number][]>("steam", seriesKey, TTL.playerHistory);
  if (!raw) {
    try {
      const response = await httpText(`https://steamcharts.com/app/${appId}/chart-data.json`, {
        timeoutMs: 15_000,
        retries: 1,
      });
      if (!response.ok) {
        throw new Error(`steamcharts returned HTTP ${response.status} for appid ${appId}`);
      }
      const parsed = JSON.parse(response.text) as [number, number][];
      raw = parsed
        .filter((point): point is [number, number] => Array.isArray(point) && point.length === 2)
        .sort((a, b) => a[0] - b[0]);
      if (raw.length === 0) throw new Error(`No player-history data for appid ${appId}`);
      cacheSet("steam", seriesKey, raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Steam player history unavailable — ${message}`);
    }
  }

  const series = raw;
  if (!series) throw new Error(`No player-history data for appid ${appId}`);
  const nowMs = Date.now();
  const cutoff = rangeDays > 0 ? nowMs - rangeDays * 24 * 60 * 60_000 : 0;
  const inRange = cutoff > 0 ? series.filter(([ts]) => ts >= cutoff) : series;
  const window = inRange.length > 0 ? inRange : series;

  let peakAllTime = 0;
  let peakAllTimeAt: number | null = null;
  for (const [ts, count] of series) {
    if (count > peakAllTime) {
      peakAllTime = count;
      peakAllTimeAt = ts;
    }
  }

  let previousAverageInRange: number | null = null;
  if (rangeDays > 0) {
    const span = rangeDays * 24 * 60 * 60_000;
    const previousStart = cutoff - span;
    let sum = 0;
    let count = 0;
    for (const [ts, value] of series) {
      if (ts >= previousStart && ts < cutoff) {
        sum += value;
        count += 1;
      }
    }
    if (count > 0) previousAverageInRange = sum / count;
  }

  const downsampled = window.length > MAX_HISTORY_POINTS;
  const points: SteamPlayerHistoryPoint[] = [];
  if (downsampled) {
    const step = Math.max(1, Math.ceil(window.length / MAX_HISTORY_POINTS));
    for (let index = 0; index < window.length; index += step) {
      points.push({ timestamp: window[index][0], count: window[index][1] });
    }
    const last = window[window.length - 1];
    if (points[points.length - 1]?.timestamp !== last[0]) {
      points.push({ timestamp: last[0], count: last[1] });
    }
  } else {
    for (const [timestamp, count] of window) points.push({ timestamp, count });
  }

  let peakInRange = 0;
  let peakInRangeAt: number | null = null;
  for (const [ts, count] of window) {
    if (count > peakInRange) {
      peakInRange = count;
      peakInRangeAt = ts;
    }
  }
  const total = window.reduce((sum, [, count]) => sum + count, 0);

  return {
    appId,
    points,
    current: window[window.length - 1]?.[1] ?? 0,
    peakInRange,
    peakInRangeAt,
    peakAllTime,
    peakAllTimeAt,
    averageInRange: window.length ? total / window.length : 0,
    previousAverageInRange,
    sampleCount: points.length,
    downsampled,
  };
}

// ── Steam game stats (details + review aggregate) ──────────────────────

export interface SteamGameDetailsShape {
  name: string;
  developer: string | null;
  publisher: string | null;
  releaseDate: string | null;
  isFree: boolean;
  priceCents: number | null;
  currency: string | null;
  genres: string[];
}

export interface SteamGameReviewsShape {
  totalPositive: number;
  totalNegative: number;
  totalReviews: number;
  score: number | null;
  scoreDesc: string | null;
}

export interface SteamGameStats {
  appId: number;
  details: SteamGameDetailsShape | null;
  reviews: SteamGameReviewsShape | null;
  detailsError: string | null;
  reviewsError: string | null;
}

interface RawQuerySummary {
  review_score?: number;
  review_score_desc?: string;
  total_positive?: number;
  total_negative?: number;
  total_reviews?: number;
}

async function fetchReviewSummary(appId: number): Promise<SteamGameReviewsShape | null> {
  const key = `review-summary:${appId}`;
  const hit = cacheGet<SteamGameReviewsShape | null>("steam", key, TTL.steamReviews);
  if (hit !== undefined) return hit;
  const input = JSON.stringify({
    num_per_page: 1,
    filter: 0,
    day_range: 0,
    languages: ["all"],
    review_type: 0,
    purchase_type: 1,
  });
  const payload = (await fetchJson(
    `${REVIEWS_API}?appid=${appId}&input_json=${encodeURIComponent(input)}`,
  )) as { response?: { query_summary?: RawQuerySummary } } | null;
  const summary = payload?.response?.query_summary;
  const shape: SteamGameReviewsShape | null = summary
    ? {
        totalPositive: summary.total_positive ?? 0,
        totalNegative: summary.total_negative ?? 0,
        totalReviews: summary.total_reviews ?? 0,
        score: typeof summary.review_score === "number" ? summary.review_score : null,
        scoreDesc: summary.review_score_desc?.trim() || null,
      }
    : null;
  cacheSet("steam", key, shape);
  return shape;
}

/** Combined payload used by the Game page stat cards. */
export async function getSteamGameStats(appId: number): Promise<SteamGameStats> {
  const [detailsResult, reviewsResult] = await Promise.allSettled([
    fetchSteamAppDetails(appId),
    fetchReviewSummary(appId),
  ]);

  const details =
    detailsResult.status === "fulfilled" && detailsResult.value
      ? {
          name: detailsResult.value.name,
          developer: detailsResult.value.developers[0] ?? null,
          publisher: detailsResult.value.publishers[0] ?? null,
          releaseDate: detailsResult.value.releaseDate,
          isFree: detailsResult.value.isFree,
          priceCents: detailsResult.value.priceCents,
          currency: detailsResult.value.currency,
          genres: detailsResult.value.genres,
        }
      : null;

  return {
    appId,
    details,
    reviews: reviewsResult.status === "fulfilled" ? reviewsResult.value : null,
    detailsError:
      detailsResult.status === "rejected"
        ? "Steam store details are unavailable right now."
        : details
          ? null
          : "Steam has no store page for this app.",
    reviewsError:
      reviewsResult.status === "rejected" ? "Steam review totals are unavailable right now." : null,
  };
}

// ── Reviews (viewer) ───────────────────────────────────────────────────

export interface SteamHardware {
  os?: string;
  cpuName?: string;
  gpuName?: string;
  systemRamMb?: number;
  vramSizeMb?: number;
}

export interface SteamReviewShape {
  title?: string;
  content?: string;
  rating?: number;
  username?: string;
  language?: string;
  votesUp?: number;
  votesFunny?: number;
  timestampCreated?: number;
  timestampUpdated?: number;
  authorSteamId?: string;
  authorPlaytimeForever?: number;
  authorPlaytimeAtReview?: number;
  authorDeckPlaytimeAtReview?: number;
  primarilySteamDeck?: boolean;
  receivedForFree?: boolean;
  writtenDuringEarlyAccess?: boolean;
  steamPurchase?: boolean;
  commentCount?: number;
  reactions?: { reactionType: number; count: number }[];
  weightVoteUpPercentage?: number;
  hw?: SteamHardware;
}

export interface ReviewFetchResult {
  reviews: SteamReviewShape[];
  source: string;
  error: string | null;
  totalReviews?: number;
  cursor?: string;
  steamReviewScore?: number;
  steamReviewScoreDesc?: string;
  steamTotalPositive?: number;
  steamTotalNegative?: number;
}

export interface SteamReviewQuery {
  cursor?: string | null;
  language?: string | null;
  filterType?: string | null;
  purchaseType?: string | null;
  playtimeMinHours?: number | null;
  playtimeMaxHours?: number | null;
  reviewType?: string | null;
  playtimeDevice?: string | null;
  useHelpfulSystem?: boolean | null;
}

interface RawReview {
  review?: string;
  voted_up?: boolean;
  votes_up?: number;
  votes_funny?: number;
  language?: string;
  timestamp_created?: number;
  timestamp_updated?: number;
  weighted_vote_score?: number | string;
  comment_count?: number;
  steam_purchase?: boolean;
  received_for_free?: boolean;
  written_during_early_access?: boolean;
  primarily_steam_deck?: boolean;
  reactions?: { reaction_type?: number; count?: number }[];
  hardware?: {
    os?: string;
    cpu_name?: string;
    adapter_description?: string;
    dx_video_card?: string;
    system_ram?: number | string;
    vram_size?: number | string;
  };
  author?: {
    steamid?: string;
    personaname?: string;
    playtime_forever?: number;
    playtime_at_review?: number;
    deck_playtime_at_review?: number;
  };
}

function toMb(value: number | string | undefined): number | undefined {
  if (typeof value === "number") return value > 0 ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function filterEnum(value: string | null | undefined): number {
  if (value === "recent") return 1;
  if (value === "funny") return 3;
  return 0;
}

function reviewTypeEnum(value: string | null | undefined): number {
  if (value === "positive") return 1;
  if (value === "negative") return 2;
  return 0;
}

function purchaseTypeEnum(value: string | null | undefined): number {
  if (value === "steam") return 0;
  if (value === "other") return 2;
  return 1;
}

function mapReviews(raw: RawReview[]): SteamReviewShape[] {
  const out: SteamReviewShape[] = [];
  for (const review of raw) {
    const content = review.review?.trim();
    if (!content) continue;
    const author = review.author;
    const steamId = author?.steamid;
    const username =
      author?.personaname?.trim() ||
      (steamId ? `Steam Player …${steamId.slice(-4)}` : "Steam Player");
    const weight = review.weighted_vote_score;
    const weightNumber = typeof weight === "number" ? weight : Number.parseFloat(weight ?? "");
    const hardware = review.hardware;
    const gpu = hardware?.adapter_description?.trim() || hardware?.dx_video_card?.trim();
    const hw: SteamHardware | undefined = hardware
      ? {
          os: hardware.os?.trim() || undefined,
          cpuName: hardware.cpu_name?.trim() || undefined,
          gpuName: gpu || undefined,
          systemRamMb: toMb(hardware.system_ram),
          vramSizeMb: toMb(hardware.vram_size),
        }
      : undefined;
    const reactions = (review.reactions ?? [])
      .filter((reaction) => (reaction.count ?? 0) > 0)
      .map((reaction) => ({
        reactionType: reaction.reaction_type ?? 0,
        count: reaction.count ?? 0,
      }));

    out.push({
      content,
      rating: review.voted_up ? 85 : 35,
      username,
      language: review.language,
      votesUp: review.votes_up,
      votesFunny: review.votes_funny,
      timestampCreated: review.timestamp_created,
      timestampUpdated: review.timestamp_updated,
      authorSteamId: steamId,
      authorPlaytimeForever: author?.playtime_forever || undefined,
      authorPlaytimeAtReview: author?.playtime_at_review || undefined,
      authorDeckPlaytimeAtReview: author?.deck_playtime_at_review || undefined,
      primarilySteamDeck: review.primarily_steam_deck,
      receivedForFree: review.received_for_free,
      writtenDuringEarlyAccess: review.written_during_early_access,
      steamPurchase: review.steam_purchase,
      commentCount: review.comment_count || undefined,
      reactions: reactions.length ? reactions : undefined,
      weightVoteUpPercentage: Number.isFinite(weightNumber)
        ? Math.round(Math.min(1, Math.max(0, weightNumber)) * 100)
        : undefined,
      hw,
    });
  }
  return out;
}

/** One page of Steam reviews (cursor pagination). */
export async function fetchSteamReviews(
  appId: number,
  query: SteamReviewQuery,
): Promise<{
  reviews: SteamReviewShape[];
  total: number;
  cursor: string | null;
  summary: RawQuerySummary | null;
}> {
  const maxHours =
    query.playtimeMaxHours === undefined || query.playtimeMaxHours === null || query.playtimeMaxHours === 100
      ? 0
      : query.playtimeMaxHours;
  const input = JSON.stringify({
    cursor: !query.cursor || query.cursor === "*" ? "*" : query.cursor,
    filter: filterEnum(query.filterType),
    day_range: 0,
    languages: [query.language || "all"],
    review_type: reviewTypeEnum(query.reviewType),
    purchase_type: purchaseTypeEnum(query.purchaseType),
    num_per_page: 20,
    filter_offtopic_activity: false,
    use_review_quality: Boolean(query.useHelpfulSystem),
    playtime_min_hours: query.playtimeMinHours ?? 0,
    playtime_max_hours: maxHours,
    primarily_steam_deck: query.playtimeDevice === "deck",
  });

  const response = await httpText(
    `${REVIEWS_API}?appid=${appId}&input_json=${encodeURIComponent(input)}`,
    { timeoutMs: 20_000, retries: 1 },
  );
  if (response.status === 429) throw new Error("Steam reviews request was rate limited (HTTP 429)");
  if (!response.ok) throw new Error(`Steam reviews returned HTTP ${response.status}`);
  const payload = JSON.parse(response.text) as {
    response?: {
      query_summary?: RawQuerySummary;
      reviews?: RawReview[];
      cursor?: string;
      total_matching?: number;
    };
  };
  const body = payload.response ?? {};
  const summary = body.query_summary ?? null;
  const total = body.total_matching ?? summary?.total_reviews ?? 0;
  return {
    reviews: mapReviews(body.reviews ?? []),
    total,
    cursor: body.cursor && body.cursor !== "*" ? body.cursor : null,
    summary,
  };
}

/** Steam first, no IGDB review fallback (the IGDB endpoint is retired). */
export async function fetchGameReviews(
  gameName: string,
  steamAppId: number | null | undefined,
  query: SteamReviewQuery,
): Promise<ReviewFetchResult> {
  const appId = steamAppId ?? (await lookupSteamAppId(gameName));
  if (!appId) {
    return {
      reviews: [],
      source: "none",
      error: "No Steam app id could be resolved for this game.",
    };
  }
  try {
    const result = await fetchSteamReviews(appId, query);
    if (result.reviews.length === 0) {
      return {
        reviews: [],
        source: "none",
        error: "No reviews available from any source",
        totalReviews: result.total,
        cursor: result.cursor ?? undefined,
        steamReviewScore: result.summary?.review_score,
        steamReviewScoreDesc: result.summary?.review_score_desc,
        steamTotalPositive: result.summary?.total_positive,
        steamTotalNegative: result.summary?.total_negative,
      };
    }
    return {
      reviews: result.reviews,
      source: "steam",
      error: null,
      totalReviews: result.total,
      cursor: result.cursor ?? undefined,
      steamReviewScore: result.summary?.review_score,
      steamReviewScoreDesc: result.summary?.review_score_desc,
      steamTotalPositive: result.summary?.total_positive,
      steamTotalNegative: result.summary?.total_negative,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reviews: [], source: "none", error: message };
  }
}
