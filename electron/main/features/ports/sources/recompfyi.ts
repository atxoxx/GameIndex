/**
 * recomp.fyi adapter.
 *
 * The site publishes its whole catalog as one static JSON document, so a single
 * request returns every row; there is no paging or HTML scraping. Values are
 * kept as the source writes them (system labels, targets) because the merge
 * step owns canonicalization.
 */
import { httpJson } from "../../../lib/http";
import type { PortLink, PortSourceProject } from "../../../../../src/types/port";
import { cleanText } from "./util";
import type { SourceFetchOptions } from "./types";

const DATA_URL = "https://recomp.fyi/data/projects.json";
const SITE_URL = "https://recomp.fyi";
const MAX_PROJECTS = 10_000;

const ORIGINS: Record<string, string> = {
  recomp: "Recompilation",
  decomp: "Decompilation",
  port: "Port",
};

/** `unknown` is deliberately blank: the site uses it for "no status set". */
const STATUSES: Record<string, string> = {
  playable: "Playable",
  "in-progress": "In progress",
  released: "Released",
  complete: "Complete",
  paused: "Paused",
  exploring: "Exploring",
  unknown: "",
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

function platformOf(value: unknown): string {
  // Some rows list several systems; the first one is the game's primary system.
  if (Array.isArray(value)) return text(value[0]);
  return text(value);
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function originOf(value: unknown): string {
  const raw = text(value).toLowerCase();
  return ORIGINS[raw] ?? titleCase(raw);
}

function statusOf(value: unknown): string {
  const raw = text(value).toLowerCase();
  return raw in STATUSES ? STATUSES[raw] : titleCase(raw);
}

function notesOf(row: Record<string, unknown>): string {
  return [text(row.description), text(row.notes)].filter(Boolean).join(" — ");
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

/** The repo leads, then any extra links; a URL may appear in both, so dedupe. */
function linksOf(row: Record<string, unknown>): PortLink[] {
  const links: PortLink[] = [];
  const seen = new Set<string>();
  const add = (rawUrl: string, rawLabel: string) => {
    const url = cleanText(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ label: cleanText(rawLabel) || url, url, kind: linkKind(url) });
  };

  add(text(row.repo), "");
  const extra = Array.isArray(row.links) ? row.links : [];
  for (const entry of extra) {
    const link = record(entry);
    if (!link) continue;
    add(text(link.url), text(link.label));
  }
  return links;
}

function union(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const group of groups) {
    for (const target of group) {
      if (seen.has(target)) continue;
      seen.add(target);
      targets.push(target);
    }
  }
  return targets;
}

export function parseRecompfyiPayload(payload: unknown): PortSourceProject[] {
  const root = record(payload);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.projects)
      ? root.projects
      : [];
  const projects: PortSourceProject[] = [];

  for (const entry of rows) {
    if (projects.length >= MAX_PROJECTS) break;
    const row = record(entry);
    if (!row) continue;

    const game = text(row.game);
    const portName = text(row.project);
    // Rows without a game or a project name cannot be merged or displayed.
    if (!game || !portName) continue;

    const page = text(row.page);
    projects.push({
      source: "recompfyi",
      sourceUrl: page.startsWith("/") ? `${SITE_URL}${page}` : `${SITE_URL}/`,
      game,
      platform: platformOf(row.system),
      portName,
      origin: originOf(row.type),
      status: statusOf(row.status),
      languages: text(row.language),
      notes: notesOf(row),
      links: linksOf(row),
      stars: null,
      targets: union(textList(row.targets), textList(row.builds)),
      communityRating: null,
      realRating: null,
      group: "",
    });
  }

  return projects;
}

export async function fetchRecompfyiProjects(
  options: SourceFetchOptions = {},
): Promise<PortSourceProject[]> {
  const payload = await httpJson<unknown>(DATA_URL, { timeoutMs: 25_000, retries: 1 });
  const projects = parseRecompfyiPayload(payload);
  options.onProgress?.({ done: projects.length, total: projects.length });
  return projects;
}
