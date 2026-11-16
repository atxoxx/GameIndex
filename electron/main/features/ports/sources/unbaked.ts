/**
 * unbaked.games adapter.
 *
 * One summary request lists every game, but the projects live in per-slug JSON
 * details. Only games flagged `has_public_code` have projects, which keeps the
 * detail fan-out (about 5.7k files) as small as the source allows.
 *
 * Details are independent, so a few failures should not discard the catalog;
 * a widespread failure means the API changed or is down and is surfaced.
 */
import { httpJson } from "../../../lib/http";
import type { PortLink, PortSourceProject } from "../../../../../src/types/port";
import { cleanText, mapPool } from "./util";
import type { SourceFetchOptions } from "./types";

const SUMMARY_URL = "https://unbaked.games/api/games.json";
const SITE_URL = "https://unbaked.games";
const MAX_PROJECTS = 30_000;
const CONCURRENCY = 8;
const MAX_FAILURE_RATIO = 0.15;

const METHODS: Record<string, string> = {
  "static recomp": "Recompilation",
  "matching decomp": "Decompilation",
  decomp: "Decompilation",
  "ai-assisted decomp": "Decompilation",
  disassembly: "Disassembly",
  reimplementation: "Reimplementation",
  "source release": "Source release",
  "source port": "Source port",
  "native port": "Source port",
  "runtime port": "Source port",
  "readable bytecode": "Readable bytecode",
  "agent environment": "Agent environment",
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? cleanText(value) : "";
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => cleanText(entry))
    .filter(Boolean);
}

/** The first method the source lists is the project's primary approach. */
function originOf(value: unknown): string {
  for (const method of textList(value)) {
    return METHODS[method.toLowerCase()] ?? method;
  }
  return "";
}

function starsOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function linkKind(url: string): PortLink["kind"] {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  } catch {
    /* not a URL - treated as a website below */
  }
  return "website";
}

function linksOf(portName: string, rawUrl: string): PortLink[] {
  const url = cleanText(rawUrl);
  if (!/^https?:\/\//i.test(url)) return [];
  return [{ label: portName || url, url, kind: linkKind(url) }];
}

function detailUrl(slug: string): string {
  return `${SITE_URL}/api/games/${slug}.json`;
}

export function parseUnbakedGame(detail: unknown, slug: string): PortSourceProject[] {
  const game = record(detail);
  if (!game) return [];

  const title = text(game.title);
  const platform = text(game.platform);
  const rows = Array.isArray(game.projects) ? game.projects : [];
  const projects: PortSourceProject[] = [];

  for (const entry of rows) {
    if (projects.length >= MAX_PROJECTS) break;
    const project = record(entry);
    if (!project) continue;

    const portName = text(project.name);
    if (!portName) continue;

    // An empty project-level list means "same as the game", not "no targets".
    const ownTargets = textList(project.runs_on);
    projects.push({
      source: "unbaked",
      sourceUrl: `${SITE_URL}/games/${slug}/`,
      game: title,
      platform,
      portName,
      origin: originOf(project.methods),
      status: "",
      languages: text(project.toolchain),
      notes: [text(project.description), text(project.notes)].filter(Boolean).join(" — "),
      links: linksOf(portName, text(project.url)),
      stars: starsOf(project.stars),
      targets: ownTargets.length ? ownTargets : textList(game.runs_on),
      imageUrl: null,
      communityRating: null,
      realRating: null,
      group: "",
    });
  }

  return projects;
}

export async function fetchUnbakedProjects(
  options: SourceFetchOptions = {},
): Promise<PortSourceProject[]> {
  const summary = await httpJson<unknown>(SUMMARY_URL, { timeoutMs: 25_000, retries: 1 });
  const summaryRecord = record(summary);
  const entries = Array.isArray(summary)
    ? summary
    : Array.isArray(summaryRecord?.games)
      ? summaryRecord.games
      : [];

  const slugs: string[] = [];
  for (const entry of entries) {
    const game = record(entry);
    if (!game || game.has_public_code !== true) continue;
    const slug = text(game.slug);
    if (slug) slugs.push(slug);
  }

  const total = slugs.length;
  if (total === 0) return [];

  let done = 0;
  let failed = 0;
  const perGame = await mapPool(slugs, CONCURRENCY, async (slug) => {
    let projects: PortSourceProject[] = [];
    try {
      const detail = await httpJson<unknown>(detailUrl(slug), {
        timeoutMs: 15_000,
        retries: 1,
      });
      projects = parseUnbakedGame(detail, slug);
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[ports] unbaked detail skipped (${slug}): ${reason}`);
    }
    done += 1;
    options.onProgress?.({ done, total });
    return projects;
  });

  if (failed / total > MAX_FAILURE_RATIO) {
    throw new Error(`${failed} of ${total} unbaked game details failed`);
  }

  const projects: PortSourceProject[] = [];
  for (const batch of perGame) {
    for (const project of batch) {
      if (projects.length >= MAX_PROJECTS) return projects;
      projects.push(project);
    }
  }
  return projects;
}
