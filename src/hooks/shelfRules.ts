import type { Game, LibrarySource } from "../types/game";
import { gameIsVr, parsePlayTime } from "../types/game";
import type { LibraryFilters } from "./libraryFilters";
import {
  gameMatchesSearchTokens,
  parseReleaseYear,
  tokenizeSearchQuery,
} from "./libraryFilters";
import type { ShelfRules } from "../types/shelf";

/** Options for evaluating a single game against a shelf. */
export interface ShelfEvalContext {
  /** The game's completion timestamp (unix ms) if known. */
  completedAt?: number;
  /** "Now" for relative date windows; defaults to `Date.now()`. */
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `LibrarySource` → the `Game.platform` string it maps to. */
const PLATFORM_BY_SOURCE: Record<Exclude<LibrarySource, "all">, string> = {
  steam: "Steam",
  local: "Local",
  gog: "GOG",
  epic: "Epic",
  humble: "Humble",
  rockstar: "Rockstar",
  ubisoft: "Ubisoft",
  battlenet: "Battle.net",
  ea: "EA",
  xbox: "Xbox",
  itch: "itch.io",
};

/** Case-insensitive intersection test between a game's values and a rule list. */
function includesAny(have: string[] | undefined, want: string[] | undefined): boolean {
  if (!want || want.length === 0) return true;
  if (!have || have.length === 0) return false;
  const lower = have.map((h) => h.toLowerCase());
  return want.some((w) => lower.includes(w.toLowerCase()));
}

/**
 * Evaluate a game against a shelf's rules. Every present rule must pass
 * (AND); arrays are OR within themselves. An empty rules object matches
 * every game.
 */
export function gameMatchesShelfRules(
  game: Game,
  rules: ShelfRules,
  ctx: ShelfEvalContext = {}
): boolean {
  const now = ctx.now ?? Date.now();

  if (rules.search) {
    const tokens = tokenizeSearchQuery(rules.search);
    if (tokens.length > 0 && !gameMatchesSearchTokens(game, tokens)) return false;
  }

  if (rules.status === "installed" && !game.installed) return false;
  if (rules.status === "not_installed" && game.installed) return false;

  if (rules.playStatus && rules.playStatus !== "all") {
    if ((game.playStatus || "backlog") !== rules.playStatus) return false;
  }

  if (rules.sources && rules.sources.length > 0) {
    const wanted = rules.sources
      .filter((s): s is Exclude<LibrarySource, "all"> => s !== "all")
      .map((s) => PLATFORM_BY_SOURCE[s]);
    if (!wanted.includes(game.platform)) return false;
  }

  if (rules.platforms && rules.platforms.length > 0) {
    if (!rules.platforms.includes(game.platform)) return false;
  }

  if (!includesAny(game.genres, rules.genres)) return false;
  if (!includesAny(game.gameModes, rules.modes)) return false;
  if (!includesAny(game.playerPerspectives, rules.perspectives)) return false;

  if (rules.vrOnly && !gameIsVr(game)) return false;

  if (rules.yearMin != null || rules.yearMax != null) {
    const year = parseReleaseYear(game.releaseDate);
    if (year == null) return false;
    if (rules.yearMin != null && year < rules.yearMin) return false;
    if (rules.yearMax != null && year > rules.yearMax) return false;
  }

  if (rules.ratingMin != null) {
    const rating = game.igdbRating ?? game.criticRating;
    if (rating == null || rating < rules.ratingMin) return false;
  }

  if (rules.playtimeMinHours != null || rules.playtimeMaxHours != null) {
    const hours = parsePlayTime(game.playTime) / 60;
    if (rules.playtimeMinHours != null && hours < rules.playtimeMinHours) return false;
    if (rules.playtimeMaxHours != null && hours > rules.playtimeMaxHours) return false;
  }

  if (rules.storyMinHours != null || rules.storyMaxHours != null) {
    const seconds = game.timeToBeat?.normally;
    if (seconds == null) return false;
    const hours = seconds / 3600;
    if (rules.storyMinHours != null && hours < rules.storyMinHours) return false;
    if (rules.storyMaxHours != null && hours > rules.storyMaxHours) return false;
  }

  if (rules.lastPlayedWithinDays != null) {
    if (game.lastPlayed == null) return false;
    if (now - game.lastPlayed > rules.lastPlayedWithinDays * DAY_MS) return false;
  }
  if (rules.lastPlayedBeforeDays != null) {
    if (game.lastPlayed == null) return false;
    if (now - game.lastPlayed < rules.lastPlayedBeforeDays * DAY_MS) return false;
  }
  if (rules.addedWithinDays != null) {
    if (now - (game.addedAt ?? 0) > rules.addedWithinDays * DAY_MS) return false;
  }
  if (rules.addedBeforeDays != null) {
    if (now - (game.addedAt ?? 0) < rules.addedBeforeDays * DAY_MS) return false;
  }

  if (rules.completedFrom != null || rules.completedTo != null) {
    const done = ctx.completedAt;
    if (done == null) return false;
    if (rules.completedFrom != null && done < rules.completedFrom) return false;
    if (rules.completedTo != null && done > rules.completedTo) return false;
  }

  return true;
}

/**
 * Narrow a library by a shelf's rules. `completedAtOf` supplies each
 * game's completion timestamp (the games table does not carry it), so
 * completion-date rules and sorting can work.
 */
export function filterGamesByShelf(
  games: Game[],
  rules: ShelfRules,
  completedAtOf?: (gameId: string) => number | undefined,
  now?: number
): Game[] {
  const hasCompletionRule = rules.completedFrom != null || rules.completedTo != null;
  if (!hasCompletionRule) {
    return games.filter((g) => gameMatchesShelfRules(g, rules, { now }));
  }
  return games.filter((g) =>
    gameMatchesShelfRules(g, rules, { completedAt: completedAtOf?.(g.id), now })
  );
}

/** Convert the current Library filters into a shelf rules object. */
export function rulesFromFilters(filters: LibraryFilters): ShelfRules {
  const rules: ShelfRules = {};
  if (filters.search.trim()) rules.search = filters.search.trim();
  if (filters.genres.length > 0) rules.genres = [...filters.genres];
  if (filters.platforms.length > 0) rules.platforms = [...filters.platforms];
  if (filters.yearMin != null) rules.yearMin = filters.yearMin;
  if (filters.yearMax != null) rules.yearMax = filters.yearMax;
  if (filters.ratingMin != null) rules.ratingMin = filters.ratingMin;
  if (filters.status !== "all") rules.status = filters.status;
  if (filters.source !== "all") rules.sources = [filters.source];
  if (filters.playStatus !== "all") rules.playStatus = filters.playStatus;
  if (filters.vrOnly) rules.vrOnly = true;
  return rules;
}

/** The facet subset of a shelf's rules that the Library can express directly. */
export function shelfRulesToFilters(rules: ShelfRules): Partial<LibraryFilters> {
  const partial: Partial<LibraryFilters> = {};
  if (rules.genres && rules.genres.length > 0) partial.genres = rules.genres;
  if (rules.platforms && rules.platforms.length > 0) partial.platforms = rules.platforms;
  if (rules.yearMin != null) partial.yearMin = rules.yearMin;
  if (rules.yearMax != null) partial.yearMax = rules.yearMax;
  if (rules.ratingMin != null) partial.ratingMin = rules.ratingMin;
  if (rules.status) partial.status = rules.status;
  if (rules.sources && rules.sources.length === 1) partial.source = rules.sources[0];
  if (rules.playStatus) partial.playStatus = rules.playStatus;
  if (rules.vrOnly) partial.vrOnly = true;
  return partial;
}
