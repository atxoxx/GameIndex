import type { LibrarySource, PlayStatus } from "./game";
import type { LibrarySort, LibraryStatus } from "../hooks/libraryFilters";

/**
 * Smart Shelf rules — a named, auto-updating query over the library.
 *
 * Every field is optional and an absent/null value means "no constraint
 * from this facet". Multiple rules combine with AND (a game must pass
 * every present rule); a multi-value array is OR within itself (the game
 * must match at least one of the listed values). This mirrors the shape
 * of `LibraryFilters` and extends it with numeric, date and mode rules.
 */
export interface ShelfRules {
  /** Free-text, tokenised AND match across searchable fields. */
  search?: string;
  /** Genre names; matches any listed genre. */
  genres?: string[];
  /** Exact `Game.platform` values. */
  platforms?: string[];
  /** Store sources (Steam/GOG/Epic/…). */
  sources?: LibrarySource[];
  /** Installation status. */
  status?: LibraryStatus;
  /** Play status (backlog/playing/completed/…). */
  playStatus?: PlayStatus | "all";
  /** Virtual-reality titles only. */
  vrOnly?: boolean;
  /** Release-year bounds (inclusive). */
  yearMin?: number | null;
  yearMax?: number | null;
  /** Minimum IGDB/critic rating (0–100). */
  ratingMin?: number | null;
  /** IGDB game modes (e.g. "Co-operative", "Multiplayer"). */
  modes?: string[];
  /** IGDB player perspectives (e.g. "First person"). */
  perspectives?: string[];
  /** Total playtime bounds, in hours. `playtimeMaxHours: 0` = never played. */
  playtimeMinHours?: number | null;
  playtimeMaxHours?: number | null;
  /** "Played within the last N days." */
  lastPlayedWithinDays?: number | null;
  /** "Not played for at least N days" (requires a known last-played). */
  lastPlayedBeforeDays?: number | null;
  /** "Added to the library within the last N days." */
  addedWithinDays?: number | null;
  /** "Added at least N days ago." */
  addedBeforeDays?: number | null;
  /** Completion-date window (unix ms, inclusive). */
  completedFrom?: number | null;
  completedTo?: number | null;
  /** Main-story length bounds, in hours (HLTB). */
  storyMinHours?: number | null;
  storyMaxHours?: number | null;
}

/**
 * A persisted shelf. `rules` defines membership, `sort` is applied to the
 * Library when the shelf is activated, `pinned` surfaces it as a Home rail
 * and `position` is the drag order in the sidebar.
 */
export interface Shelf {
  id: string;
  name: string;
  icon: string;
  color: string;
  rules: ShelfRules;
  sort: LibrarySort;
  pinned: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
}

/** Upper bound shared with the Rust DAO (`db::shelves::MAX_SHELVES`). */
export const MAX_SHELVES = 30;

/** A rules object that constrains nothing (matches the whole library). */
export const DEFAULT_SHELF_RULES: ShelfRules = {};

/** Accent colors offered by the shelf builder (all map to theme tokens). */
export const SHELF_COLORS = [
  "accent",
  "info",
  "success",
  "warning",
  "danger",
  "ingame",
  "stale",
] as const;

export type ShelfColor = (typeof SHELF_COLORS)[number];

/** Lucide icon names offered by the shelf builder. */
export const SHELF_ICONS = [
  "layers",
  "clock",
  "zap",
  "users",
  "trophy",
  "sparkles",
  "heart",
  "star",
  "gamepad-2",
  "bookmark",
  "flame",
  "timer",
] as const;

export type ShelfIcon = (typeof SHELF_ICONS)[number];

const VALID_STATUS: LibraryStatus[] = ["all", "installed", "not_installed"];
const VALID_PLAY_STATUS: PlayStatus[] = [
  "backlog",
  "playing",
  "completed",
  "abandoned",
  "on_hold",
];
const VALID_SOURCE: LibrarySource[] = [
  "steam",
  "local",
  "gog",
  "epic",
  "humble",
  "rockstar",
  "ubisoft",
  "battlenet",
  "ea",
  "xbox",
  "itch",
];

function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return out.length > 0 ? out : undefined;
}

function num(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Sanitize an untrusted rules object. Unknown/invalid fields are dropped so
 * corrupted stored data can never crash the evaluator.
 */
export function parseShelfRules(raw: unknown): ShelfRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const rules: ShelfRules = {};

  if (typeof o.search === "string" && o.search.trim()) rules.search = o.search;
  const genres = strArray(o.genres);
  if (genres) rules.genres = genres;
  const platforms = strArray(o.platforms);
  if (platforms) rules.platforms = platforms;
  const sources = strArray(o.sources)?.filter((s): s is LibrarySource =>
    (VALID_SOURCE as string[]).includes(s)
  );
  if (sources && sources.length > 0) rules.sources = sources;
  if (typeof o.status === "string" && (VALID_STATUS as string[]).includes(o.status) && o.status !== "all")
    rules.status = o.status as LibraryStatus;
  if (
    typeof o.playStatus === "string" &&
    o.playStatus !== "all" &&
    (VALID_PLAY_STATUS as string[]).includes(o.playStatus)
  )
    rules.playStatus = o.playStatus as PlayStatus;
  const modes = strArray(o.modes);
  if (modes) rules.modes = modes;
  const perspectives = strArray(o.perspectives);
  if (perspectives) rules.perspectives = perspectives;
  if (o.vrOnly === true) rules.vrOnly = true;

  const numericKeys: (keyof ShelfRules)[] = [
    "yearMin",
    "yearMax",
    "ratingMin",
    "playtimeMinHours",
    "playtimeMaxHours",
    "lastPlayedWithinDays",
    "lastPlayedBeforeDays",
    "addedWithinDays",
    "addedBeforeDays",
    "completedFrom",
    "completedTo",
    "storyMinHours",
    "storyMaxHours",
  ];
  for (const key of numericKeys) {
    const v = num(o[key as string]);
    if (v !== undefined) (rules as Record<string, unknown>)[key] = v;
  }
  return rules;
}

/** Number of active constraints in a rules object. */
export function countShelfRules(rules: ShelfRules): number {
  let n = 0;
  for (const value of Object.values(rules)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) n += 1;
    } else if (value === false) {
      continue;
    } else if (typeof value === "string") {
      if (value.trim() !== "") n += 1;
    } else {
      n += 1;
    }
  }
  return n;
}

/** True when the rules object constrains nothing (an "all games" shelf). */
export function isShelfEmpty(rules: ShelfRules): boolean {
  return countShelfRules(rules) === 0;
}

/**
 * Resolve a shelf's display name. Starter shelves persist an i18n key
 * (`shelves.starter.*`) rather than a fixed string, so they follow the
 * active language; every other name is shown verbatim.
 */
export function shelfDisplayName(name: string, t: (key: string) => string): string {
  return name.startsWith("shelves.starter.") ? t(name) : name;
}
