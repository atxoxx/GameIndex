/**
 * decomps.net adapter.
 *
 * The directory is plain server-rendered HTML with no JSON API. Listing pages
 * (`/?p=N&f=1`) carry the game, origin, repository, language, notes and stars of
 * every project, but the supported targets ("Runs on") only exist on each game
 * page (`/game/<slug>-<id>`). A crawl is therefore two phases: rows first, then
 * one game-page request per distinct game to warp targets back onto its rows.
 *
 * Grouping by game matters: a page of 100 rows covers far fewer distinct games,
 * so enrichment costs a few hundred requests instead of ~1.3K.
 */
import { load } from "cheerio";

import type { PortSourceProject } from "../../../../../src/types/port";
import { httpText } from "../../../lib/http";
import type { SourceFetchOptions } from "./types";
import { absoluteUrl, cleanText, mapPool, parseStarText } from "./util";

const SITE = "https://decomps.net";
/** The site paginates at 100 rows; it currently ends around page 14. */
const MAX_LIST_PAGES = 30;
const MAX_PROJECTS = 5000;
/** Enrichment is the slow phase; six parallel game pages keeps the site happy. */
const GAME_PAGE_CONCURRENCY = 6;
/** More failures than this and the catalog would be too thin to trust. */
const MAX_GAME_PAGE_FAILURE_RATIO = 0.2;

const ORIGIN_CLASS =
  /(?:^|\s)k-(?:decompilation|recompilation|port|disassembly|reimplementation)(?:\s|$)/;
const PLATFORM_CLASS = /(?:^|\s)pc\d+(?:\s|$)/;
/** `span.kind` texts the game page uses for run targets when it has no title. */
const KNOWN_TARGETS = new Set([
  "Windows",
  "Linux",
  "macOS",
  "Mac OS",
  "Mac OS X",
  "Steam Deck",
  "Android",
  "iOS",
  "iPadOS",
  "Switch",
  "Nintendo Switch",
  "Wii U",
  "Web",
  "Browser",
  "FreeBSD",
  "BSD",
  "PS Vita",
  "PlayStation Vita",
]);

function listUrl(page: number): string {
  return `${SITE}/?p=${page}&f=1`;
}

/**
 * Normalize a repository reference to `github:owner/repo` / `gitlab:owner/repo`.
 *
 * The listing only links to the site's own `/progress/<owner>/<repo>` pages, so
 * the host has to be inferred: decomps.net indexes GitHub-hosted projects
 * (a GitLab mirror, when one exists, is mentioned in the notes, not linked).
 * Full links and already-normalized keys are accepted too, which keeps the
 * helper usable for both adapters' markup.
 */
export function repoKeyFromHref(href: string): string {
  const value = cleanText(href);
  if (!value) return "";

  const explicit = value.match(/^(github|gitlab):\s*([\w.-]+\/[\w.-]+)$/i);
  if (explicit) return `${explicit[1].toLowerCase()}:${explicit[2].toLowerCase()}`;

  let url: URL;
  try {
    url = new URL(value, SITE);
  } catch {
    return "";
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let hostKind: "github" | "gitlab" | null = null;
  if (host === "github.com") hostKind = "github";
  else if (host === "gitlab.com") hostKind = "gitlab";
  else if (host === "decomps.net") hostKind = "github";
  if (!hostKind) return "";

  const segments = url.pathname.split("/").filter(Boolean);
  const offset = segments[0]?.toLowerCase() === "progress" ? 1 : 0;
  const owner = segments[offset] ?? "";
  const repo = (segments[offset + 1] ?? "").replace(/\.git$/i, "");
  if (!owner || !repo) return "";

  // GitHub and GitLab both treat owner/repo case-insensitively; lowercasing is
  // what makes a listing row and its game-page row share one key.
  return `${hostKind}:${owner}/${repo}`.toLowerCase();
}

/** Canonical repo URL for a key (the listing itself only links to `/progress`). */
function repoUrlFromKey(key: string): string {
  const separator = key.indexOf(":");
  if (separator < 0) return "";
  const host = key.slice(0, separator);
  const path = key.slice(separator + 1);
  if (host === "gitlab") return `https://gitlab.com/${path}`;
  return `https://github.com/${path}`;
}

/**
 * Repo URL from a `/progress/<owner>/<repo>` link. The normalized key is
 * lowercased for matching, so the displayed URL is rebuilt from the original
 * href to keep the repository's real casing (`diasurgical/DevilutionX`).
 */
function repoUrlFromRepoHref(href: string, key: string): string {
  const segments = cleanText(href).split(/[?#]/)[0].split("/").filter(Boolean);
  const offset = segments[0]?.toLowerCase() === "progress" ? 1 : 0;
  const owner = segments[offset] ?? "";
  const repo = (segments[offset + 1] ?? "").replace(/\.git$/i, "");
  if (!owner || !repo) return repoUrlFromKey(key);
  const host = key.startsWith("gitlab:") ? "https://gitlab.com" : "https://github.com";
  return `${host}/${owner}/${repo}`;
}

interface DecompsRow {
  project: PortSourceProject;
  /** Game page the row's targets come from. */
  gameUrl: string;
  repoKey: string;
}

/**
 * Parse listing rows. Kept internal (with the game URL) so `fetchDecompsProjects`
 * can enrich later without re-parsing; the exported wrapper drops it.
 */
function parseRows(html: string, pageUrl: string): DecompsRow[] {
  const $ = load(html);
  const rows: DecompsRow[] = [];

  $("div.row.thr").each((_, element) => {
    const row = $(element);
    // Game pages reuse `.row.thr` for their project cards; those are not rows.
    if (row.hasClass("gprow")) return;

    const heading = row.find("h3.pj-t").first();
    const gameAnchor = heading.find("a.lnk").first();
    const game = cleanText(gameAnchor.text());
    if (!game) return;

    let platform = "";
    let origin = "";
    heading.find("span.kind").each((__, chip) => {
      const classes = $(chip).attr("class") ?? "";
      const text = cleanText($(chip).text());
      if (!origin && ORIGIN_CLASS.test(classes)) origin = text;
      if (!platform && PLATFORM_CLASS.test(classes)) platform = text;
    });

    const repoAnchor = row.find('a.tl[href^="/progress/"]').first();
    const progressHref = repoAnchor.attr("href") ?? "";
    const repoLabel = cleanText(repoAnchor.text());
    const repoKey = repoKeyFromHref(progressHref);

    // `owner/repo · C++` or `owner/repo · AI-assisted · C`: the label comes
    // first, everything after it describes the code. Joining instead of taking
    // the tail keeps the "AI-assisted" marker the site shows for those repos.
    const hint = cleanText(row.find("p.hint").first().text());
    const languages = hint
      .split(/[·•]/)
      .slice(1)
      .map((part) => cleanText(part))
      .filter(Boolean)
      .join(", ");

    const gameUrl = absoluteUrl(pageUrl, gameAnchor.attr("href"));
    const sourceUrl = repoKey ? absoluteUrl(SITE, progressHref) : gameUrl;
    const repoUrl = repoKey ? repoUrlFromRepoHref(progressHref, repoKey) : "";
    // The row's thumbnail (`/media/thumbs/<id>.jpg`) is the game's cover art.
    const thumb = cleanText(row.find("img.pj-th").first().attr("src"));

    rows.push({
      gameUrl,
      repoKey,
      project: {
        source: "decomps",
        sourceUrl,
        game,
        platform,
        // The site names a project after its repository.
        portName: repoLabel || game,
        origin,
        status: "",
        languages,
        notes: cleanText(row.find("p.f14.muted.lh15").first().text()),
        links: repoUrl
          ? [
              {
                label: repoLabel || repoUrl,
                url: repoUrl,
                kind: repoKey.startsWith("gitlab:") ? "gitlab" : "github",
              },
            ]
          : [],
        stars: parseStarText(row.find('.thr-meta span[title^="Stars"]').first().text()),
        targets: [],
        imageUrl: thumb ? absoluteUrl(SITE, thumb) : null,
        communityRating: null,
        realRating: null,
        group: "",
      },
    });
  });

  return rows;
}

export function parseDecompsList(html: string, pageUrl: string): PortSourceProject[] {
  return parseRows(html, pageUrl).map((row) => row.project);
}

/**
 * Parse one game page into `repo key -> runs-on targets + stars`.
 *
 * The game page shows the same projects as the listing but adds a chip per
 * target, plus exact star counts as `data-stars` on the row (the listing only
 * shows a rounded "9K").
 */
export function parseDecompsGamePage(
  html: string,
): Map<string, { targets: string[]; stars: number | null }> {
  const $ = load(html);
  const result = new Map<string, { targets: string[]; stars: number | null }>();

  $("div.row.thr.gprow").each((_, element) => {
    const row = $(element);
    const key = repoKeyFromHref(row.find('a.tl[href^="/progress/"]').first().attr("href") ?? "");
    if (!key) return;

    const targets: string[] = [];
    row.find("h3.pj-t span.kind").each((__, chip) => {
      const classes = $(chip).attr("class") ?? "";
      // `k-port` / `k-decompilation` describe the project, not a target.
      if (/(?:^|\s)k-/.test(classes)) return;
      const text = cleanText($(chip).text());
      if (!text) return;
      const titled = /^runs on/i.test($(chip).attr("title") ?? "");
      if (titled || KNOWN_TARGETS.has(text)) targets.push(text);
    });

    const rawStars = (row.attr("data-stars") ?? "").trim();
    const exactStars = /^\d+$/.test(rawStars) ? Number(rawStars) : null;
    const stars =
      exactStars ?? parseStarText(row.find('.thr-meta span[title^="Stars"]').first().text());

    result.set(key, { targets: [...new Set(targets)], stars });
  });

  return result;
}

/** Last path segment of a repo key, used as a lenient enrichment fallback. */
function repoNameOf(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

export async function fetchDecompsProjects(
  options: SourceFetchOptions = {},
): Promise<PortSourceProject[]> {
  const rows: DecompsRow[] = [];

  for (
    let page = 1;
    page <= MAX_LIST_PAGES && rows.length < MAX_PROJECTS;
    page += 1
  ) {
    const response = await httpText(listUrl(page), { timeoutMs: 20_000, retries: 1 });
    if (!response.ok) {
      throw new Error(`decomps.net listing page ${page} returned HTTP ${response.status}`);
    }
    const pageRows = parseRows(response.text, response.url || listUrl(page));
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    options.onProgress?.({ done: Math.min(rows.length, MAX_PROJECTS), total: 0 });
  }

  if (rows.length === 0) throw new Error("decomps.net returned no project rows");

  const limited = rows.slice(0, MAX_PROJECTS);

  // Group by game so each game page is fetched once for every row it carries.
  const games = new Map<string, { url: string; rowIndexes: number[] }>();
  limited.forEach((row, index) => {
    const entry = games.get(row.gameUrl) ?? { url: row.gameUrl, rowIndexes: [] };
    entry.rowIndexes.push(index);
    games.set(row.gameUrl, entry);
  });

  const gameList = [...games.values()];
  let done = 0;
  let failures = 0;
  const fetched = await mapPool(
    gameList,
    GAME_PAGE_CONCURRENCY,
    async (game): Promise<Map<string, { targets: string[]; stars: number | null }> | null> => {
      try {
        const response = await httpText(game.url, { timeoutMs: 20_000, retries: 1 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseDecompsGamePage(response.text);
      } catch {
        // A missing game page only costs those rows their targets; the listing
        // already gave us everything else, so keep them (unless too many fail).
        failures += 1;
        return null;
      } finally {
        done += 1;
        options.onProgress?.({ done, total: games.size });
      }
    },
  );

  fetched.forEach((targetsByRepo, index) => {
    if (!targetsByRepo) return;
    for (const rowIndex of gameList[index].rowIndexes) {
      const row = limited[rowIndex];
      let match = targetsByRepo.get(row.repoKey);
      if (!match && row.repoKey) {
        // Fallback: the same repository spelled with different owner casing or
        // reached through a fork alias. The game page only lists this game's
        // projects, so matching the repo name inside it is safe.
        const name = repoNameOf(row.repoKey);
        for (const [key, value] of targetsByRepo) {
          if (repoNameOf(key) === name) {
            match = value;
            break;
          }
        }
      }
      if (!match && targetsByRepo.size === 1) {
        // Last resort: a single-project game page cannot belong to another row.
        match = targetsByRepo.values().next().value;
      }
      if (!match) continue;
      row.project.targets = match.targets;
      if (match.stars !== null) row.project.stars = match.stars;
    }
  });

  if (failures / Math.max(1, games.size) > MAX_GAME_PAGE_FAILURE_RATIO) {
    throw new Error(
      `decomps.net: ${failures} of ${games.size} game pages failed, above the ${Math.round(
        MAX_GAME_PAGE_FAILURE_RATIO * 100,
      )}% budget`,
    );
  }
  if (failures > 0) {
    console.warn(
      `decomps.net: skipped ${failures} of ${games.size} game pages; those rows keep empty targets`,
    );
  }

  return limited.map((row) => row.project);
}
