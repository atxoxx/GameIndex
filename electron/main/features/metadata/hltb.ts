/**
 * HowLongToBeat.
 *
 * Ported from `src-tauri/src/hltb.rs`. HLTB has no public API: the search
 * endpoint needs a short-lived token from `/api/search/site/init`, and the
 * detail page is a Next.js SSR document whose `__NEXT_DATA__` carries the
 * stats. Requests are paced to one every 600 ms and results (including
 * misses) are cached for 12 h.
 */
import { httpJson, httpText } from "../../lib/http";
import { cached, TTL } from "./cache";
import { normalizeTitle } from "./text";

const BASE = "https://howlongtobeat.com";
const MIN_REQUEST_GAP_MS = 600;
const MIN_MATCH_SCORE = 200;

let lastRequest = 0;
let tokenMemo: { token: string; hpKey?: string; hpVal?: string; at: number } | null = null;

async function pace(): Promise<void> {
  const wait = Math.max(0, lastRequest + MIN_REQUEST_GAP_MS - Date.now());
  lastRequest = Date.now() + wait;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

interface SearchToken {
  token: string;
  hpKey?: string;
  hpVal?: string;
}

async function getToken(force = false): Promise<SearchToken | null> {
  if (!force && tokenMemo && Date.now() - tokenMemo.at < 20 * 60_000) return tokenMemo;
  try {
    await pace();
    const value = await httpJson<Record<string, unknown>>(
      `${BASE}/api/search/site/init?t=${Date.now()}`,
      {
        headers: { Referer: `${BASE}/`, Accept: "application/json" },
        timeoutMs: 15_000,
        retries: 1,
      },
    );
    const token = typeof value.token === "string" ? value.token : null;
    if (!token) return null;
    const fresh: SearchToken = {
      token,
      hpKey: typeof value.hpKey === "string" ? value.hpKey : undefined,
      hpVal: typeof value.hpVal === "string" ? value.hpVal : undefined,
    };
    tokenMemo = { ...fresh, at: Date.now() };
    return tokenMemo;
  } catch {
    return null;
  }
}

interface SearchItem {
  game_id?: number;
  game_name?: string;
  game_alias?: string;
  game_type?: string;
  game_image?: string;
  profile_platform?: string;
  release_world?: number | string;
  comp_main?: number;
  comp_main_count?: number;
  comp_plus?: number;
  comp_plus_count?: number;
  comp_100?: number;
  comp_100_count?: number;
  comp_all?: number;
  comp_all_count?: number;
  comp_lvl_sp?: number;
  comp_lvl_spd?: number;
  comp_lvl_co?: number;
  comp_lvl_mp?: number;
  comp_lvl_combine?: number;
  count_comp?: number;
  count_playing?: number;
  count_backlog?: number;
  count_retired?: number;
  count_review?: number;
  review_score?: number;
  invested_co?: number;
  invested_co_count?: number;
  invested_mp?: number;
  invested_mp_count?: number;
}

function searchTerms(name: string): string[] {
  let depth = 0;
  let cleaned = "";
  for (const char of name) {
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) cleaned += char;
  }
  return cleaned
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token.length > 0 && !isYearToken(token));
}

function isYearToken(token: string): boolean {
  if (!/^\d{4}$/.test(token)) return false;
  const year = Number.parseInt(token, 10);
  return year >= 1970 && year <= 2100;
}

function matchScore(query: string, candidate: string): number {
  const q = normalizeTitle(query);
  const c = normalizeTitle(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1000;
  if (c.startsWith(q) || q.startsWith(c)) {
    return 600 + Math.floor((Math.min(q.length, c.length) / Math.max(q.length, c.length)) * 150);
  }
  const qTokens = new Set(q.split(" "));
  const cTokens = new Set(c.split(" "));
  let intersection = 0;
  for (const token of qTokens) if (cTokens.has(token)) intersection += 1;
  const union = new Set([...qTokens, ...cTokens]).size;
  return union === 0 ? 0 : Math.floor((intersection / union) * 500);
}

function releaseYear(item: SearchItem): number | null {
  const value = item.release_world;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.slice(0, 4), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractYear(name: string): number | null {
  for (const token of name.split(/[^0-9]+/)) {
    if (token.length === 4) {
      const year = Number.parseInt(token, 10);
      if (year >= 1970 && year <= 2100) return year;
    }
  }
  return null;
}

function pickBest(query: string, items: SearchItem[]): SearchItem | null {
  const year = extractYear(query);
  let best: { score: number; item: SearchItem } | null = null;
  for (const item of items) {
    if (!item.game_name) continue;
    let score = matchScore(query, item.game_name);
    if (item.game_alias) score = Math.max(score, matchScore(query, item.game_alias));
    if (item.game_type === "dlc") score -= 50;
    if (year !== null && releaseYear(item) === year) score += 100;
    if (score < MIN_MATCH_SCORE) continue;
    if (!best || score > best.score) best = { score, item };
  }
  return best?.item ?? null;
}

async function searchItems(name: string, token: SearchToken): Promise<SearchItem[] | null> {
  const terms = searchTerms(name);
  if (terms.length === 0) return null;
  const body: Record<string, unknown> = {
    searchType: "games",
    searchTerms: terms,
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: "",
        sortCategory: "popular",
        rangeCategory: "main",
        rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
        year: "",
        modifier: "",
      },
      users: { sortCategory: "postcount" },
      lists: { sortCategory: "follows" },
      filter: "",
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
  };
  if (token.hpKey && token.hpVal) body[token.hpKey] = token.hpVal;

  await pace();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-auth-token": token.token,
    Referer: `${BASE}/`,
  };
  if (token.hpKey && token.hpVal) {
    headers["x-hp-key"] = token.hpKey;
    headers["x-hp-val"] = token.hpVal;
  }
  try {
    const response = await httpJson<{ data?: SearchItem[] }>(`${BASE}/api/search/site`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: 20_000,
    });
    return Array.isArray(response.data) ? response.data : null;
  } catch {
    return null;
  }
}

async function search(name: string): Promise<SearchItem | null> {
  const token = await getToken();
  if (token) {
    const items = await searchItems(name, token);
    if (items) return pickBest(name, items);
  }
  const fresh = await getToken(true);
  if (!fresh) return null;
  const items = await searchItems(name, fresh);
  return items ? pickBest(name, items) : null;
}

function parseNextData(html: string): Record<string, unknown> | null {
  const marker = 'id="__NEXT_DATA__"';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const open = html.indexOf(">", markerIndex);
  if (open < 0) return null;
  const close = html.indexOf("</script>", open);
  if (close < 0) return null;
  try {
    return JSON.parse(html.slice(open + 1, close).trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchDetail(id: number): Promise<Record<string, unknown> | null> {
  await pace();
  try {
    const response = await httpText(`${BASE}/game/${id}`, {
      headers: { Referer: `${BASE}/` },
      timeoutMs: 20_000,
      retries: 1,
    });
    if (!response.ok) return null;
    return parseNextData(response.text);
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function detailGame(detail: Record<string, unknown> | null): Record<string, unknown> | null {
  const props = record(detail?.props);
  const pageProps = record(props?.pageProps);
  const game = record(pageProps?.game);
  const data = record(game?.data);
  const rows = data?.game;
  if (!Array.isArray(rows)) return null;
  return record(rows[0]);
}

function detailData(detail: Record<string, unknown> | null): Record<string, unknown> | null {
  const props = record(detail?.props);
  const pageProps = record(props?.pageProps);
  const game = record(pageProps?.game);
  return record(game?.data);
}

function numberField(value: Record<string, unknown> | null, key: string): number | undefined {
  const raw = value?.[key];
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function stringField(value: Record<string, unknown> | null, key: string): string | undefined {
  const raw = value?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

interface TimeStat {
  average?: number;
  median?: number;
  low?: number;
  high?: number;
  count?: number;
}

function buildTimeStat(
  prefix: string,
  game: Record<string, unknown> | null,
  fallbackAverage?: number,
  fallbackCount?: number,
): TimeStat {
  const field = (suffix: string) =>
    numberField(game, suffix ? `${prefix}_${suffix}` : prefix);
  return {
    average: field("") ?? field("avg") ?? fallbackAverage,
    median: field("med"),
    low: field("l") ?? field("min"),
    high: field("h") ?? field("max"),
    count: field("count") ?? fallbackCount,
  };
}

function hasStat(stat: TimeStat): boolean {
  return Boolean(stat.average || stat.median || stat.low || stat.high);
}

function statOrUndefined(stat: TimeStat): TimeStat | undefined {
  return hasStat(stat) ? stat : undefined;
}

export interface HltbPayload {
  hastily?: number;
  normally?: number;
  mainExtra?: number;
  completely?: number;
  allStyles?: number;
  hltb?: Record<string, unknown>;
}

function buildTimeToBeat(fallback: SearchItem | null, detail: Record<string, unknown> | null): HltbPayload | null {
  const game = detailGame(detail);
  const dataset = detailData(detail);
  const gameId = numberField(game, "game_id") ?? fallback?.game_id;
  if (!gameId) return null;

  const mainStory = buildTimeStat("comp_main", game, fallback?.comp_main, fallback?.comp_main_count);
  const mainExtra = buildTimeStat("comp_plus", game, fallback?.comp_plus, fallback?.comp_plus_count);
  const completionist = buildTimeStat("comp_100", game, fallback?.comp_100, fallback?.comp_100_count);
  const allStyles = buildTimeStat("comp_all", game, fallback?.comp_all, fallback?.comp_all_count);
  const speedrun = buildTimeStat("comp_speed", game);
  const completionistSpeedrun = buildTimeStat("comp_speed100", game);
  const investedCo = buildTimeStat("invested_co", game, fallback?.invested_co, fallback?.invested_co_count);
  const investedMp = buildTimeStat("invested_mp", game, fallback?.invested_mp, fallback?.invested_mp_count);

  const normally = mainStory.average ?? fallback?.comp_main;
  const mainExtraAvg = mainExtra.average ?? fallback?.comp_plus;
  const completely = completionist.average ?? fallback?.comp_100;
  const allStylesAvg = allStyles.average ?? fallback?.comp_all;
  if (!normally && !mainExtraAvg && !completely && !allStylesAvg) return null;

  const detailName = stringField(game, "game_name") ?? fallback?.game_name;
  if (!detailName) return null;

  const imageFile = stringField(game, "game_image") ?? fallback?.game_image;
  const releaseWorld =
    stringField(game, "release_world") ??
    (fallback?.release_world != null ? String(fallback.release_world) : undefined);

  const platformData = Array.isArray(dataset?.platformData) ? dataset.platformData : [];
  const individuality = Array.isArray(dataset?.individuality) ? dataset.individuality : [];
  const allByPlatform = new Map<string, number>();
  for (const row of individuality) {
    const entry = record(row);
    const platform = stringField(entry, "platform");
    const value = numberField(entry, "comp_all");
    if (platform && value) allByPlatform.set(platform, value);
  }
  const platformStats = platformData
    .map((row) => record(row))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const platform = stringField(row, "platform");
      if (!platform) return null;
      return {
        platform,
        completed: numberField(row, "count_comp"),
        total: numberField(row, "count_total"),
        mainStory: numberField(row, "comp_main"),
        mainExtra: numberField(row, "comp_plus"),
        completionist: numberField(row, "comp_100"),
        allStyles: allByPlatform.get(platform),
        low: numberField(row, "comp_low"),
        high: numberField(row, "comp_high"),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const relationships = Array.isArray(dataset?.relationships) ? dataset.relationships : [];
  const related = relationships
    .map((row) => record(row))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const gameRecordId = numberField(row, "game_id");
      const name = stringField(row, "game_name");
      if (!gameRecordId || !name) return null;
      return {
        gameId: gameRecordId,
        gameName: name,
        gameType: stringField(row, "game_type"),
        mainStory: numberField(row, "comp_main"),
        mainExtra: numberField(row, "comp_plus"),
        completionist: numberField(row, "comp_100"),
        allStyles: numberField(row, "comp_all"),
        allStylesCount: numberField(row, "comp_all_count"),
        backlog: numberField(row, "count_backlog"),
        reviewScore: numberField(row, "review_score"),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const reviewObject = record(dataset?.userReviews);
  const reviewHistogram = reviewObject
    ? Object.entries(reviewObject)
        .filter(([key]) => key !== "review_count")
        .map(([key, value]) => {
          const score = Number.parseInt(key, 10);
          const count = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
          return Number.isFinite(score) && Number.isFinite(count) && count > 0
            ? { score, count }
            : null;
        })
        .filter((row): row is { score: number; count: number } => Boolean(row))
        .sort((a, b) => a.score - b.score)
    : [];

  const hltb = {
    gameId,
    gameName: detailName,
    gameAlias: stringField(game, "game_alias") ?? fallback?.game_alias,
    gameType: stringField(game, "game_type") ?? fallback?.game_type,
    url: `${BASE}/game/${gameId}`,
    imageUrl: imageFile
      ? imageFile.startsWith("http")
        ? imageFile
        : `${BASE}/games/${imageFile}`
      : undefined,
    description: stringField(game, "profile_summary"),
    developer: stringField(game, "profile_dev"),
    publisher: stringField(game, "profile_pub"),
    platforms: stringField(game, "profile_platform") ?? fallback?.profile_platform,
    genres: stringField(game, "profile_genre"),
    steamAppId: numberField(game, "profile_steam"),
    releaseWorld,
    releaseNa: stringField(game, "release_na"),
    releaseEu: stringField(game, "release_eu"),
    releaseJp: stringField(game, "release_jp"),
    ratingEsrb: stringField(game, "rating_esrb"),
    ratingPegi: stringField(game, "rating_pegi"),
    ratingCero: stringField(game, "rating_cero"),
    mainStory: statOrUndefined(mainStory),
    mainExtra: statOrUndefined(mainExtra),
    completionist: statOrUndefined(completionist),
    allStyles: statOrUndefined(allStyles),
    speedrun: statOrUndefined(speedrun),
    completionistSpeedrun: statOrUndefined(completionistSpeedrun),
    investedCo: statOrUndefined(investedCo),
    investedMp: statOrUndefined(investedMp),
    levels: {
      singlePlayer: Boolean(numberField(game, "comp_lvl_sp") ?? fallback?.comp_lvl_sp),
      singlePlayerDifficulty: Boolean(numberField(game, "comp_lvl_spd") ?? fallback?.comp_lvl_spd),
      coOp: Boolean(numberField(game, "comp_lvl_co") ?? fallback?.comp_lvl_co),
      multiplayer: Boolean(numberField(game, "comp_lvl_mp") ?? fallback?.comp_lvl_mp),
      combined: Boolean(numberField(game, "comp_lvl_combine") ?? fallback?.comp_lvl_combine),
    },
    community: {
      completed: numberField(game, "count_comp") ?? fallback?.count_comp,
      playing: numberField(game, "count_playing") ?? fallback?.count_playing,
      backlog: numberField(game, "count_backlog") ?? fallback?.count_backlog,
      replays: numberField(game, "count_replay"),
      retired: numberField(game, "count_retired") ?? fallback?.count_retired,
      reviews: numberField(game, "count_review") ?? fallback?.count_review,
      reviewScore: numberField(game, "review_score") ?? fallback?.review_score,
      total: numberField(game, "count_total"),
    },
    platformStats: platformStats.length ? platformStats : undefined,
    related: related.length ? related : undefined,
    reviewHistogram: reviewHistogram.length ? reviewHistogram : undefined,
  };

  return {
    normally,
    mainExtra: mainExtraAvg,
    completely,
    allStyles: allStylesAvg,
    hltb,
  };
}

/** Time-to-beat for a title (or an exact HLTB id). `null` when unmatched. */
export async function fetchTimeToBeat(
  gameName: string,
  hltbId?: number | null,
): Promise<HltbPayload | null> {
  const cacheKey = hltbId ? `id:${hltbId}` : normalizeTitle(gameName);
  if (!cacheKey) return null;
  return cached("hltb", cacheKey, TTL.hltb, async () => {
    let item: SearchItem | null = null;
    let detail: Record<string, unknown> | null = null;
    if (hltbId) detail = await fetchDetail(hltbId);
    if (!detail) {
      item = await search(gameName);
      if (!item?.game_id) return null;
      detail = await fetchDetail(item.game_id);
    }
    return buildTimeToBeat(item, detail);
  });
}
