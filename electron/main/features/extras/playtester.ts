/**
 * Playtester.io feed and detail scraper for the Deals page.
 *
 * Ported from `src-tauri/src/deals.rs` (Playtester section). The listing pages
 * are Next.js SSR with an embedded flight payload; the payload is preferred
 * because it carries the full platform map and raw playtest type. The rendered
 * card markup is the fallback. Detail pages expose JSON-LD for screenshots and
 * trailers, which the client-hydrated gallery does not include in the SSR HTML.
 *
 * Feed cache: 15 minutes (`extras-cache.json`), stale served on an outage.
 * Detail cache: 1 hour.
 */
import * as cheerio from "cheerio";

import { httpText } from "../../lib/http";
import { cached, EXTRA_TTL } from "./cache";

const HOMEPAGE = "https://playtester.io/";
const CATEGORIES_SITEMAP = "https://playtester.io/categories-sitemap.xml";
const FALLBACK_CATEGORIES = ["cozy", "horror", "multiplayer", "roguelike", "rpg", "survival"];
const PAGE_CONCURRENCY = 8;

export interface PlaytesterGame {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  thumbnail?: string | null;
  platform: string;
  platforms: string[];
  genres: string[];
  kind: string;
  status: string;
  dateAdded?: string | null;
  url: string;
}

export interface PlaytesterFeed {
  games: PlaytesterGame[];
  hasMore: boolean;
  nextOffset: number;
  total: number;
}

export interface PlaytesterPlatformLink {
  name: string;
  url: string;
}

export interface PlaytesterRequirement {
  label: string;
  value: string;
}

export interface PlaytesterPhoto {
  url: string;
  caption?: string | null;
}

export interface PlaytesterVideo {
  name?: string | null;
  thumbnailUrl?: string | null;
  contentUrl?: string | null;
  embedUrl?: string | null;
  duration?: string | null;
}

export interface PlaytesterGameDetail {
  slug: string;
  title: string;
  status?: string | null;
  studio?: string | null;
  studioUrl?: string | null;
  added?: string | null;
  description?: string | null;
  kind?: string | null;
  releaseDate?: string | null;
  languages?: string | null;
  controller?: string | null;
  platforms: PlaytesterPlatformLink[];
  systemRequirements: PlaytesterRequirement[];
  photos: PlaytesterPhoto[];
  videos: PlaytesterVideo[];
  demoUrl?: string | null;
  installUrl?: string | null;
  steamdbUrl?: string | null;
  thumbnail?: string | null;
  url: string;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function thumbnailFor(slug: string): string {
  return `https://cdn.playtester.io/thumbnails/${slug}.webp`;
}

const PREFERRED_PLATFORMS = [
  "Steam",
  "itch.io",
  "Epic Games",
  "GOG",
  "PlayStation",
  "Xbox",
  "Nintendo Switch",
];

function orderPlatforms(platforms: string[]): string[] {
  return [...platforms].sort((a, b) => {
    const left = PREFERRED_PLATFORMS.indexOf(a);
    const right = PREFERRED_PLATFORMS.indexOf(b);
    const l = left < 0 ? Number.MAX_SAFE_INTEGER : left;
    const r = right < 0 ? Number.MAX_SAFE_INTEGER : right;
    return l - r || a.localeCompare(b);
  });
}

function formatPlaytestType(kind: string, openPlaytest: boolean | null | undefined): string {
  if (kind === "Alpha" || kind === "Beta") {
    if (openPlaytest === true) return `Open ${kind}`;
    if (openPlaytest === false) return `Closed ${kind}`;
  }
  return kind;
}

// ── Listing payloads ───────────────────────────────────────────────────

interface FlightGame {
  type?: string;
  title?: string;
  short_description?: string | null;
  slug?: string;
  categories?: string[];
  categories_featured?: string[];
  status?: string | null;
  platforms?: Record<string, string>;
  open_playtest?: boolean | null;
  date_added?: string | null;
}

function unescapeJsString(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) break;
    switch (next) {
      case '"':
        out += '"';
        index += 1;
        break;
      case "\\":
        out += "\\";
        index += 1;
        break;
      case "/":
        out += "/";
        index += 1;
        break;
      case "n":
        out += "\n";
        index += 1;
        break;
      case "t":
        out += "\t";
        index += 1;
        break;
      case "r":
        out += "\r";
        index += 1;
        break;
      case "u":
        out += value.slice(index, index + 6);
        index += 5;
        break;
      default:
        out += next;
        index += 1;
    }
  }
  return out;
}

function parsePlaytesterFlight(html: string): PlaytesterGame[] {
  const markers = ['games\\":[', '"games":['];
  let arrayStart = -1;
  for (const marker of markers) {
    const found = html.indexOf(marker);
    if (found >= 0) {
      arrayStart = found + marker.length - 1; // the opening '['
      break;
    }
  }
  if (arrayStart < 0) return [];
  const start = arrayStart + 1;

  let depth = 1;
  let inString = false;
  let index = start;
  while (index < html.length) {
    const ch = html[index];
    if (ch === "\\") {
      const next = html[index + 1];
      if (next === '"') inString = !inString;
      index += 2;
      continue;
    }
    if (inString) {
      index += 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
    index += 1;
  }
  if (depth !== 0) return [];

  let parsed: FlightGame[];
  try {
    parsed = JSON.parse(unescapeJsString(html.slice(arrayStart, index + 1))) as FlightGame[];
  } catch {
    return [];
  }
  const out: PlaytesterGame[] = [];
  for (const game of parsed) {
    const slug = game.slug?.trim() ?? "";
    const title = game.title?.trim() ?? "";
    if (!slug || !title) continue;
    const platforms = orderPlatforms(Object.keys(game.platforms ?? {}));
    const featured = game.categories_featured ?? [];
    const genres = featured.length > 0 ? featured : (game.categories ?? []).slice(0, 2);
    out.push({
      id: slug,
      slug,
      title,
      description: game.short_description?.trim() || null,
      thumbnail: thumbnailFor(slug),
      platform: platforms[0] ?? "",
      platforms,
      genres,
      kind: formatPlaytestType(game.type ?? "", game.open_playtest),
      status: game.status?.trim() || "Active",
      dateAdded: game.date_added ?? null,
      url: `${HOMEPAGE}${slug}`,
    });
  }
  return out;
}

const NON_GAME_PREFIXES = [
  "/studios",
  "/categories",
  "/search",
  "/about",
  "/blog",
  "/contact",
  "/faqs",
  "/privacy",
  "/terms",
  "/@",
  "/select",
  "/redirect",
];

/** Fixture entry point for the harness: parse a saved listing page. */
export function parsePlaytesterFlightFixture(html: string): PlaytesterGame[] {
  return parsePlaytesterFlight(html);
}

/** Pure parser exported for the harness. */
export function parsePlaytesterCards(html: string): PlaytesterGame[] {
  const $ = cheerio.load(html);
  const games: PlaytesterGame[] = [];
  $("a.focus-ring-lg").each((_index, element) => {
    const card = $(element);
    const href = card.attr("href")?.trim() ?? "";
    if (!href.startsWith("/") || NON_GAME_PREFIXES.some((prefix) => href.startsWith(prefix))) return;
    const slug = href.replace(/^\/+/, "");
    if (!slug || slug.includes("/")) return;
    const title = collapse(card.find("h3").first().text());
    if (!title) return;
    const status =
      card.find('[role="status"][aria-label]').first().attr("aria-label")?.trim() ??
      "Active";
    const platform = card.find('img[src^="/icons/"]').first().attr("alt")?.trim() ?? "";
    const genres = (collapse(card.find("span.min-w-0").first().text()) || "")
      .split(",")
      .map((genre) => genre.trim())
      .filter(Boolean);
    const kindAnchor = card
      .find("span.shrink-0")
      .filter((_i, span) => !$(span).attr("aria-hidden"))
      .first();
    const kind = collapse(kindAnchor.text());
    const dateAdded = card.find("time[datetime]").first().attr("datetime")?.trim() ?? null;
    const description = collapse(card.find(".line-clamp-2").first().text()) || null;
    games.push({
      id: slug,
      slug,
      title,
      description,
      thumbnail: thumbnailFor(slug),
      platform,
      platforms: platform ? [platform] : [],
      genres,
      kind,
      status: status.replace(/^Status:\s*/, "") || "Active",
      dateAdded,
      url: `${HOMEPAGE}${slug}`,
    });
  });
  return games;
}

async function fetchPage(url: string): Promise<string> {
  const response = await httpText(url, { timeoutMs: 20_000, retries: 1 });
  if (!response.ok) throw new Error(`Playtester returned HTTP ${response.status}.`);
  return response.text;
}

function parseCategorySlugs(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/\/categories\/([^<\s"'/]+)/g)) {
    const slug = match[1]?.trim();
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

async function categories(): Promise<string[]> {
  return cached(
    "playtester-categories",
    EXTRA_TTL.playtesterCategories,
    async () => {
      try {
        const xml = await fetchPage(CATEGORIES_SITEMAP);
        const slugs = parseCategorySlugs(xml);
        return slugs.length > 0 ? slugs : [...FALLBACK_CATEGORIES];
      } catch {
        return [...FALLBACK_CATEGORIES];
      }
    },
    { staleOnError: true },
  );
}

/** `fetch_playtester_games` — one page of the scraped catalogue. */
export async function fetchPlaytesterGames(offsetRaw: unknown, limitRaw: unknown): Promise<PlaytesterFeed> {
  const offset = Math.max(0, Math.floor(Number(offsetRaw) || 0));
  const limit = Math.min(50, Math.max(1, Math.floor(Number(limitRaw) || 12)));
  const key = `playtester-feed:${offset}:${limit}`;
  return cached(
    key,
    EXTRA_TTL.playtesterFeed,
    async () => {
      const categorySlugs = await categories();
      const urls = [HOMEPAGE, ...categorySlugs.map((slug) => `https://playtester.io/categories/${slug}`)];
      const start = Math.min(offset, urls.length);
      const end = Math.min(start + limit, urls.length);
      const batch = urls.slice(start, end);

      const collected: PlaytesterGame[] = [];
      let cursor = 0;
      const workers = Array.from({ length: Math.min(PAGE_CONCURRENCY, batch.length) }, async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= batch.length) return;
          try {
            const html = await fetchPage(batch[index]);
            const flight = parsePlaytesterFlight(html);
            const games = flight.length > 0 ? flight : parsePlaytesterCards(html);
            collected.push(...games);
          } catch {
            /* one failed page must not fail the whole feed */
          }
        }
      });
      await Promise.all(workers);

      const seen = new Set<string>();
      const games = collected
        .filter((game) => {
          if (seen.has(game.slug)) return false;
          seen.add(game.slug);
          return true;
        })
        .sort((a, b) => (b.dateAdded ?? "").localeCompare(a.dateAdded ?? ""));
      if (games.length === 0 && batch.length > 0) {
        throw new Error("Playtester returned no games — the site layout may have changed.");
      }
      return {
        games,
        hasMore: end < urls.length,
        nextOffset: end,
        total: urls.length,
      };
    },
    { staleOnError: true },
  );
}

// ── Detail page ────────────────────────────────────────────────────────

function sanitizeSlug(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9-]/g, "");
}

function jsonLd(html: string): Record<string, unknown> | null {
  const $ = cheerio.load(html);
  const script = $('script[type="application/ld+json"]').first().html();
  if (!script) return null;
  try {
    const parsed = JSON.parse(script) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function ldString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  if (typeof field !== "string") return null;
  return field.trim() || null;
}

async function fetchDetail(slug: string): Promise<PlaytesterGameDetail> {
  const html = await fetchPage(`${HOMEPAGE}${slug}`);
  const $ = cheerio.load(html);

  const title =
    collapse($("h1 span").first().text()) || collapse($("h1").first().text()) || slug;
  const status =
    $('[role="status"][aria-label^="Status:"]').first().attr("aria-label")?.trim() ??
    null;
  const studioLink = $('a[href^="/studios/"]').first();
  const studioHref = studioLink.attr("href")?.trim() ?? "";
  let studio = studioLink.find("[role='img'][aria-label]").first().attr("aria-label")?.trim() ?? "";
  if (!studio && studioHref) {
    studio = studioHref
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .pop()!
      .split("-")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  const studioUrl = studioHref ? `${HOMEPAGE}${studioHref.replace(/^\/+/, "")}` : null;
  const added = $("time[datetime]").first().attr("datetime")?.trim() ?? null;
  let description = collapse($("#game-short-description").first().text()) || null;

  let kind: string | null = null;
  let releaseDate: string | null = null;
  let languages: string | null = null;
  let controller: string | null = null;
  const platforms: PlaytesterPlatformLink[] = [];

  $('aside[aria-label="Game details"] li').each((_index, element) => {
    const item = $(element);
    const label = collapse(item.find("span.text-neutral-400").first().text()).toLowerCase();
    if (label === "platforms") {
      item.find("a[href]").each((_i, link) => {
        const anchor = $(link);
        const url = anchor.attr("href")?.trim();
        if (!url) return;
        platforms.push({
          name: anchor.find("img[alt]").first().attr("alt")?.trim() || "Platform",
          url,
        });
      });
      return;
    }
    const value = collapse(item.find("span.text-right").first().text()) || null;
    if (label === "type") kind = value;
    else if (label === "release date") releaseDate = value;
    else if (label === "languages") languages = value;
    else if (label === "controller") controller = value;
  });

  let systemRequirements: PlaytesterRequirement[] = [];
  let bestCount = 0;
  $("dl").each((_index, element) => {
    const dl = $(element);
    const labels = dl.find("dt").map((_i, dt) => collapse($(dt).text())).get();
    const values = dl.find("dd").map((_i, dd) => collapse($(dd).text())).get();
    const count = Math.min(labels.length, values.length);
    if (count > bestCount) {
      bestCount = count;
      systemRequirements = labels.slice(0, count).map((label, index) => ({
        label,
        value: values[index],
      }));
    }
  });

  const demoUrl =
    $("a.bg-primary[href]").first().attr("href")?.trim().startsWith("http")
      ? $("a.bg-primary[href]").first().attr("href")!.trim()
      : null;
  const installUrl = $('a[href^="steam://"]').first().attr("href")?.trim() ?? null;
  const steamdbUrl = $('a[href^="https://steamdb.info"]').first().attr("href")?.trim() ?? null;

  const ld = jsonLd(html);
  const photos: PlaytesterPhoto[] = [];
  const videos: PlaytesterVideo[] = [];
  if (ld) {
    const image = ld.image;
    const images = Array.isArray(image) ? image : image ? [image] : [];
    for (const entry of images) {
      if (!entry || typeof entry !== "object") continue;
      const url = ldString(entry, "url");
      if (!url) continue;
      photos.push({ url, caption: ldString(entry, "caption") });
    }
    const subjectOf = Array.isArray(ld.subjectOf) ? ld.subjectOf : [];
    for (const entry of subjectOf) {
      videos.push({
        name: ldString(entry, "name"),
        thumbnailUrl: ldString(entry, "thumbnailUrl"),
        contentUrl: ldString(entry, "contentUrl"),
        embedUrl: ldString(entry, "embedUrl"),
        duration: ldString(entry, "duration"),
      });
    }
    description = description ?? ldString(ld, "description");
  }

  return {
    slug,
    title,
    status: status ? status.replace(/^Status:\s*/, "") : null,
    studio: studio || null,
    studioUrl,
    added,
    description,
    kind,
    releaseDate,
    languages,
    controller,
    platforms,
    systemRequirements,
    photos,
    videos,
    demoUrl,
    installUrl,
    steamdbUrl,
    thumbnail: thumbnailFor(slug),
    url: `${HOMEPAGE}${slug}`,
  };
}

/** `fetch_playtester_game_detail` — full detail, stale-cached on outage. */
export async function fetchPlaytesterGameDetail(rawSlug: unknown): Promise<PlaytesterGameDetail> {
  const slug = sanitizeSlug(typeof rawSlug === "string" ? rawSlug : "");
  if (!slug) throw new Error("Invalid game slug.");
  return cached(
    `playtester-detail:${slug}`,
    EXTRA_TTL.playtesterDetail,
    () => fetchDetail(slug),
    { staleOnError: true },
  );
}
