/**
 * Pure HTML -> rows parser for PCGamingWiki's unofficial-ports tables.
 *
 * Kept free of Electron/network imports so it can be unit-tested against a
 * fixture. `catalog.ts` owns fetching, caching and the offline fallback.
 */
import { load } from "cheerio";

import { PORTS_SOURCE_URL, type PortSourceProject } from "../../../../src/types/port";

const WIKI_BASE = "https://www.pcgamingwiki.com";
const MAX_PROJECTS = 4000;

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function linkKind(url: string): "github" | "gitlab" | "website" {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  } catch {
    /* not a URL - treated as a website below */
  }
  return "website";
}

/**
 * Walk the parsed document in order (headings + tables), tracking the current
 * `group` (Nintendo / SEGA / ...) and `platform` (Nintendo 64 / Genesis / ...).
 * The wiki emits one table per platform and occasional `h1` group headings.
 */
export function parsePortsHtml(html: string): PortSourceProject[] {
  const $ = load(html);
  const root = $(".mw-parser-output").length ? $(".mw-parser-output") : $("body");
  const projects: PortSourceProject[] = [];
  const seen = new Set<string>();
  let group = "";
  let platform = "";

  root.find("h1, h2, h3, table").each((_, element) => {
    const node = $(element);
    const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? "";

    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const headline = node.find(".mw-headline").first();
      const text = clean(headline.length ? headline.text() : node.text()).replace(
        /\[edit\]/gi,
        "",
      );
      if (!text) return;
      if (tag === "h1") {
        group = text;
        platform = text;
      } else {
        platform = text;
      }
      return;
    }

    const headers = node
      .find("tr")
      .first()
      .find("th")
      .map((__, th) => clean($(th).text()).toLowerCase())
      .get();
    const gameColumn = headers.includes("port name")
      ? headers.indexOf("game")
      : headers.includes("engine")
        ? headers.indexOf("compatible games")
        : -1;
    const portColumn = headers.includes("port name")
      ? headers.indexOf("port name")
      : headers.indexOf("engine");
    if (gameColumn < 0 || portColumn < 0) return;

    const originColumn = headers.indexOf("origin of port");
    const statusColumn = headers.indexOf("status");
    const languageColumn = headers.indexOf("code language");
    const ratingColumn = headers.indexOf("real rating");
    const notesColumn = headers.indexOf("notes");

    node
      .find("tr")
      .slice(1)
      .each((__, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2) return;
        const cell = (index: number) => (index >= 0 ? cells.eq(index) : null);

        const portCell = cell(portColumn);
        if (!portCell) return;
        const game = clean(cell(gameColumn)?.text());
        if (!game) return;

        const links = portCell
          .find("a")
          .map((___, anchor) => {
            const href = ($(anchor).attr("href") ?? "").trim();
            if (!/^https?:\/\//i.test(href)) return null;
            return {
              label: clean($(anchor).text()) || href,
              url: href,
              kind: linkKind(href),
            };
          })
          .get()
          .filter(
            (
              link,
            ): link is { label: string; url: string; kind: "github" | "gitlab" | "website" } =>
              link !== null,
          );

        const portName = links[0]?.label || clean(portCell.text());
        if (!portName) return;

        const wikiHref = cell(gameColumn)?.find("a").first().attr("href") ?? "";
        const wikiUrl =
          /^\/wiki\//.test(wikiHref) && !/redlink/.test(wikiHref)
            ? `${WIKI_BASE}${wikiHref}`
            : undefined;

        const ratingSrc = cell(ratingColumn)?.find("img").first().attr("src") ?? "";
        const ratingMatch = ratingSrc.match(/rating_(\d)/);
        const realRating = ratingMatch ? Number(ratingMatch[1]) : null;

        const dedupeKey = `${platform}|${game}|${portName}|${links[0]?.url ?? ""}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        projects.push({
          source: "pcgamingwiki",
          sourceUrl: wikiUrl ?? PORTS_SOURCE_URL,
          game,
          portName,
          origin: clean(cell(originColumn)?.text()),
          status: clean(cell(statusColumn)?.text()),
          languages: clean(cell(languageColumn)?.text()),
          realRating,
          notes: clean(cell(notesColumn)?.text()),
          platform,
          group,
          links,
          stars: null,
          targets: [],
          communityRating: null,
          wikiUrl,
        });
      });
  });

  // Two sections can share a platform name ("Arcade" under Multiplatform and
  // under SEGA). Qualify only the duplicates so ordinary names stay short.
  const groupsByPlatform = new Map<string, Set<string>>();
  for (const project of projects) {
    const groups = groupsByPlatform.get(project.platform) ?? new Set<string>();
    groups.add(project.group ?? "");
    groupsByPlatform.set(project.platform, groups);
  }
  for (const project of projects) {
    const groups = groupsByPlatform.get(project.platform);
    if (groups && groups.size > 1 && project.group) {
      project.platform = `${project.platform} (${project.group})`;
    }
  }

  return projects.slice(0, MAX_PROJECTS);
}
