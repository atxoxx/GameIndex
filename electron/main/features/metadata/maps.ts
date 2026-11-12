/**
 * Interactive map providers (MapGenie, GameMaps, GameMappers, Wand,
 * Game-Maps.com).
 *
 * Ported from `src-tauri/src/map_sources.rs`. Each provider's catalogue is
 * scraped once, normalized into lookup keys (title variants, acronyms,
 * subtitle handling) and cached for 24 h in memory + on disk. A game is then
 * matched locally, so opening the Map tab costs no provider request when the
 * catalogue is warm.
 */
import * as cheerio from "cheerio";

import { httpText } from "../../lib/http";
import { cacheGet, cacheSet, TTL } from "./cache";
import { collapse, decodeEntities } from "./text";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 GameIndex/2.4";

export interface MapSourceMap {
  title: string;
  url: string;
}

export interface MapSourceResult {
  id: string;
  label: string;
  title: string;
  url: string;
  maps: MapSourceMap[];
}

interface IndexedGame {
  key: string;
  title: string;
  url: string;
  maps: MapSourceMap[];
  norm: string;
  sequel: number;
  haystack: string;
}

const NOISE_WORDS = new Set([
  "enhanced", "edition", "definitive", "deluxe", "ultimate", "complete",
  "remastered", "remaster", "goty", "game", "year", "special", "gold",
  "directors", "director", "cut", "redux", "vr", "playtest", "demo",
  "prologue", "beta", "test", "server", "digital", "goodies", "classic",
  "uncut", "anniversary", "multiplayer", "single", "player", "of", "the",
  "and", "version", "full", "free", "pts", "early", "access", "remake",
  "hd", "trilogy", "public", "testing", "obsolete", "weekend", "part",
  "pt", "bundle", "collection", "anthology", "expansion", "upgrade",
  "pass", "season", "interactive", "maps", "map", "walkthrough", "guide",
]);

const PUBLISHER_PREFIXES = [
  "tom clancy's ", "tom clancys ", "sid meier's ", "sid meiers ",
  "disney's ", "disneys ", "marvel's ", "marvels ",
  "warhammer 40,000: ", "warhammer 40000: ", "warhammer 40k: ",
  "warhammer: ", "middle-earth: ", "middle earth: ",
  "shin megami tensei: ", "ea sports ", "clancy's ", "clancys ",
];

const ROMAN: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7",
  viii: "8", ix: "9", x: "10", xi: "11", xii: "12", xiii: "13", xiv: "14",
  xv: "15", xvi: "16", xvii: "17", xviii: "18", xix: "19", xx: "20",
};

const WORD_NUMBERS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};

const ALIASES: Record<string, string[]> = {
  grandtheftautov: ["gtav", "gta5"],
  grandtheftauto5: ["gtav", "gta5"],
  gtav: ["grandtheftautov", "grandtheftauto5"],
  gta5: ["grandtheftautov", "grandtheftauto5"],
  reddeadredemption2: ["rdr2"],
  rdr2: ["reddeadredemption2"],
  cyberpunk2077: ["cp2077"],
  cp2077: ["cyberpunk2077"],
  baldursgate3: ["bg3"],
  bg3: ["baldursgate3"],
  counterstrike2: ["cs2"],
  cs2: ["counterstrike2"],
  counterstrikeglobaloffensive: ["csgo"],
  csgo: ["counterstrikeglobaloffensive"],
  kingdomcomedeliverance: ["kcd"],
  kcd: ["kingdomcomedeliverance"],
  kingdomcomedeliverance2: ["kcd2"],
  kcd2: ["kingdomcomedeliverance2"],
  theelderscrollsvskyrim: ["skyrim", "tes5", "tesv"],
  elderscrollsvskyrim: ["skyrim", "tes5", "tesv"],
  elderscrolls5skyrim: ["skyrim", "tes5", "tesv"],
  skyrim: ["theelderscrollsvskyrim", "elderscrolls5skyrim"],
  theelderscrollsonline: ["eso"],
  elderscrollsonline: ["eso"],
  eso: ["theelderscrollsonline"],
  starwarsjedifallenorder: ["swjfo", "jedifallenorder", "fallenorder"],
  swjfo: ["starwarsjedifallenorder"],
  dragonageinquisition: ["dai"],
  dai: ["dragonageinquisition"],
  dragonagetheveilguard: ["dav", "veilguard"],
  dragonageveilguard: ["dav", "veilguard"],
  dav: ["dragonagetheveilguard"],
  left4dead2: ["l4d2"],
  leftfordead2: ["l4d2"],
  l4d2: ["left4dead2"],
  left4dead: ["l4d"],
  leftfordead: ["l4d"],
  l4d: ["left4dead"],
  teamfortress2: ["tf2"],
  tf2: ["teamfortress2"],
  fallout4: ["fo4"],
  fo4: ["fallout4"],
  fallout76: ["fo76"],
  fo76: ["fallout76"],
  hogwartslegacy: ["hl"],
  hl: ["hogwartslegacy"],
  residentevil4: ["re4"],
  re4: ["residentevil4"],
};

export function normalizeMapName(input: string): string {
  return input
    .replace(/['\u2019\u2018]s\b/gi, "s")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function stripParentheses(input: string): string {
  return input.replace(/\([^)]*\)/g, " ");
}

function beforeDash(input: string): string {
  for (const separator of [" - ", " \u2013 ", " \u2014 "]) {
    const index = input.indexOf(separator);
    if (index >= 0) return input.slice(0, index);
  }
  return input;
}

function afterDash(input: string): string | null {
  for (const separator of [" - ", " \u2013 ", " \u2014 "]) {
    const index = input.indexOf(separator);
    if (index >= 0) {
      const suffix = input.slice(index + separator.length).trim();
      if (suffix.length >= 3) return suffix;
    }
  }
  return null;
}

function beforeColon(input: string): string {
  const index = input.indexOf(":");
  if (index >= 0) {
    const prefix = input.slice(0, index).trim();
    if (prefix) return prefix;
  }
  return input;
}

function afterColon(input: string): string | null {
  const index = input.indexOf(":");
  if (index >= 0) {
    const suffix = input.slice(index + 1).trim();
    if (suffix.length >= 3) return suffix;
  }
  return null;
}

function stripPublisherPrefix(input: string): string {
  const lower = input.toLowerCase();
  for (const prefix of PUBLISHER_PREFIXES) {
    if (lower.startsWith(prefix)) return input.slice(prefix.length);
  }
  return input;
}

function tokenNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  if (ROMAN[token]) return Number.parseInt(ROMAN[token], 10);
  if (WORD_NUMBERS[token]) return Number.parseInt(WORD_NUMBERS[token], 10);
  return null;
}

function maxNumber(input: string): number {
  let max = 0;
  for (const token of input.toLowerCase().split(/[^a-z0-9]+/)) {
    const value = token ? tokenNumber(token) : null;
    if (value !== null && value > max) max = value;
  }
  return max;
}

function stripTrailingNumber(input: string): string | null {
  const tokens = input.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1].toLowerCase();
  if (tokenNumber(last) === null) return null;
  return tokens.slice(0, -1).join(" ");
}

function significantTokens(input: string): string {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => ROMAN[token] ?? WORD_NUMBERS[token] ?? token)
    .filter((token) => !NOISE_WORDS.has(token))
    .join("");
}

function distinctSubtitle(input: string): string | null {
  const subtitle = afterColon(input) ?? afterDash(input);
  if (!subtitle) return null;
  const significant = significantTokens(stripParentheses(subtitle));
  return significant || null;
}

function pushKey(out: string[], key: string): void {
  if (key.length >= 3 && !out.includes(key)) out.push(key);
}

function pushAlias(out: string[], key: string): void {
  if (key && !out.includes(key)) out.push(key);
}

/** Every comparable key for a name, most specific first. */
export function mapNameVariants(name: string): string[] {
  const cleaned = decodeEntities(name).replace(/[\u2122\u00ae\u00a9]/g, "");
  const out: string[] = [];
  const norm = normalizeMapName(cleaned);
  pushKey(out, norm);
  pushKey(out, normalizeMapName(cleaned.replace(/&/g, " and ")));
  for (const alias of ALIASES[norm] ?? []) pushAlias(out, alias);

  const noParen = stripParentheses(cleaned);
  pushKey(out, normalizeMapName(noParen));
  const noDash = beforeDash(noParen);
  pushKey(out, normalizeMapName(noDash));

  const subDash = afterDash(noParen);
  if (subDash) {
    const sub = stripParentheses(subDash);
    pushKey(out, normalizeMapName(sub));
    pushKey(out, significantTokens(sub));
  }

  const noColon = beforeColon(noParen);
  pushKey(out, normalizeMapName(noColon));

  const subColon = afterColon(noParen);
  if (subColon) {
    const sub = stripParentheses(subColon);
    pushKey(out, normalizeMapName(sub));
    pushKey(out, significantTokens(sub));
  }

  const noPublisher = stripPublisherPrefix(noDash);
  pushKey(out, normalizeMapName(noPublisher));
  const noPublisherColon = stripPublisherPrefix(noColon);
  pushKey(out, normalizeMapName(noPublisherColon));

  for (const base of [noDash, noPublisher, noColon, noPublisherColon]) {
    pushKey(out, significantTokens(base));
  }
  for (const base of [noDash, noColon]) {
    const bare = stripTrailingNumber(base);
    if (bare) {
      pushKey(out, normalizeMapName(bare));
      pushKey(out, significantTokens(bare));
    }
  }
  return out;
}

function singleMap(title: string, url: string): MapSourceMap[] {
  return [{ title, url }];
}

function pushVariants(
  out: IndexedGame[],
  seen: Set<string>,
  names: string[],
  title: string,
  url: string,
  maps: MapSourceMap[],
): void {
  const norm = normalizeMapName(title);
  const sequel = maxNumber(title);
  const haystack = names.map(significantTokens).join("");
  for (const name of names) {
    for (const key of mapNameVariants(name)) {
      const dedupe = `${key}\u0000${url}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ key, title, url, maps, norm, sequel, haystack });
    }
  }
}

function isBetterCandidate(candidate: IndexedGame, current: IndexedGame, key: string): boolean {
  const candidateExact = candidate.norm === key;
  const currentExact = current.norm === key;
  if (candidateExact !== currentExact) return candidateExact;
  return candidate.sequel > current.sequel;
}

function toResult(
  id: string,
  label: string,
  index: IndexedGame[],
  gameName: string,
): MapSourceResult | null {
  const query = mapNameVariants(gameName);
  const subtitle = distinctSubtitle(gameName);
  for (const key of query) {
    let best: IndexedGame | null = null;
    for (const game of index) {
      if (game.key !== key) continue;
      if (subtitle && !game.haystack.includes(subtitle)) continue;
      if (!best || isBetterCandidate(game, best, key)) best = game;
    }
    if (best) {
      return { id, label, title: best.title, url: best.url, maps: best.maps };
    }
  }
  return null;
}

// ── Providers ──────────────────────────────────────────────────────────

interface MapGenieGame {
  title?: string;
  slug?: string;
  ign_slug?: string;
  domain?: string;
  home_title?: string;
  search_titles?: string[];
  maps?: { title?: string; slug?: string; enabled?: boolean; available?: boolean }[];
}

function parseMapGenie(body: string): IndexedGame[] {
  let games: MapGenieGame[] = [];
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) games = parsed as MapGenieGame[];
  } catch {
    return [];
  }
  const out: IndexedGame[] = [];
  const seen = new Set<string>();
  const parsed = games
    .filter((game) => game.slug && game.title)
    .map((game) => {
      const maps = (game.maps ?? [])
        .filter((map) => map.enabled && map.available && map.slug)
        .map((map) => ({
          title: map.title?.trim() || game.title || "",
          url: `https://mapgenie.io/${game.slug}/maps/${map.slug}`,
        }));
      return {
        title: game.title as string,
        alternatives: [
          ...(game.search_titles ?? []),
          ...(game.ign_slug ? [game.ign_slug.replace(/-/g, " ")] : []),
          game.slug?.replace(/-/g, " ") ?? "",
          ...(game.home_title ? [game.home_title] : []),
        ].filter(Boolean),
        maps: maps.length ? maps : singleMap(game.title as string, `https://mapgenie.io/${game.slug}`),
      };
    });
  for (const entry of parsed) {
    pushVariants(out, seen, [entry.title], entry.title, entry.maps[0].url, entry.maps);
  }
  for (const entry of parsed) {
    pushVariants(out, seen, entry.alternatives, entry.title, entry.maps[0].url, entry.maps);
  }
  return out;
}

function parseGameMapsHome(html: string): IndexedGame[] {
  const out: IndexedGame[] = [];
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const match of html.matchAll(/href="\/game\/([a-z0-9_]+)"[\s\S]{0,600}?alt="([^"]+)"/g)) {
    const slug = match[1];
    const title = decodeEntities(match[2]);
    const display = title.trim() || slug.replace(/_/g, " ");
    const url = `https://www.gamemaps.net/game/${slug}`;
    pushVariants(out, seen, [display, slug.replace(/_/g, " ")], display, url, singleMap(display, url));
    covered.add(slug);
  }
  for (const match of html.matchAll(/href="\/game\/([a-z0-9_]+)"/g)) {
    const slug = match[1];
    if (covered.has(slug)) continue;
    const display = slug.replace(/_/g, " ");
    const url = `https://www.gamemaps.net/game/${slug}`;
    pushVariants(out, seen, [display], display, url, singleMap(display, url));
  }
  return out;
}

function stripMapSuffix(slug: string): string | null {
  const trimmed = slug.replace(/^\/+|\/+$/g, "");
  for (const suffix of ["-interactive-maps", "-interactive-map", "-maps", "-map"]) {
    if (trimmed.endsWith(suffix)) {
      const rest = trimmed.slice(0, -suffix.length);
      if (rest) return rest;
    }
  }
  return null;
}

function isGuidePost(segment: string): boolean {
  const value = segment.toLowerCase();
  return (
    value === "latest" ||
    value === "latest-maps" ||
    value === "all-maps" ||
    value === "contact" ||
    value === "about" ||
    value === "privacy" ||
    value.startsWith("all-") ||
    value.startsWith("where-to-") ||
    value.startsWith("how-to-") ||
    value.includes("-locations-in-") ||
    value.includes("-guide")
  );
}

function parseGameMappersSitemap(xml: string): IndexedGame[] {
  const out: IndexedGame[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const url = match[1];
    const segment = url.replace(/\/+$/, "").split("/").pop() ?? "";
    if (isGuidePost(segment)) continue;
    const slug = stripMapSuffix(segment);
    if (!slug) continue;
    const title = slug.replace(/-/g, " ");
    const titles = [title];
    for (const edition of [
      "-scholarship-edition",
      "-complete-edition",
      "-definitive-edition",
      "-enhanced-edition",
    ]) {
      if (slug.endsWith(edition)) titles.push(slug.slice(0, -edition.length).replace(/-/g, " "));
    }
    pushVariants(out, seen, titles, title, url, singleMap(title, url));
  }
  return out;
}

function parseWandMaps(html: string): IndexedGame[] {
  const $ = cheerio.load(html);
  const out: IndexedGame[] = [];
  const seen = new Set<string>();
  $("a[href^='/maps/']").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const slug = href.match(/^\/maps\/([a-z0-9-]+)$/)?.[1];
    if (!slug) return;
    const title = collapse($(element).find("h4").first().text()) || slug.replace(/-/g, " ");
    const url = `https://wand.com/maps/${slug}`;
    pushVariants(out, seen, [title, slug.replace(/-/g, " ")], title, url, singleMap(title, url));
  });
  return out;
}

function parseWandSubmaps(html: string, baseUrl: string): MapSourceMap[] {
  const $ = cheerio.load(html);
  const base = baseUrl.replace(/\/+$/, "");
  const out: MapSourceMap[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const match = href.match(/^(?:\/[a-z]{2})?\/maps\/[a-z0-9-]+\/([a-z0-9-]+)/);
    if (!match || seen.has(match[1])) return;
    seen.add(match[1]);
    const title = collapse($(element).text()) || match[1].replace(/-/g, " ");
    out.push({ title, url: `${base}/${match[1]}` });
  });
  return out;
}

function cleanGamemapsComTitle(text: string): string | null {
  const value = text.trim();
  if (!value || value.length > 100) return null;
  if (value.startsWith("All ")) {
    const rest = value.slice(4).trim();
    const name = rest.replace(/ Maps?$/, "").trim();
    if (name && name.toLowerCase() !== "game") return name;
  }
  const suffixes = [
    " - Maps & Walkthrough", " - Maps and Walkthrough", " - Full Walkthrough & Maps",
    " - Walkthrough, Guide & Maps", " - Maps and Guide", " - Maps & Guide",
    " - Maps & Game Guide", " - Revealed Maps & Walkthrough", " - Revealed Maps",
    " - Maps with Walkthrough", " - Game Guide & Maps", " - Walkthrough", " - Guide",
    " - Maps", " - Map", " Revealed Maps 2026", " Revealed Maps", " World Map",
    " Castle Map", " Maps", " Map",
  ];
  for (const suffix of suffixes) {
    if (value.endsWith(suffix)) {
      const candidate = value.slice(0, -suffix.length).trim();
      if (
        candidate.length >= 2 &&
        !["all", "world", "castle", "delve", "public dungeon", "quest", "npc", "video", "game", "latest", "toss a coin"].includes(
          candidate.toLowerCase(),
        )
      ) {
        return candidate;
      }
    }
  }
  for (const separator of [" - ", " \u2013 ", " \u2014 "]) {
    const index = value.indexOf(separator);
    if (index > 0) {
      const name = value.slice(0, index).trim();
      if (name && name.length <= 80 && name.toLowerCase() !== "all") return name;
    }
  }
  return null;
}

function parseGamemapsComHome(html: string): IndexedGame[] {
  const $ = cheerio.load(html);
  const out: IndexedGame[] = [];
  const seen = new Set<string>();
  const add = (title: string | null, url: string) => {
    if (!title || ["donate", "contact"].includes(title.toLowerCase())) return;
    pushVariants(out, seen, [title], title, url, singleMap(title, url));
  };
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const match = href.match(/(?:https:\/\/game-maps\.com)?\/([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.asp)/);
    if (!match) return;
    const url = `https://game-maps.com/${match[1]}`;
    const titleAttr = $(element).attr("title");
    add(titleAttr ? cleanGamemapsComTitle(decodeEntities(titleAttr)) : null, url);
    add(cleanGamemapsComTitle(decodeEntities($(element).text())), url);
  });
  $("img[alt]").each((_index, element) => {
    const alt = $(element).attr("alt") ?? "";
    const next = $(element).parent().find("a[href]").first().attr("href") ?? "";
    const match = next.match(/(?:https:\/\/game-maps\.com)?\/([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.asp)/);
    if (!match) return;
    add(cleanGamemapsComTitle(decodeEntities(alt)), `https://game-maps.com/${match[1]}`);
  });
  return out;
}

// ── Fetch / cache ──────────────────────────────────────────────────────

interface Provider {
  id: string;
  label: string;
  url: string;
  referer: string;
  parse: (body: string) => IndexedGame[];
  subMaps?: (body: string, base: string) => MapSourceMap[];
}

const PROVIDERS: Provider[] = [
  {
    id: "mapgenie",
    label: "MapGenie",
    url: "https://mapgenie.io/api/v1/games",
    referer: "https://mapgenie.io/",
    parse: parseMapGenie,
  },
  {
    id: "gamemaps",
    label: "GameMaps",
    url: "https://www.gamemaps.net/",
    referer: "https://www.gamemaps.net/",
    parse: parseGameMapsHome,
  },
  {
    id: "gamemappers",
    label: "GameMappers",
    url: "https://gamemappers.com/post-sitemap.xml",
    referer: "https://gamemappers.com/",
    parse: parseGameMappersSitemap,
  },
  {
    id: "wand",
    label: "Wand",
    url: "https://wand.com/en/maps",
    referer: "https://wand.com/",
    parse: parseWandMaps,
    subMaps: parseWandSubmaps,
  },
  {
    id: "gamemapscom",
    label: "Game-Maps",
    url: "https://game-maps.com/",
    referer: "https://game-maps.com/",
    parse: parseGamemapsComHome,
  },
];

const inflight = new Map<string, Promise<IndexedGame[]>>();

async function loadIndex(provider: Provider): Promise<IndexedGame[]> {
  const memoryKey = `index:${provider.id}`;
  const hit = cacheGet<IndexedGame[]>("maps", memoryKey, TTL.mapIndex);
  if (hit) return hit;
  const pending = inflight.get(provider.id);
  if (pending) return pending;

  const promise = (async () => {
    const response = await httpText(provider.url, {
      headers: {
        "user-agent": USER_AGENT,
        Accept: "application/json, text/html;q=0.9, */*;q=0.8",
        Referer: provider.referer,
      },
      timeoutMs: 25_000,
      retries: 1,
    });
    if (!response.ok) {
      throw new Error(`${provider.label} returned HTTP ${response.status}.`);
    }
    const index = provider.parse(response.text);
    if (index.length === 0) {
      throw new Error(`${provider.label} returned no game entries (layout may have changed).`);
    }
    cacheSet("maps", memoryKey, index);
    return index;
  })().finally(() => inflight.delete(provider.id));

  inflight.set(provider.id, promise);
  return promise;
}

async function loadWandSubMaps(result: MapSourceResult): Promise<MapSourceResult> {
  const provider = PROVIDERS.find((entry) => entry.id === "wand");
  if (!provider?.subMaps) return result;
  const key = `submaps:${result.url}`;
  const cachedMaps = cacheGet<MapSourceMap[]>("maps", key, TTL.mapIndex);
  if (cachedMaps) {
    if (cachedMaps.length > 1) result.maps = cachedMaps;
    return result;
  }
  try {
    const response = await httpText(result.url, {
      headers: { "user-agent": USER_AGENT, Referer: "https://wand.com/" },
      timeoutMs: 6_000,
      retries: 0,
    });
    if (!response.ok) return result;
    const maps = provider.subMaps(response.text, result.url);
    cacheSet("maps", key, maps);
    if (maps.length > 1) result.maps = maps;
  } catch {
    /* keep the game-level map */
  }
  return result;
}

/** Resolve every provider that hosts a map for `gameName`. */
export async function fetchGameMaps(gameName: string): Promise<MapSourceResult[]> {
  if (!normalizeMapName(gameName)) return [];
  const results = await Promise.all(
    PROVIDERS.map(async (provider) => {
      try {
        const index = await loadIndex(provider);
        const result = toResult(provider.id, provider.label, index, gameName);
        if (!result) return null;
        return provider.id === "wand" ? await loadWandSubMaps(result) : result;
      } catch (error) {
        console.warn(`[metadata] map provider ${provider.id} failed:`, error);
        return null;
      }
    }),
  );
  return results.filter((result): result is MapSourceResult => Boolean(result));
}

/** Autocomplete from the catalogues already on disk (never touches network). */
export async function searchMapGames(query: string, limit = 8): Promise<string[]> {
  const needle = normalizeMapName(query);
  if (needle.length < 2) return [];
  const capped = Math.min(Math.max(1, limit), 25);
  const seen = new Set<string>();
  const ranked: { priority: number; length: number; title: string }[] = [];
  for (const provider of PROVIDERS) {
    const index = cacheGet<IndexedGame[]>("maps", `index:${provider.id}`, TTL.mapIndex);
    if (!index) continue;
    for (const game of index) {
      if (!game.norm.includes(needle) || seen.has(game.title)) continue;
      seen.add(game.title);
      ranked.push({
        priority: game.norm.startsWith(needle) ? 0 : 1,
        length: game.norm.length,
        title: game.title,
      });
    }
  }
  ranked.sort((a, b) => a.priority - b.priority || a.length - b.length || a.title.localeCompare(b.title));
  return ranked.slice(0, capped).map((entry) => entry.title);
}

/** Exported for the harness: parse fixtures without network. */
export const mapParsers = {
  mapgenie: parseMapGenie,
  gamemaps: parseGameMapsHome,
  gamemappers: parseGameMappersSitemap,
  wand: parseWandMaps,
  gamemapscom: parseGamemapsComHome,
  result: toResult,
};
