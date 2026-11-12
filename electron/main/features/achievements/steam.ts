/**
 * Steam achievement provider.
 *
 * Port of the network half of `src-tauri/src/achievements.rs` and
 * `src-tauri/src/manual_links.rs`:
 *
 *  • `GetSchemaForGame/v2` (keyed, then keyless) for the definition list;
 *  • `GetPlayerAchievements/v1` for unlock state (needs the user's SteamID64
 *    and a Web API key);
 *  • `GetGlobalAchievementPercentagesForApp/v2` for rarity (keyless);
 *  • the anonymous Steam Community achievements page as the keyless schema
 *    fallback (Steam's keyless `GetSchemaForGame` answers HTTP 400);
 *  • the Steam Store search endpoint for manual-link candidates.
 *
 * Every call goes through `lib/http.ts`, so the shared user-agent, timeout and
 * retry policy (including 429 backoff) apply.
 */
import * as cheerio from "cheerio";
import type { Achievement, GameAchievementData } from "../../../../src/types/game";
import { httpText } from "../../lib/http";
import { getSecret } from "../../lib/secrets";
import { loadSteamSession } from "../stores/steamSession";
import { findCachedBySteamAppId } from "./store";
import { clampPercent, sortAchievements } from "./util";

const API_BASE = "https://api.steampowered.com";
const COMMUNITY_STATS_BASE = "https://steamcommunity.com/stats";
const STORE_SEARCH_URL = "https://store.steampowered.com/api/storesearch/";
/** Max candidates returned by `manual_search_steam`. */
const MAX_SEARCH_RESULTS = 10;

// ── Wire types ────────────────────────────────────────────────────────

export interface SteamSchemaRow {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  icongray: string;
  hidden: number;
}

export interface SteamPlayerRow {
  apiname: string;
  achieved: number;
  unlocktime: number;
}

interface SchemaResponse {
  game?: {
    availableGameStats?: {
      achievements?: Array<Partial<SteamSchemaRow> & { hidden?: number }>;
    };
  };
}

interface PlayerAchievementsResponse {
  playerstats?: {
    achievements?: Array<Partial<SteamPlayerRow>>;
    success?: boolean;
  };
}

interface GlobalPercentResponse {
  achievementpercentages?: {
    achievements?: Array<{ name: string; percent: number | string }>;
  };
}

export const STEAM_NOT_CONFIGURED =
  "Steam achievements are not configured — connect Steam in Settings → Integrations " +
  "(or set STEAM_API_KEY) and sync again.";

export interface SteamStoreSearchResult {
  appid: number;
  name: string;
}

// ── Key + client helpers ──────────────────────────────────────────────

/**
 * The Steam Web API key available to this build: the connected Steam session
 * first, then the build-time `STEAM_API_KEY` fallback (same precedence the
 * store sync uses).
 */
export function storedSteamApiKey(): string | null {
  const session = loadSteamSession();
  const fromSession = session?.apiKey?.trim();
  if (fromSession) return fromSession;
  const fallback = getSecret("STEAM_API_KEY");
  return fallback && fallback.trim() ? fallback.trim() : null;
}

function buildUrl(path: string, params: Record<string, string | number>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${API_BASE}${path}?${query}`;
}

// ── Schema ────────────────────────────────────────────────────────────

function normalizeSchemaRows(rows: unknown): SteamSchemaRow[] {
  if (!Array.isArray(rows)) return [];
  const out: SteamSchemaRow[] = [];
  for (const entry of rows) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : "";
    if (!name) continue;
    out.push({
      name,
      displayName: typeof row.displayName === "string" ? row.displayName : "",
      description: typeof row.description === "string" ? row.description : "",
      icon: typeof row.icon === "string" ? row.icon : "",
      icongray: typeof row.icongray === "string" ? row.icongray : "",
      hidden: Number(row.hidden ?? 0) || 0,
    });
  }
  return out;
}

/** Parse a `GetSchemaForGame/v2` body into schema rows. */
export function parseSteamSchemaJson(json: string): SteamSchemaRow[] {
  let parsed: SchemaResponse;
  try {
    parsed = JSON.parse(json) as SchemaResponse;
  } catch (error) {
    throw new Error(
      `Could not parse the Steam schema response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return normalizeSchemaRows(parsed.game?.availableGameStats?.achievements);
}

/** Parse `GetGlobalAchievementPercentagesForApp/v2` (percent is a string). */
export function parseGlobalPercentJson(json: string): Map<string, number> {
  const map = new Map<string, number>();
  let parsed: GlobalPercentResponse;
  try {
    parsed = JSON.parse(json) as GlobalPercentResponse;
  } catch {
    return map;
  }
  const rows = parsed.achievementpercentages?.achievements;
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const name = typeof row?.name === "string" ? row.name : "";
    if (!name) continue;
    map.set(name, clampPercent(Number(row?.percent ?? 0)));
  }
  return map;
}

/** Parse `GetPlayerAchievements/v1` into unlock rows. */
export function parsePlayerAchievementsJson(json: string): SteamPlayerRow[] {
  let parsed: PlayerAchievementsResponse;
  try {
    parsed = JSON.parse(json) as PlayerAchievementsResponse;
  } catch {
    return [];
  }
  const rows = parsed.playerstats?.achievements;
  if (!Array.isArray(rows)) return [];
  const out: SteamPlayerRow[] = [];
  for (const row of rows) {
    const apiname = typeof row?.apiname === "string" ? row.apiname : "";
    if (!apiname) continue;
    out.push({
      apiname,
      achieved: Number(row?.achieved ?? 0) || 0,
      unlocktime: Math.max(0, Math.trunc(Number(row?.unlocktime ?? 0) || 0)),
    });
  }
  return out;
}

async function fetchSchemaRows(
  steamAppId: number,
  language: string,
  apiKey?: string | null,
): Promise<SteamSchemaRow[]> {
  const params: Record<string, string | number> = {
    appid: steamAppId,
    l: language || "english",
    format: "json",
  };
  if (apiKey) params.key = apiKey;
  const url = buildUrl("/ISteamUserStats/GetSchemaForGame/v2/", params);
  const response = await httpText(url, { timeoutMs: 30_000, retries: 3 });
  if (!response.ok) {
    throw new Error(`Steam schema API returned HTTP ${response.status}`);
  }
  return parseSteamSchemaJson(response.text);
}

/** Global unlock percentages (keyless). A failure means "no rarity", not an error. */
async function fetchGlobalPercents(steamAppId: number): Promise<Map<string, number>> {
  const url = buildUrl("/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/", {
    gameid: steamAppId,
    format: "json",
  });
  try {
    const response = await httpText(url, { timeoutMs: 30_000, retries: 3 });
    if (!response.ok) return new Map();
    return parseGlobalPercentJson(response.text);
  } catch (error) {
    // Log instead of swallowing — the string-as-percent mismatch bit us once
    // already; a future wire-format change should be visible.
    console.warn(
      `[achievements] could not read global percentages for appid ${steamAppId}:`,
      error instanceof Error ? error.message : error,
    );
    return new Map();
  }
}

/** Schema rows → `Achievement` list with no unlock state, rarity attached. */
function schemaToAchievements(
  rows: SteamSchemaRow[],
  percents: Map<string, number>,
): Achievement[] {
  const out: Achievement[] = [];
  for (const row of rows) {
    if (!row.name) continue;
    out.push({
      apiName: row.name,
      displayName: row.displayName || row.name,
      description:
        row.hidden === 1 && !row.description ? "Hidden achievement" : row.description,
      icon: row.icon,
      iconGray: row.icongray,
      achieved: false,
      unlockTime: 0,
      percent: percents.get(row.name) ?? 0,
    });
  }
  return out;
}

/**
 * Fetch the achievement definition list for a Steam appid without any unlock
 * state. Tries the keyed schema first (best quality), then the keyless call,
 * then the anonymous Steam Community page. Throws only when every source
 * failed; an empty list from a working source is returned as-is.
 */
export async function fetchSteamSchema(
  steamAppId: number,
  language = "english",
): Promise<Achievement[]> {
  const apiKey = storedSteamApiKey();

  if (apiKey) {
    try {
      const rows = await fetchSchemaRows(steamAppId, language, apiKey);
      if (rows.length > 0) {
        return schemaToAchievements(rows, await fetchGlobalPercents(steamAppId));
      }
    } catch (error) {
      console.warn(
        `[achievements] keyed Steam schema failed for appid ${steamAppId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  try {
    const rows = await fetchSchemaRows(steamAppId, language, null);
    if (rows.length > 0) {
      return schemaToAchievements(rows, await fetchGlobalPercents(steamAppId));
    }
  } catch {
    // The keyless schema endpoint answers HTTP 400 for most games; the
    // Community page below is the expected keyless source. Stay quiet.
  }

  return fetchSteamCommunitySchema(steamAppId, language);
}

/**
 * Parse the Steam Community achievements page (`achieveRow` blocks) into schema
 * rows. The page carries no api names, so `apiName` is derived from the icon
 * filename hash — stable across fetches, which is what the local/manual merge
 * matches against.
 */
export function parseCommunityAchievements(html: string): Achievement[] {
  const $ = cheerio.load(html);
  const out: Achievement[] = [];
  $("div.achieveRow").each((index, element) => {
    const row = $(element);
    const icon = (row.find("img").first().attr("src") ?? "").trim();
    const percentText = row.find(".achievePercent").first().text().trim();
    const percent = clampPercent(Number.parseFloat(percentText.replace(/[%\s]/g, "")));
    const displayName = row.find(".achieveTxt h3").first().text().trim();
    const description = row.find(".achieveTxt h5").first().text().trim();
    const hash = /([^/]+)\.(?:jpg|png|gif)(?:\?.*)?$/i.exec(icon);
    out.push({
      apiName: hash ? hash[1] : `ach-${index}`,
      displayName,
      description,
      icon,
      iconGray: icon,
      achieved: false,
      unlockTime: 0,
      percent,
    });
  });
  return out;
}

/** Anonymous Steam Community achievements page — no API key required. */
export async function fetchSteamCommunitySchema(
  steamAppId: number,
  language = "english",
): Promise<Achievement[]> {
  const url = `${COMMUNITY_STATS_BASE}/${steamAppId}/achievements?l=${encodeURIComponent(
    language || "english",
  )}`;
  const response = await httpText(url, { timeoutMs: 30_000, retries: 3 });
  if (!response.ok) {
    throw new Error(
      `Steam Community achievements page returned HTTP ${response.status} — the appid may not ` +
        `be public or may have no achievements.`,
    );
  }
  return parseCommunityAchievements(response.text);
}

// ── Player unlocks ────────────────────────────────────────────────────

async function fetchPlayerAchievements(
  steamAppId: number,
  steamId: string,
  apiToken: string,
): Promise<SteamPlayerRow[]> {
  const url = buildUrl("/ISteamUserStats/GetPlayerAchievements/v1/", {
    key: apiToken,
    steamid: steamId,
    appid: steamAppId,
    format: "json",
  });
  const response = await httpText(url, { timeoutMs: 30_000, retries: 3 });
  if (!response.ok) {
    throw new Error(
      `Steam player-achievements API returned HTTP ${response.status} — your profile or this ` +
        `game's details may be private.`,
    );
  }
  const rows = parsePlayerAchievementsJson(response.text);
  // Steam signals "unlock state unavailable" (private profile, restricted game
  // details) with `success: false` and an empty list. Failing loudly here keeps
  // every achievement from rendering as locked behind a "successful" sync.
  const successful = /"success"\s*:\s*(?:true|1)\b/.test(response.text);
  if (successful || rows.length > 0) return rows;
  throw new Error(
    "Steam could not return your achievement unlocks for this game — your profile or this " +
      "game's details may be private.",
  );
}

/**
 * Merge the three Steam responses into the cached payload shape.
 * Pure (the fixture tests drive this directly).
 */
export function buildSteamAchievementData(
  steamAppId: number,
  schemaRows: SteamSchemaRow[],
  playerRows: SteamPlayerRow[],
  percents: Map<string, number>,
): GameAchievementData {
  const playerMap = new Map(playerRows.map((row) => [row.apiname, row]));
  const achievements: Achievement[] = [];
  for (const row of schemaRows) {
    if (!row.name) continue;
    const player = playerMap.get(row.name);
    const achieved = player?.achieved === 1;
    achievements.push({
      apiName: row.name,
      displayName: row.displayName || row.name,
      // Hidden rows are masked only while still locked (Rust parity).
      description: row.hidden === 1 && !achieved ? "Hidden achievement" : row.description,
      icon: row.icon,
      iconGray: row.icongray,
      achieved,
      unlockTime: player?.unlocktime ?? 0,
      percent: percents.get(row.name) ?? 0,
    });
  }

  const unlocked = achievements.reduce((count, a) => count + (a.achieved ? 1 : 0), 0);
  sortAchievements(achievements);

  return {
    steamAppId,
    achievements,
    total: achievements.length,
    unlocked,
    locked: achievements.length - unlocked,
    source: "steam",
  };
}

/**
 * `fetch_achievements`: query the three Steam endpoints concurrently and merge
 * them into the same payload shape the renderer caches.
 */
export async function fetchSteamAchievements(
  steamAppId: number,
  steamId: string,
  apiToken: string,
): Promise<GameAchievementData> {
  if (!steamAppId || steamAppId <= 0) {
    throw new Error("A Steam AppID is required to fetch achievements.");
  }
  const token = apiToken?.trim();
  if (!token) {
    throw new Error(STEAM_NOT_CONFIGURED);
  }
  const id = steamId?.trim();
  if (!id) {
    throw new Error("A SteamID64 is required to fetch achievements.");
  }

  const schemaPromise = fetchSchemaRows(steamAppId, "english", token);
  const playerPromise = fetchPlayerAchievements(steamAppId, id, token);
  const percentPromise = fetchGlobalPercents(steamAppId);

  const [schemaRows, playerRows, percents] = await Promise.all([
    schemaPromise,
    playerPromise,
    percentPromise,
  ]);

  return buildSteamAchievementData(steamAppId, schemaRows, playerRows, percents);
}

/**
 * Command-level entry used by `fetch_achievements`.
 *
 * With no API key configured this serves the cached payload for that appid when
 * one exists, and otherwise throws the clear "not configured" error. Nothing is
 * fetched in either branch, so a missing key never turns into a wall of failed
 * requests.
 */
export async function steamAchievementsOrCached(
  steamAppId: number,
  steamId: string,
  apiToken: string,
): Promise<GameAchievementData> {
  if (!apiToken.trim()) {
    const cached = findCachedBySteamAppId(steamAppId);
    if (cached) return cached.data;
    throw new Error(STEAM_NOT_CONFIGURED);
  }
  return fetchSteamAchievements(steamAppId, steamId, apiToken);
}

// ── Steam Store search (manual links) ─────────────────────────────────

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter(Boolean)
    .join(" ");
}

interface StoreSearchItem {
  id?: number;
  name?: string;
}

/**
 * Rank Steam Store candidates: exact (case-insensitive) name first, then
 * name-prefix matches, then Steam's native relevance order (stable sort).
 */
export function rankSteamSearchResults(
  items: StoreSearchItem[],
  query: string,
): SteamStoreSearchResult[] {
  const wanted = normalizeForMatch(query);
  const ranked = items.map((item, index) => {
    const candidate = normalizeForMatch(String(item.name ?? ""));
    const score =
      wanted.length > 0 && candidate === wanted
        ? 0
        : wanted.length > 0 && candidate.startsWith(wanted)
          ? 1
          : 2;
    return { score, index, item };
  });
  ranked.sort((a, b) => (a.score === b.score ? a.index - b.index : a.score - b.score));

  const out: SteamStoreSearchResult[] = [];
  for (const entry of ranked) {
    const appid = Number(entry.item.id ?? 0);
    const name = String(entry.item.name ?? "");
    if (!Number.isFinite(appid) || appid <= 0 || !name) continue;
    out.push({ appid, name });
    if (out.length >= MAX_SEARCH_RESULTS) break;
  }
  return out;
}

/** `manual_search_steam`: Steam Store candidates for a manual link. */
export async function searchSteamStore(query: string): Promise<SteamStoreSearchResult[]> {
  const term = query.trim();
  if (!term) return [];
  const url = `${STORE_SEARCH_URL}?term=${encodeURIComponent(term)}&l=english&cc=us`;
  const response = await httpText(url, { timeoutMs: 20_000, retries: 2 });
  if (!response.ok) {
    throw new Error(`Steam store search returned HTTP ${response.status}`);
  }
  let parsed: { items?: StoreSearchItem[] };
  try {
    parsed = JSON.parse(response.text) as { items?: StoreSearchItem[] };
  } catch (error) {
    throw new Error(
      `Could not parse the Steam store search: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return rankSteamSearchResults(Array.isArray(parsed.items) ? parsed.items : [], term);
}
