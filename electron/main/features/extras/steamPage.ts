/**
 * Steam store-page extras: the feature sidebar, `pc_requirements`, and the
 * localized "About this game" bundle.
 *
 * Ported from `src-tauri/src/game_scraper/steam_about.rs` (requirements
 * parser, feature scraper, about bundle) and the command wrappers in
 * `src-tauri/src/store.rs`.
 *
 * Everything is keyless. Requests use `lib/http.ts`; parsed payloads are
 * cached on disk (`extras-cache.json`) and stale copies are served when Steam
 * is unreachable so a store page does not lose its content on a hiccup.
 */
import * as cheerio from "cheerio";

import { httpJson, httpText } from "../../lib/http";
import { cacheLookup, cacheStore, EXTRA_TTL } from "./cache";

const STORE_API = "https://store.steampowered.com/api";

// ── Shared helpers ─────────────────────────────────────────────────────

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function stripTags(html: string): string {
  return collapse(decodeEntities(html.replace(/<[^>]*>/g, " ")));
}

function positiveInt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

// ── Store page features ────────────────────────────────────────────────

export interface SteamFeatureItem {
  id?: number;
  name: string;
  iconUrl?: string;
  searchUrl?: string;
}

export interface SteamControllerSupport {
  fullSupport: boolean;
  partialSupport: boolean;
  gamepadPreferred: boolean;
  xbox: boolean;
  ps4: boolean;
  ps5: boolean;
}

export interface SteamNoticeItem {
  text: string;
  linkUrl?: string;
  linkText?: string;
  isAnticheat: boolean;
}

export interface SteamStoreFeaturesPayload {
  appId: number;
  features: SteamFeatureItem[];
  controllerSupport?: SteamControllerSupport;
  notices: SteamNoticeItem[];
  fetchedAt: number;
}

export function normalizeSteamLang(lang: string | null | undefined): string {
  const lower = (lang ?? "").trim().toLowerCase();
  switch (lower) {
    case "fr":
    case "french":
      return "french";
    case "de":
    case "german":
      return "german";
    case "es":
    case "spanish":
      return "spanish";
    case "ru":
    case "russian":
      return "russian";
    case "zh":
    case "zh-cn":
    case "schinese":
    case "simplified chinese":
      return "schinese";
    default:
      return "english";
  }
}

function defaultCategoryIcon(id: number | undefined): string | undefined {
  if (id === undefined) return undefined;
  const base = "https://store.akamai.steamstatic.com/public/images/v6/ico";
  const table: Record<number, string> = {
    2: "ico_singlePlayer.png",
    1: "ico_multiPlayer.png",
    36: "ico_multiPlayer.png",
    37: "ico_multiPlayer.png",
    49: "ico_multiPlayer.png",
    9: "ico_coop.png",
    38: "ico_coop.png",
    39: "ico_coop.png",
    48: "ico_coop.png",
    22: "ico_achievements.png",
    23: "ico_cloud.png",
    29: "ico_cards.png",
    30: "ico_workshop.png",
    51: "ico_workshop.png",
    17: "ico_editor.png",
    62: "ico_familysharing.png",
    41: "ico_remote_play.png",
    42: "ico_remote_play.png",
    43: "ico_remote_play.png",
    44: "ico_remote_play_together.png",
    61: "ico_hdr.png",
    35: "ico_cart.png",
    18: "ico_controller.png",
    28: "ico_controller.png",
    40: "ico_vr.png",
    53: "ico_vr.png",
    54: "ico_vr.png",
  };
  const file = table[id] ?? "ico_singlePlayer.png";
  return `${base}/${file}`;
}

function normalizeImage(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `https://store.akamai.steamstatic.com${value}`;
  return value;
}

interface ControllerProps {
  bFullXboxControllerSupport?: boolean;
  bPartialXboxControllerSupport?: boolean;
  bPS4ControllerSupport?: boolean;
  bPS5ControllerSupport?: boolean;
  bGamepadPreferred?: boolean;
}

function parseControllerProps(raw: string): SteamControllerSupport | undefined {
  try {
    const parsed = JSON.parse(decodeEntities(raw)) as ControllerProps;
    const full = Boolean(parsed.bFullXboxControllerSupport);
    const partial = Boolean(parsed.bPartialXboxControllerSupport);
    const ps4 = Boolean(parsed.bPS4ControllerSupport);
    const ps5 = Boolean(parsed.bPS5ControllerSupport);
    if (!full && !partial && !ps4 && !ps5) return undefined;
    return {
      fullSupport: full,
      partialSupport: partial,
      gamepadPreferred: Boolean(parsed.bGamepadPreferred),
      xbox: full || partial,
      ps4,
      ps5,
    };
  } catch {
    return undefined;
  }
}

interface AppDetailsCategory {
  id?: number;
  description?: string;
}

interface AppDetailsPayload {
  success?: boolean;
  data?: {
    categories?: AppDetailsCategory[];
    controller_support?: string;
  };
}

/** Pure parser, exported for the fixture harness. */
export function parseSteamFeaturesHtml(
  html: string,
  appId: number,
): SteamStoreFeaturesPayload | null {
  const $ = cheerio.load(html);
  const block = $("#category_block, .responsive_apppage_details_left").first();
  const features: SteamFeatureItem[] = [];
  const notices: SteamNoticeItem[] = [];
  let controllerSupport: SteamControllerSupport | undefined;

  if (block.length > 0) {
    block.find("a.game_area_details_specs_ctn").each((_index, element) => {
      const anchor = $(element);
      const href = anchor.attr("href")?.trim() ?? "";
      const idMatch = /category2=(\d+)/.exec(href);
      const id = idMatch ? Number.parseInt(idMatch[1], 10) : undefined;
      const name = collapse(anchor.find("div.label").first().text()) || stripTags(anchor.html() ?? "");
      if (!name) return;
      if (features.some((feature) => feature.name.toLowerCase() === name.toLowerCase())) return;
      const iconUrl =
        normalizeImage(anchor.find("img").first().attr("src")) ?? defaultCategoryIcon(id);
      features.push({
        id: Number.isFinite(id) ? id : undefined,
        name,
        iconUrl,
        searchUrl: idMatch ? `https://store.steampowered.com/search/?category2=${idMatch[1]}` : undefined,
      });
    });

    controllerSupport = parseControllerProps(
      block
        .find('[data-featuretarget="store-sidebar-controller-support-info"]')
        .first()
        .attr("data-props") ?? "",
    );

    block.find(".DRM_notice").each((_index, element) => {
      const notice = $(element);
      const text = stripTags(notice.html() ?? "");
      if (!text) return;
      if (notices.some((entry) => entry.text === text)) return;
      const link = notice.find("a").first();
      const lower = text.toLowerCase();
      notices.push({
        text,
        linkUrl: link.attr("href")?.trim() || undefined,
        linkText: collapse(link.text()) || undefined,
        isAnticheat:
          lower.includes("anti-cheat") ||
          lower.includes("anticheat") ||
          lower.includes("battleye") ||
          lower.includes("easy anti-cheat"),
      });
    });
  }

  if (features.length === 0 && !controllerSupport && notices.length === 0) return null;

  return {
    appId,
    features,
    controllerSupport,
    notices,
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

async function fetchFeaturesFromApi(appId: number, lang: string): Promise<SteamStoreFeaturesPayload | null> {
  const payload = await httpJson<Record<string, AppDetailsPayload>>(
    `${STORE_API}/appdetails?appids=${appId}&cc=us&l=${encodeURIComponent(lang)}`,
    { timeoutMs: 15_000, retries: 1 },
  );
  const wrapper = payload[String(appId)];
  if (!wrapper?.success || !wrapper.data) return null;
  const features: SteamFeatureItem[] = [];
  for (const category of wrapper.data.categories ?? []) {
    const name = category.description?.trim();
    if (!name) continue;
    features.push({
      id: category.id,
      name,
      iconUrl: defaultCategoryIcon(category.id),
      searchUrl: category.id
        ? `https://store.steampowered.com/search/?category2=${category.id}`
        : undefined,
    });
  }
  let controllerSupport: SteamControllerSupport | undefined;
  const controller = wrapper.data.controller_support?.toLowerCase();
  if (controller === "full" || controller === "partial") {
    const full = controller === "full";
    controllerSupport = {
      fullSupport: full,
      partialSupport: !full,
      gamepadPreferred: false,
      xbox: true,
      ps4: full,
      ps5: full,
    };
  }
  if (features.length === 0 && !controllerSupport) return null;
  return {
    appId,
    features,
    controllerSupport,
    notices: [],
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

/** `get_steam_page_features` — `null` when the title has no store page. */
export async function getSteamPageFeatures(
  rawAppId: unknown,
  lang: unknown,
): Promise<SteamStoreFeaturesPayload | null> {
  const appId = positiveInt(rawAppId);
  if (!appId) return null;
  const language = normalizeSteamLang(typeof lang === "string" ? lang : "english");
  const key = `steam-features:${appId}:${language}`;

  const hit = cacheLookup<SteamStoreFeaturesPayload | null>(key);
  if (hit && Date.now() - hit.at < EXTRA_TTL.steamFeatures) return hit.value;

  try {
    const url = `https://store.steampowered.com/app/${appId}/?l=${encodeURIComponent(language)}`;
    const response = await httpText(url, {
      timeoutMs: 20_000,
      retries: 1,
      headers: {
        cookie: `birthtime=283993201; mature_content=1; wants_mature_content=1; Steam_Language=${language}`,
      },
    });
    let payload = response.ok ? parseSteamFeaturesHtml(response.text, appId) : null;
    if (!payload) payload = await fetchFeaturesFromApi(appId, language);
    if (payload) cacheStore(key, payload);
    return payload ?? (hit?.value ?? null);
  } catch {
    return hit?.value ?? null;
  }
}

// ── System requirements ────────────────────────────────────────────────

export interface RequirementsSpec {
  os?: string;
  processor?: string;
  memory?: string;
  graphics?: string;
  directX?: string;
  network?: string;
  storage?: string;
  soundCard?: string;
  vrSupport?: string;
  additionalNotes?: string;
}

export interface PcRequirementsPayload {
  source: string;
  sourceUrl?: string;
  sourceName?: string;
  minimum?: RequirementsSpec;
  recommended?: RequirementsSpec;
  minimumHtml?: string;
  recommendedHtml?: string;
  fetchedAt: number;
}

/**
 * Convert Steam's shallow `pc_requirements` HTML into one label/value per
 * line. Mirrors `requirements_html_to_text` in the Rust scraper.
 */
export function requirementsHtmlToText(html: string): string {
  if (!html) return "";
  let out = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:li|p|div)>/gi, "\n")
    .replace(/<\/(?:ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n")
    .replace(/<\/(?:strong|b|em|span|font)>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  out = decodeEntities(out);
  const lines: string[] = [];
  for (const rawLine of out.split("\n")) {
    const line = collapse(rawLine);
    if (line) lines.push(line);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

const REQUIREMENT_LABELS: Array<[keyof RequirementsSpec, string]> = [
  ["os", "os"],
  ["processor", "processor"],
  ["memory", "memory"],
  ["graphics", "graphics"],
  ["directX", "directx"],
  ["network", "network"],
  ["storage", "storage"],
  ["soundCard", "sound card"],
  ["vrSupport", "vr support"],
  ["vrSupport", "vr headset"],
  ["additionalNotes", "additional notes"],
  ["additionalNotes", "notes"],
];

/** Pure line parser; longer values win when a label repeats. */
export function parseRequirementsText(text: string): RequirementsSpec {
  const spec: RequirementsSpec = {};
  for (const rawLine of text.toLowerCase().split(/\r?\n/)) {
    const line = rawLine.trimStart();
    for (const [field, label] of REQUIREMENT_LABELS) {
      if (line.length <= label.length || !line.startsWith(label)) continue;
      const rest = line[label.length];
      if (rest !== ":" && !/\s/.test(rest)) continue;
      const value = line
        .slice(label.length)
        .replace(/^[:\s]+/, "")
        .trim();
      if (!value) break;
      const existing = spec[field];
      if (!existing || existing.length < value.length) spec[field] = value;
      break;
    }
  }
  return spec;
}

export function parseRequirementsHtml(html: string | undefined): RequirementsSpec | undefined {
  if (!html) return undefined;
  const spec = parseRequirementsText(requirementsHtmlToText(html));
  return Object.keys(spec).length > 0 ? spec : undefined;
}

interface RawRequirements {
  minimum?: string;
  recommended?: string;
}

interface RequirementsAppDetails {
  pc_requirements?: RawRequirements;
  mac_requirements?: RawRequirements;
  linux_requirements?: RawRequirements;
}

/** `get_recommended_config` — Steam `pc_requirements`, or `null` on no appid/failure. */
export async function getRecommendedConfig(rawAppId: unknown): Promise<PcRequirementsPayload | null> {
  const appId = positiveInt(rawAppId);
  if (!appId) return null;
  const key = `steam-requirements:${appId}`;
  const hit = cacheLookup<PcRequirementsPayload | null>(key);
  if (hit && Date.now() - hit.at < EXTRA_TTL.steamRequirements) return hit.value;

  try {
    const payload = await httpJson<Record<string, { success?: boolean; data?: RequirementsAppDetails }>>(
      `${STORE_API}/appdetails?appids=${appId}&cc=us&l=en`,
      { timeoutMs: 20_000, retries: 1 },
    );
    const wrapper = payload[String(appId)];
    if (!wrapper?.success || !wrapper.data) return hit?.value ?? null;
    const block =
      wrapper.data.pc_requirements ??
      wrapper.data.mac_requirements ??
      wrapper.data.linux_requirements;
    const minimumHtml = block?.minimum;
    const recommendedHtml = block?.recommended;
    const result: PcRequirementsPayload = {
      source: "steam",
      sourceUrl: `https://store.steampowered.com/app/${appId}`,
      sourceName: "Steam",
      minimum: parseRequirementsHtml(minimumHtml),
      recommended: parseRequirementsHtml(recommendedHtml),
      minimumHtml,
      recommendedHtml,
      fetchedAt: Math.floor(Date.now() / 1000),
    };
    // Never cache an empty spec: a title that publishes requirements tomorrow
    // should be picked up on the next visit.
    if (result.minimum || result.recommended) cacheStore(key, result);
    return result;
  } catch {
    return hit?.value ?? null;
  }
}

// ── About bundle ───────────────────────────────────────────────────────

export interface MovieEntry {
  id: number;
  name?: string;
  thumbnail?: string;
  webm?: string;
  mp4?: string;
  hlsH264?: string;
  highlight: boolean;
}

export interface RichAboutPayload {
  source: string;
  sourceUrl?: string;
  sourceName?: string;
  aboutHtml?: string;
  aboutText?: string;
  shortDescription?: string;
  releaseDate?: string;
  movies: MovieEntry[];
  fetchedAt: number;
}

export interface AboutBundle {
  byLanguage: Record<string, RichAboutPayload>;
  defaultLanguage: string;
}

export const ABOUT_LANGUAGES = [
  "english",
  "french",
  "spanish",
  "german",
  "russian",
  "schinese",
] as const;

interface RawMovie {
  id?: number;
  name?: string;
  thumbnail?: string;
  webm?: { max?: string; 480?: string };
  mp4?: { max?: string; 480?: string; full?: string };
  hls_h264?: string;
  highlight?: boolean;
}

interface AboutAppDetails {
  about_the_game?: string;
  short_description?: string;
  release_date?: { date?: string };
  movies?: RawMovie[];
}

async function fetchAboutForLanguage(appId: number, language: string): Promise<RichAboutPayload | null> {
  try {
    const payload = await httpJson<Record<string, { success?: boolean; data?: AboutAppDetails }>>(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=${encodeURIComponent(language)}`,
      { timeoutMs: 20_000, retries: 1 },
    );
    const wrapper = payload[String(appId)];
    if (!wrapper?.success || !wrapper.data) return null;
    const data = wrapper.data;
    const movies: MovieEntry[] = (data.movies ?? []).map((movie) => {
      const webm = movie.webm?.max ?? movie.webm?.["480"];
      const mp4 = movie.mp4?.max ?? movie.mp4?.["480"] ?? movie.mp4?.full;
      return {
        id: movie.id ?? 0,
        name: movie.name?.trim() || undefined,
        thumbnail: movie.thumbnail?.trim() || undefined,
        webm,
        mp4,
        hlsH264: movie.hls_h264,
        highlight: Boolean(movie.highlight),
      };
    });
    const shortDescription = data.short_description
      ? stripTags(data.short_description)
      : undefined;
    const aboutText = shortDescription || (data.about_the_game ? stripTags(data.about_the_game) : undefined);
    if (!data.about_the_game && !aboutText && movies.length === 0) return null;
    return {
      source: "steam",
      sourceUrl: `https://store.steampowered.com/app/${appId}`,
      sourceName: "Steam",
      aboutHtml: data.about_the_game,
      aboutText,
      shortDescription,
      releaseDate: data.release_date?.date?.trim() || undefined,
      movies,
      fetchedAt: Math.floor(Date.now() / 1000),
    };
  } catch {
    return null;
  }
}

/** `get_about_bundle` — localized Steam about copy; never throws. */
export async function getAboutBundle(
  rawAppId: unknown,
  _gameName: unknown,
): Promise<AboutBundle> {
  const empty: AboutBundle = { byLanguage: {}, defaultLanguage: "english" };
  const appId = positiveInt(rawAppId);
  if (!appId) return empty;
  const key = `steam-about:${appId}`;
  const hit = cacheLookup<AboutBundle>(key);
  if (hit && Date.now() - hit.at < EXTRA_TTL.steamAbout) return hit.value;

  const entries = await Promise.all(
    ABOUT_LANGUAGES.map(async (language) => {
      const payload = await fetchAboutForLanguage(appId, language);
      return [language, payload] as const;
    }),
  );
  const byLanguage: Record<string, RichAboutPayload> = {};
  for (const [language, payload] of entries) {
    if (payload) byLanguage[language] = payload;
  }
  if (Object.keys(byLanguage).length === 0) return hit?.value ?? empty;
  const bundle: AboutBundle = { byLanguage, defaultLanguage: "english" };
  cacheStore(key, bundle);
  return bundle;
}
