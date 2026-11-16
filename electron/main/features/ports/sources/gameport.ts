/**
 * gameport.games adapter.
 *
 * The site is a TanStack Start app: every page is fully server-rendered HTML
 * (there is no public JSON API), so the listing cards and project pages can be
 * parsed directly. The explore listing is paginated at 48 cards; the project
 * page carries the details the listing lacks (games with their original
 * platform, community rating, exact stars, languages, description, notes and
 * links).
 *
 * Enrichment fetches one page per project (~7.1K), which is why the crawl uses a
 * small pool and tolerates a slice of failures instead of dropping rows.
 */
import { load, type CheerioAPI } from "cheerio";

import type { PortLink, PortSourceProject } from "../../../../../src/types/port";
import { httpText } from "../../../lib/http";
import type { SourceFetchOptions } from "./types";
import { cleanText, mapPool, parseStarText } from "./util";

const SITE = "https://gameport.games";
const MAX_LIST_PAGES = 200;
const MAX_PROJECTS = 12000;
const DETAIL_CONCURRENCY = 8;
/** Above this share of failed project pages the crawl is not worth caching. */
const MAX_DETAIL_FAILURE_RATIO = 0.15;

/** One card as the explore listing renders it (the raw, pre-detail shape). */
export interface RawGameportCard {
  /** Project id, the last segment of `/projects/<id>`. */
  id: string;
  /** Composed title, e.g. `osu +3`. */
  title: string;
  /** Repository URL, e.g. `https://github.com/ppy/osu`. */
  repoUrl: string;
  /** Games the project covers, comma-separated, when the card lists them. */
  gamesText: string;
  /** First kind chip, e.g. `Engine reimplementation`. */
  origin: string;
  /** Status chip, e.g. `Playable`. */
  status: string;
  /** GitHub star count from the card. */
  stars: number | null;
  /** 0-100 readiness score from the tier chip (e.g. `Polished 98`). */
  score: number | null;
  image: string;
}

function projectUrl(id: string): string {
  return `${SITE}/projects/${id}`;
}

function exploreUrl(page: number): string {
  return `${SITE}/explore?page=${page}`;
}

function linkKind(url: string): PortLink["kind"] {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  } catch {
    /* not a URL - treat it as a website */
  }
  return "website";
}

function repoUrlFromText(text: string): string {
  const value = cleanText(text);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

function repoNameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}

/** Strip the card's ` +N` game-count suffix from a composed title. */
function titleWithoutCount(title: string): string {
  return cleanText(title.replace(/\s*\+\d+$/, ""));
}

/** Split a `gamesText` list into names, dropping an ` +N` tail. */
function gamesFromText(text: string): string[] {
  return cleanText(text.replace(/\s*\+\d+$/, ""))
    .split(",")
    .map((game) => cleanText(game))
    .filter(Boolean);
}

/**
 * Gameport kinds use shorter labels than the merged catalog's origin buckets.
 * `Static recompilation`/`Matching decompilation` are the site's precise names
 * for the two families the catalog calls Recompilation and Decompilation.
 */
function mapOrigin(text: string): string {
  const value = cleanText(text);
  if (!value) return "";
  if (/recompil/i.test(value)) return "Recompilation";
  if (/decompil/i.test(value)) return "Decompilation";
  if (/disassembl/i.test(value)) return "Disassembly";
  if (/source[- ]port|native port/i.test(value)) return "Source port";
  if (/wrapper/i.test(value)) return "Wrapper";
  // Engine reimplementations, remakes and rewrites are recreations of the game
  // rather than ports of its code.
  if (/reimplementation|remake|rewrite|engine/i.test(value)) return "Recreation";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `unknown` is the site's "not reviewed" placeholder, not a status. */
function normalizeStatus(text: string): string {
  const value = cleanText(text);
  if (!value || /^unknown$/i.test(value)) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Parse an explore listing into cards.
 *
 * Cards are `ul li a[href^="/projects/"]`; the anchor's `title` is the composed
 * title, `span.truncate.font-mono` is the repository, and the remaining
 * `span.truncate` is either the games list (multi-game cards, whose title ends
 * in ` +N`) or the project description (single-game cards). Only the games form
 * is kept in `gamesText`, so a description cannot leak in as a game name.
 */
export function parseGameportList(html: string): RawGameportCard[] {
  const $ = load(html);
  const cards: RawGameportCard[] = [];
  const seen = new Set<string>();

  $('ul li a[href^="/projects/"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href") ?? "";
    const id = href.slice("/projects/".length).split(/[/?#]/)[0] ?? "";
    const title = cleanText(anchor.attr("title"));
    if (!id || !title || seen.has(id)) return;
    seen.add(id);

    const truncates = anchor.find("span.truncate");
    const subtitle = cleanText(
      truncates
        .filter((__, span) => !$(span).hasClass("font-mono"))
        .slice(1)
        .first()
        .text(),
    );

    // The tier chip nests the score in a mono span; the stars chip has the mono
    // class on itself, so `span[title] > span.font-mono` only matches tiers.
    const scoreText = cleanText(anchor.find("span[title] > span.font-mono").first().text());
    const statusChip = anchor
      .find(".bg-accent-tint")
      // A tier chip can share the accent tint; the status chip has no children.
      .filter((__, span) => $(span).find("span").length === 0)
      .first();

    cards.push({
      id,
      title,
      repoUrl: repoUrlFromText(cleanText(truncates.filter(".font-mono").first().text())),
      gamesText: /\+\d+$/.test(title) ? subtitle : "",
      origin: cleanText(anchor.find(".brand-chip").first().text()),
      status: cleanText(statusChip.text()),
      stars: parseStarText(anchor.find('span[title="GitHub stars"]').first().text()),
      score: /^\d+$/.test(scoreText) ? Number(scoreText) : null,
      image: anchor.find("img").first().attr("src") ?? "",
    });
  });

  return cards;
}

/** Value cell of an aside block, found by its uppercase label. */
function asideValue($: CheerioAPI, label: string) {
  const blocks = $("main aside > div").filter((_, element) => {
    const block = $(element);
    return cleanText(block.find("div").first().text()).toLowerCase() === label.toLowerCase();
  });
  return blocks.first().find("div.mt-1").first();
}

/** First `<section>` whose `<h2>` starts with `heading` (e.g. `Games`, `Notes`). */
function sectionByHeading($: CheerioAPI, heading: string) {
  return $("main section")
    .filter((_, element) => cleanText($(element).find("h2").first().text()).startsWith(heading))
    .first();
}

/** A card without a usable detail page still becomes a row, minus the extras. */
function projectFromCard(card: RawGameportCard): PortSourceProject {
  const game = gamesFromText(card.gamesText)[0] ?? titleWithoutCount(card.title);
  const repoUrl = card.repoUrl;
  return {
    source: "gameport",
    sourceUrl: projectUrl(card.id),
    game,
    platform: "",
    portName: repoNameFromUrl(repoUrl) || game,
    origin: mapOrigin(card.origin),
    status: normalizeStatus(card.status),
    languages: "",
    notes: "",
    links: repoUrl
      ? [{ label: repoUrl.replace(/^https?:\/\//i, ""), url: repoUrl, kind: linkKind(repoUrl) }]
      : [],
    stars: card.stars,
    targets: [],
    communityRating: null,
    realRating: null,
    group: "",
  };
}

/**
 * Map one project page onto a row.
 *
 * Every selector degrades to the card data: a page that lost its Games section
 * still produces a project with the list's game name and an empty platform,
 * because dropping the row would lose its repo/stars/rating entirely.
 */
export function parseGameportDetail(html: string, card: RawGameportCard): PortSourceProject {
  const $ = load(html);
  const header = $("main header").first();

  const title = cleanText(header.find("h1").first().text()) || card.title;
  const origin = mapOrigin(cleanText(header.find("a.brand-chip").first().text()) || card.origin);
  const statusChip = header
    .find(".bg-accent-tint")
    .filter((__, span) => $(span).find("span").length === 0)
    .first();
  const status =
    normalizeStatus(statusChip.text()) ||
    normalizeStatus(cleanText(asideValue($, "Status").text())) ||
    normalizeStatus(card.status);

  // Games: each `<li>` is a name plus a `/systems/<id>` chip with the label the
  // site uses for the game's original platform ("Nintendo 64", "PlayStation 2").
  const firstGame = sectionByHeading($, "Games").find("ul > li").first();
  const gameFromPage = cleanText(firstGame.find("span.font-medium").first().text());
  const platformFromPage = cleanText(firstGame.find('a[href^="/systems/"]').first().text());
  const game = gameFromPage || gamesFromText(card.gamesText)[0] || titleWithoutCount(card.title);
  const platform = platformFromPage;

  // Repository block: `owner/repo`, then a line with stars/forks/licence.
  const repository = asideValue($, "Repository");
  const repoFull = cleanText(repository.find("span.font-mono").first().text());
  const repoLine = cleanText(repository.find("span.text-ink-2").first().text());
  const starsMatch = repoLine.match(/([\d,.]+)\s*stars/i);
  const stars = (starsMatch ? parseStarText(starsMatch[1]) : null) ?? card.stars;
  const repoName = repoFull.split("/").filter(Boolean).pop() || repoNameFromUrl(card.repoUrl);

  const site = asideValue($, "Site").find("a[href]").first().attr("href") ?? "";
  const repoHref = header.find('a[href^="http"]').first().attr("href") ?? "";
  const repoUrl = repoHref || card.repoUrl;

  const links: PortLink[] = [];
  for (const url of [repoUrl, site]) {
    const value = cleanText(url);
    if (!value || links.some((link) => link.url === value)) continue;
    links.push({
      label: value.replace(/^https?:\/\//i, "").replace(/\/$/, ""),
      url: value,
      kind: linkKind(value),
    });
  }

  const description = cleanText(header.find("p").first().text());
  const notes = sectionByHeading($, "Notes")
    .find("ul > li")
    .toArray()
    .map((item) => cleanText($(item).text()))
    .filter(Boolean);

  // Community rating is a 0-5 value ("4.8 / 5"); unrated projects omit the block
  // entirely or render it without a value.
  const ratingText = cleanText(asideValue($, "Community rating").text());
  const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
  const communityRating = ratingMatch
    ? Math.round(Number(ratingMatch[1]) * 10) / 10
    : null;

  return {
    source: "gameport",
    sourceUrl: projectUrl(card.id),
    game,
    platform,
    // The site's project name is the repo name; the title only wraps it with the
    // game it was made for ("Lego Island (Isle Decomp)").
    portName: repoName || titleWithoutCount(title),
    origin,
    status,
    languages: cleanText(asideValue($, "Languages").text()),
    notes: [description, ...notes].filter(Boolean).join(" — "),
    links,
    stars,
    // Gameport lists the game's original system, not the port's targets.
    targets: [],
    communityRating,
    realRating: null,
    group: "",
  };
}

export async function fetchGameportProjects(
  options: SourceFetchOptions = {},
): Promise<PortSourceProject[]> {
  const cards: RawGameportCard[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_LIST_PAGES && cards.length < MAX_PROJECTS; page += 1) {
    const response = await httpText(exploreUrl(page), { timeoutMs: 20_000, retries: 1 });
    if (!response.ok) {
      throw new Error(`gameport.games explore page ${page} returned HTTP ${response.status}`);
    }
    const pageCards = parseGameportList(response.text);
    if (pageCards.length === 0) break;
    for (const card of pageCards) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      cards.push(card);
      if (cards.length >= MAX_PROJECTS) break;
    }
    options.onProgress?.({ done: cards.length, total: 0 });
  }

  if (cards.length === 0) throw new Error("gameport.games returned no project cards");

  let done = 0;
  let failures = 0;
  const projects = await mapPool(cards, DETAIL_CONCURRENCY, async (card) => {
    try {
      const response = await httpText(projectUrl(card.id), { timeoutMs: 20_000, retries: 1 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseGameportDetail(response.text, card);
    } catch {
      // Fall back to the listing card: the row keeps its repo, stars and status.
      failures += 1;
      return projectFromCard(card);
    } finally {
      done += 1;
      options.onProgress?.({ done, total: cards.length });
    }
  });

  if (failures / Math.max(1, cards.length) > MAX_DETAIL_FAILURE_RATIO) {
    throw new Error(
      `gameport.games: ${failures} of ${cards.length} project pages failed, above the ${Math.round(
        MAX_DETAIL_FAILURE_RATIO * 100,
      )}% budget`,
    );
  }
  if (failures > 0) {
    console.warn(
      `gameport.games: skipped ${failures} of ${cards.length} project pages; those rows keep listing data`,
    );
  }

  return projects;
}
