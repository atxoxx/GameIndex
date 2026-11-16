/**
 * Unofficial PC ports: static recompilations, decompilations, recreations and
 * wrappers, merged from several public catalogs.
 *
 * `PortSourceProject` is what one source adapter produces; `PortProject` is the
 * merged, renderer-facing row (sources, platforms, stars and rating folded in).
 */

export type PortSourceId =
  | "pcgamingwiki"
  | "gameport"
  | "recompfyi"
  | "unbaked"
  | "decomps";

export interface PortSourceRef {
  id: PortSourceId;
  name: string;
  /** Page for this project on that source. */
  url: string;
}

export type PortLinkKind = "github" | "gitlab" | "website";

export interface PortLink {
  label: string;
  url: string;
  /** Where the link points, derived from the host (used for icons). */
  kind: PortLinkKind;
}

/** One project row as a single source reports it. */
export interface PortSourceProject {
  source: PortSourceId;
  /** Canonical page for this project/entry on the source. */
  sourceUrl: string;
  /** The original game being ported. */
  game: string;
  /** Original platform, as the source labels it (`N64`, `PS1`, `PC`, ...). */
  platform: string;
  /** The project / fork name. */
  portName: string;
  /** `Recompilation`, `Decompilation`, `Source port`, ... */
  origin: string;
  /** `Playable`, `In progress`, `Planned`, ... */
  status: string;
  /** Source languages, comma-separated when several. */
  languages: string;
  notes: string;
  links: PortLink[];
  /** GitHub stars as reported by the source, when it has them. */
  stars: number | null;
  /** Supported targets in the source's own words (`Windows`, `Linux`, ...). */
  targets: string[];
  /** Cover/screenshot URL supplied by the source, when it has one. */
  imageUrl?: string | null;
  /** Community rating on a 0-5 scale, when the source provides one. */
  communityRating: number | null;
  /** PCGamingWiki's REAL AI-usage rating (0-5), when listed. */
  realRating: number | null;
  /** Vendor/family, when the source groups entries (`Nintendo`, `SEGA`, ...). */
  group?: string;
  /** Wiki/encyclopedia article for the original game, when one exists. */
  wikiUrl?: string;
}

/** The merged row the catalog and UI use. */
export interface PortProject extends PortSourceProject {
  /** Stable merged id. */
  id: string;
  /** Vendor/family for the details panel. */
  group: string;
  /** Every source that lists this project. */
  sources: PortSourceRef[];
  /** Canonical supported targets (`Windows`, `macOS`, `Linux`, ...). */
  platforms: string[];
}

export interface PortSourceSummary {
  id: PortSourceId;
  name: string;
  url: string;
  /** Rows this source contributed to the last merge. */
  count: number;
  ok: boolean;
  error?: string;
  fetchedAt: number;
}

export interface PortsCatalog {
  /** Human-facing description of the merged catalog. */
  source: string;
  /** When the merged payload was produced (ms epoch). */
  fetchedAt: number;
  /** True when one or more sources failed and a cached copy is in use. */
  stale: boolean;
  projects: PortProject[];
  sources: PortSourceSummary[];
  /** True while a background refresh is running. */
  syncing?: boolean;
}

/** Per-source progress during a sync. */
export interface PortSourceProgress {
  id: PortSourceId;
  /** Entries fetched so far. */
  done: number;
  /** Expected entries, 0 while unknown. */
  total: number;
  finished: boolean;
  ok: boolean;
  error?: string;
}

/** Live progress for the background sync, pushed to the Ports page. */
export interface PortsSyncProgress {
  active: boolean;
  startedAt: number | null;
  /** Projects in the current partial merge. */
  merged: number;
  sources: PortSourceProgress[];
}

/**
 * `ports:sync` event payload. `catalog` is present on source-done/done so the
 * page can paint rows as each catalog arrives instead of waiting for all five.
 */
export interface PortsSyncEvent {
  phase: "start" | "progress" | "source-done" | "done";
  version: number;
  syncing: boolean;
  progress: PortsSyncProgress;
  catalog?: PortsCatalog;
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

/** Display name + home page for every catalog source. */
export const PORT_SOURCES: Record<PortSourceId, { name: string; url: string }> = {
  gameport: { name: "gameport.games", url: "https://gameport.games/" },
  recompfyi: { name: "recomp.fyi", url: "https://recomp.fyi/" },
  unbaked: { name: "unbaked.games", url: "https://unbaked.games/" },
  decomps: { name: "decomps.net", url: "https://decomps.net/" },
  pcgamingwiki: { name: "PCGamingWiki", url: PORTS_SOURCE_URL },
};

/**
 * Trust order when two sources describe the same project. Gameport has the
 * richest status/rating data, then recomp.fyi, then the others.
 */
export const PORT_SOURCE_PRIORITY: PortSourceId[] = [
  "gameport",
  "recompfyi",
  "unbaked",
  "decomps",
  "pcgamingwiki",
];

/** Target platforms shown as badges on cards. */
export const PORT_CARD_PLATFORMS = ["Windows", "macOS", "Linux"] as const;

/** Orders status values so "sort by status" reads sensibly. */
export const PORT_STATUS_ORDER = [
  "playable",
  "complete",
  "released",
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
