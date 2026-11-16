/**
 * Unofficial PC ports: static recompilations, decompilations, recreations and
 * wrappers catalogued by PCGamingWiki's "List of unofficial ports".
 *
 * The catalog is fetched live from the wiki's MediaWiki API by the main
 * process; everything here is plain data so the renderer can filter, group and
 * sort without knowing how it was scraped.
 */

export type PortLinkKind = "github" | "gitlab" | "website";

export interface PortLink {
  label: string;
  url: string;
  /** Where the link points, derived from the host (used for icons). */
  kind: PortLinkKind;
}

/** One row of the wiki table: a project that ports one game. */
export interface PortProject {
  /** Stable id derived from the row's content. */
  id: string;
  /** The original game being ported. */
  game: string;
  /** The project / fork name. */
  portName: string;
  /** `Recompilation`, `Decompilation`, `Recreation`, `Wrapper`, ... */
  origin: string;
  /** `Playable`, `Development`, `Planned`, ... */
  status: string;
  /** Comma-separated source languages, as the wiki reports them. */
  languages: string;
  /** PCGamingWiki's REAL AI-usage rating (0-5), when listed. */
  realRating: number | null;
  notes: string;
  /** Console / platform section the row was listed under, e.g. `Nintendo 64`. */
  platform: string;
  /** Wiki top-level grouping, e.g. `Nintendo`, `SEGA`, `Microsoft`. */
  group: string;
  /** Project links (GitHub/GitLab/website), in wiki order. */
  links: PortLink[];
  /** PCGamingWiki article for the original game, when one exists. */
  wikiUrl?: string;
}

export interface PortsCatalog {
  /** Human-facing source page. */
  source: string;
  /** When the payload was scraped (ms epoch). */
  fetchedAt: number;
  /** True when the network failed and an older on-disk copy is being served. */
  stale: boolean;
  projects: PortProject[];
}

export interface PortRepoMeta {
  host: "github" | "gitlab";
  owner: string;
  repo: string;
  url: string;
  description: string | null;
  stars: number | null;
  language: string | null;
  updatedAt: string | null;
  license: string | null;
  topics: string[];
  homepage: string | null;
  openIssues: number | null;
}

export interface PortReadme {
  /** Markdown source; empty when the repo has no README. */
  markdown: string;
  /** The raw URL the markdown came from. */
  sourceUrl: string;
  /** Resolved repository metadata, when the host exposes it. */
  repo: PortRepoMeta | null;
  /** Set when the README could not be fetched (missing repo, offline). */
  error?: string;
}

export interface PortCover {
  /** Full-size portrait art. */
  url: string | null;
  /** Smaller art for grids; falls back to `url`. */
  thumbUrl: string | null;
  /** Landscape fallback used when `url` fails in the renderer. */
  fallbackUrl: string | null;
  source: "steamgriddb" | "steam" | null;
}

export const PORTS_SOURCE_URL = "https://www.pcgamingwiki.com/wiki/List_of_unofficial_ports";

/** Orders the wiki's status values so "sort by status" reads sensibly. */
export const PORT_STATUS_ORDER = [
  "playable",
  "in progress",
  "development",
  "pre-release",
  "planned",
] as const;

/** Canonical origin buckets; anything else is shown as-is. */
export const PORT_ORIGINS = [
  "Recompilation",
  "Decompilation",
  "Recreation",
  "Wrapper",
] as const;
