import type { Game, LibrarySource, PlayStatus } from "../types/game";
import { parsePlayTime } from "../types/game";

/** Status facets for the library filter sidebar. */
export type LibraryStatus = "all" | "installed" | "not_installed";

/** Sort order for the library grid. */
export type LibrarySort =
  | "alphabetical"
  | "date_added"
  | "most_played"
  | "recently_played"
  | "rating";

/** Label for each sort option (used in dropdown). */
export const SORT_LABELS: Record<LibrarySort, string> = {
  alphabetical: "Alphabetical (A–Z)",
  date_added: "Date Added (Newest)",
  most_played: "Most Played",
  recently_played: "Recently Played",
  rating: "Highest Rated",
};

/** All sort options in dropdown order. */
export const SORT_OPTIONS: readonly LibrarySort[] = [
  "alphabetical",
  "date_added",
  "most_played",
  "recently_played",
  "rating",
];

/**
 * Active filter set for the Library page. All fields are optional; an empty
 * value on a facet means "no constraint from this facet". Mirrors the shape
 * of `useStoreGames.StoreGamesFilters` (Store uses an async backend; Library
 * is local and filters in memory).
 */
export interface LibraryFilters {
  /** Free-text search across name + metadata; case-insensitive tokenized match. */
  search: string;
  /** Genre names; the game must include at least one of these (OR). */
  genres: string[];
  /** Platform names (matches `Game.platform` exactly). */
  platforms: string[];
  /** Lower bound on the release year (parsed from `Game.releaseDate`). */
  yearMin: number | null;
  /** Upper bound on the release year. */
  yearMax: number | null;
  /** Minimum IGDB / critic rating (0–100 inclusive). */
  ratingMin: number | null;
  /** Installation status filter. */
  status: LibraryStatus;
  /** Source platform filter (all | steam | local | gog). */
  source: LibrarySource;
  /** Play gameplay status filter (all | backlog | playing | completed | abandoned | on_hold). */
  playStatus: PlayStatus | "all";
  /** Sort order for the filtered list. */
  sort: LibrarySort;
}

/** Sentinel for "no filter selected from any facet". */
export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  search: "",
  genres: [],
  platforms: [],
  yearMin: null,
  yearMax: null,
  ratingMin: null,
  status: "all",
  source: "all",
  playStatus: "all",
  sort: "alphabetical",
};

/**
 * Extract the 4-digit release year from a free-form date string.
 * Handles "2023-05-15", "May 15, 2023", "2023", and ISO timestamps.
 * Returns `null` for missing or malformed values.
 */
export function parseReleaseYear(releaseDate: string | undefined | null): number | null {
  if (!releaseDate) return null;
  const head = releaseDate.substring(0, 4);
  const year = parseInt(head, 10);
  if (!Number.isFinite(year) || year < 1970 || year > 2100) return null;
  return year;
}

// ─── Search 2.0: tokenized + multi-field + FTS ranking ─────────────────────

/**
 * Split a free-text query into normalized tokens.
 * Lower-cases, trims, splits on whitespace. Empty query → [].
 * Exported for testing.
 */
export function tokenizeSearchQuery(query: string): string[] {
  if (!query) return [];
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/**
 * Collect all searchable text fields from a game, lower-cased.
 * Includes name, developer, publisher, genres, tags (if present),
 * description, alternativeNames, collection, franchise, themes, storyline.
 * Exported for testing.
 */
export function getGameSearchFields(game: Game): string[] {
  const fields: string[] = [];
  if (game.name) fields.push(game.name.toLowerCase());
  if (game.developer) fields.push(game.developer.toLowerCase());
  if (game.publisher) fields.push(game.publisher.toLowerCase());
  if (game.description) fields.push(game.description.toLowerCase());
  if (game.storyline) fields.push(game.storyline.toLowerCase());
  if (game.collection) fields.push(game.collection.toLowerCase());
  if (game.franchise) fields.push(game.franchise.toLowerCase());
  if (game.genres) {
    for (const g of game.genres) if (g) fields.push(g.toLowerCase());
  }
  // Optional tags field (future-proof; not on current Game type but may exist on raw data)
  const tags = (game as unknown as { tags?: string[] }).tags;
  if (Array.isArray(tags)) {
    for (const t of tags) if (typeof t === "string" && t) fields.push(t.toLowerCase());
  }
  if (game.themes) {
    for (const t of game.themes) if (t) fields.push(t.toLowerCase());
  }
  if (game.alternativeNames) {
    for (const n of game.alternativeNames) if (n) fields.push(n.toLowerCase());
  }
  // Also include gameModes / perspectives as low-weight searchable noise
  if (game.gameModes) {
    for (const m of game.gameModes) if (m) fields.push(m.toLowerCase());
  }
  if (game.playerPerspectives) {
    for (const p of game.playerPerspectives) if (p) fields.push(p.toLowerCase());
  }
  return fields;
}

/**
 * True if every token appears as a substring in at least one searchable field.
 * Tokenized AND — e.g. "rpg ubisoft" requires both tokens to match somewhere.
 * Exported for testing.
 */
export function gameMatchesSearchTokens(game: Game, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const fields = getGameSearchFields(game);
  // Also include name already in fields; but we need to ensure fields not empty
  // Every token must match some field
  return tokens.every((tok) => fields.some((f) => f.includes(tok)));
}

/**
 * Simple FTS relevance score for a game given a normalized query + tokens.
 * Tiers (higher = more relevant):
 *   100 — exact name match (name === query)
 *    80 — prefix match (name startsWith query)
 *    60 — name contains contiguous query substring
 *    50 — every token found in name (non-contiguous, e.g. multi-token)
 *    30 — high-value metadata match (developer/publisher/genres/tags/themes/collection/franchise)
 *    20 — low-value metadata match (description/storyline/alternativeNames)
 *     0 — no match (should not happen for filtered set)
 * Exported for testing / ranking.
 */
export function getSearchRelevanceScore(game: Game, normalizedQuery: string, tokens: string[]): number {
  if (!normalizedQuery || tokens.length === 0) return 0;
  const q = normalizedQuery.toLowerCase().trim();
  const nameLower = (game.name || "").toLowerCase().trim();

  if (nameLower === q) return 100;
  if (q && nameLower.startsWith(q)) return 80;
  if (q && nameLower.includes(q)) return 60;
  if (tokens.length > 0 && tokens.every((t) => nameLower.includes(t))) return 50;

  // Metadata tiering
  const highFields: string[] = [];
  const lowFields: string[] = [];
  if (game.developer) highFields.push(game.developer.toLowerCase());
  if (game.publisher) highFields.push(game.publisher.toLowerCase());
  if (game.genres) for (const g of game.genres) if (g) highFields.push(g.toLowerCase());
  const tags = (game as unknown as { tags?: string[] }).tags;
  if (Array.isArray(tags)) for (const t of tags) if (typeof t === "string" && t) highFields.push(t.toLowerCase());
  if (game.themes) for (const t of game.themes) if (t) highFields.push(t.toLowerCase());
  if (game.collection) highFields.push(game.collection.toLowerCase());
  if (game.franchise) highFields.push(game.franchise.toLowerCase());

  if (game.description) lowFields.push(game.description.toLowerCase());
  if (game.storyline) lowFields.push(game.storyline.toLowerCase());
  if (game.alternativeNames) for (const n of game.alternativeNames) if (n) lowFields.push(n.toLowerCase());

  // Determine if all tokens are satisfied by high-value fields
  const allInHigh = tokens.every((tok) => highFields.some((f) => f.includes(tok)));
  if (allInHigh && highFields.length > 0) return 30;
  // Otherwise it's a low metadata match (still filtered, so must be somewhere)
  // Verify at least low fields contain tokens, else fallback to 20
  return 20;
}

/**
 * Convenience wrapper: tokenize + score.
 * Exported for testing.
 */
export function getSearchScore(game: Game, query: string): number {
  const tokens = tokenizeSearchQuery(query);
  return getSearchRelevanceScore(game, query, tokens);
}

/**
 * Sort a game list by search relevance descending (stable). Primary = relevance,
 * secondary = original order. Does not mutate input.
 * Exported for testing / use in filter pipeline.
 */
export function sortBySearchRelevance(games: Game[], query: string): Game[] {
  if (!query.trim()) return [...games];
  const tokens = tokenizeSearchQuery(query);
  const q = query.toLowerCase().trim();
  const scored = games.map((g, idx) => ({ game: g, score: getSearchRelevanceScore(g, q, tokens), idx }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });
  return scored.map((s) => s.game);
}

/** True if `game` passes every active facet in `filters`. */
export function gameMatchesFilters(game: Game, filters: LibraryFilters): boolean {
  // Search: tokenized multi-field (name + developer + publisher + genres + tags + description)
  if (filters.search) {
    const tokens = tokenizeSearchQuery(filters.search);
    if (tokens.length > 0 && !gameMatchesSearchTokens(game, tokens)) return false;
  }

  // Status
  if (filters.status === "installed" && !game.installed) return false;
  if (filters.status === "not_installed" && game.installed) return false;

  // Play Status
  if (filters.playStatus !== "all") {
    const currentPlayStatus = game.playStatus || "backlog";
    if (currentPlayStatus !== filters.playStatus) return false;
  }

  // Source filter
  if (filters.source !== "all") {
    if (filters.source === "steam" && game.platform !== "Steam") return false;
    if (filters.source === "local" && game.platform !== "Local") return false;
    if (filters.source === "gog" && game.platform !== "GOG") return false;
    if (filters.source === "epic" && game.platform !== "Epic") return false;
    if (filters.source === "humble" && game.platform !== "Humble") return false;
    if (filters.source === "rockstar" && game.platform !== "Rockstar") return false;
    if (filters.source === "ubisoft" && game.platform !== "Ubisoft") return false;
  }

  // Genres (OR — game must have at least one selected genre)
  if (filters.genres.length > 0) {
    if (!game.genres || game.genres.length === 0) return false;
    const lowerGenres = game.genres.map((g) => g.toLowerCase());
    const hasMatch = filters.genres.some((g) =>
      lowerGenres.includes(g.toLowerCase())
    );
    if (!hasMatch) return false;
  }

  // Platforms (exact match against `game.platform`)
  if (filters.platforms.length > 0) {
    if (!filters.platforms.includes(game.platform)) return false;
  }

  // Year range
  if (filters.yearMin != null || filters.yearMax != null) {
    const year = parseReleaseYear(game.releaseDate);
    if (year == null) return false;
    if (filters.yearMin != null && year < filters.yearMin) return false;
    if (filters.yearMax != null && year > filters.yearMax) return false;
  }

  // Rating (prefer IGDB community rating, fall back to critic rating)
  if (filters.ratingMin != null) {
    const rating = game.igdbRating ?? game.criticRating;
    if (rating == null || rating < filters.ratingMin) return false;
  }

  return true;
}

/** True when any facet (besides sort) constrains the list. */
export function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.search.length > 0 ||
    filters.genres.length > 0 ||
    filters.platforms.length > 0 ||
    filters.yearMin != null ||
    filters.yearMax != null ||
    filters.ratingMin != null ||
    filters.status !== "all" ||
    filters.source !== "all" ||
    filters.playStatus !== "all"
  );
}

/**
 * Parse and sanitize a LibraryFilters object from localStorage JSON.
 * Validates each field individually and falls back to EMPTY_LIBRARY_FILTERS
 * defaults for any invalid/missing fields, so corrupted stored data can't
 * crash the app.
 */
export function parseStoredFilters(raw: unknown): LibraryFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_LIBRARY_FILTERS;
  }
  const obj = raw as Record<string, unknown>;
  return {
    search: typeof obj.search === "string" ? obj.search : "",
    genres: Array.isArray(obj.genres) ? obj.genres.filter((g): g is string => typeof g === "string") : [],
    platforms: Array.isArray(obj.platforms) ? obj.platforms.filter((p): p is string => typeof p === "string") : [],
    yearMin: typeof obj.yearMin === "number" && Number.isFinite(obj.yearMin) ? obj.yearMin : null,
    yearMax: typeof obj.yearMax === "number" && Number.isFinite(obj.yearMax) ? obj.yearMax : null,
    ratingMin: typeof obj.ratingMin === "number" && Number.isFinite(obj.ratingMin) ? obj.ratingMin : null,
    status: obj.status === "installed" || obj.status === "not_installed" ? obj.status : "all",
    source:
      obj.source === "steam" ||
      obj.source === "local" ||
      obj.source === "gog" ||
      obj.source === "epic" ||
      obj.source === "humble" ||
      obj.source === "rockstar" ||
      obj.source === "ubisoft"
        ? obj.source
        : "all",
    playStatus:
      obj.playStatus === "backlog" ||
      obj.playStatus === "playing" ||
      obj.playStatus === "completed" ||
      obj.playStatus === "abandoned" ||
      obj.playStatus === "on_hold"
        ? (obj.playStatus as PlayStatus)
        : "all",
    sort:
      obj.sort === "date_added" ||
      obj.sort === "most_played" ||
      obj.sort === "recently_played" ||
      obj.sort === "rating"
        ? obj.sort
        : "alphabetical",
  };
}

/** Narrow `games` by `filters` (skipping the sort facet). */
export function filterGames(games: Game[], filters: LibraryFilters): Game[] {
  return hasActiveFilters(filters)
    ? games.filter((g) => gameMatchesFilters(g, filters))
    : games;
}

/** Apply the sort facet to a (possibly narrowed) game list. */
export function sortGames(games: Game[], sort: LibrarySort): Game[] {
  const sorted = [...games];
  switch (sort) {
    case "alphabetical":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "date_added":
      sorted.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
      break;
    case "most_played":
      sorted.sort((a, b) => parsePlayTime(b.playTime) - parsePlayTime(a.playTime));
      break;
    case "recently_played":
      // Never-played games (no lastPlayed) sink to the bottom.
      sorted.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
      break;
    case "rating":
      sorted.sort((a, b) => {
        const ra = a.igdbRating ?? a.criticRating ?? 0;
        const rb = b.igdbRating ?? b.criticRating ?? 0;
        return rb - ra;
      });
      break;
  }
  return sorted;
}

// ─── Saved Presets (localStorage) ───────────────────────────────────────────

export const FILTER_PRESETS_STORAGE_KEY = "gameindex:filter-presets";
export const FILTER_PRESETS_MAX = 10;

/** A saved filter preset — filters without free-text search + explicit sort. */
export interface FilterPreset {
  id: string;
  name: string;
  /** Filter facets without `search`; includes all other facets and excludes the transient query. */
  filters: Omit<LibraryFilters, "search">;
  sort: LibrarySort;
}

/**
 * Sanitize a single preset from raw JSON. Returns null if invalid.
 */
export function parseStoredPreset(raw: unknown): FilterPreset | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id) return null;
  if (typeof obj.name !== "string" || !obj.name.trim()) return null;
  if (!obj.filters || typeof obj.filters !== "object" || Array.isArray(obj.filters)) return null;
  const f = obj.filters as Record<string, unknown>;
  // Validate sort
  const sortRaw = obj.sort;
  const sort: LibrarySort =
    sortRaw === "date_added" ||
    sortRaw === "most_played" ||
    sortRaw === "recently_played" ||
    sortRaw === "rating"
      ? (sortRaw as LibrarySort)
      : "alphabetical";
  // Filters sort fallback is alphabetical; prefer f.sort if present else top-level sort
  const filtersSort: LibrarySort =
    f.sort === "date_added" ||
    f.sort === "most_played" ||
    f.sort === "recently_played" ||
    f.sort === "rating"
      ? (f.sort as LibrarySort)
      : sort;

  const filters: Omit<LibraryFilters, "search"> = {
    genres: Array.isArray(f.genres) ? f.genres.filter((g): g is string => typeof g === "string") : [],
    platforms: Array.isArray(f.platforms) ? f.platforms.filter((p): p is string => typeof p === "string") : [],
    yearMin: typeof f.yearMin === "number" && Number.isFinite(f.yearMin) ? f.yearMin : null,
    yearMax: typeof f.yearMax === "number" && Number.isFinite(f.yearMax) ? f.yearMax : null,
    ratingMin: typeof f.ratingMin === "number" && Number.isFinite(f.ratingMin) ? f.ratingMin : null,
    status: f.status === "installed" || f.status === "not_installed" ? f.status : "all",
    source:
      f.source === "steam" ||
      f.source === "local" ||
      f.source === "gog" ||
      f.source === "epic" ||
      f.source === "humble" ||
      f.source === "rockstar" ||
      f.source === "ubisoft"
        ? (f.source as LibrarySource)
        : "all",
    playStatus:
      f.playStatus === "backlog" ||
      f.playStatus === "playing" ||
      f.playStatus === "completed" ||
      f.playStatus === "abandoned" ||
      f.playStatus === "on_hold"
        ? (f.playStatus as PlayStatus)
        : "all",
    sort: filtersSort,
  };

  return {
    id: obj.id,
    name: obj.name.trim(),
    filters,
    sort: filtersSort,
  };
}

/** Parse and sanitize an array of presets from localStorage JSON. */
export function parseStoredPresets(raw: unknown): FilterPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterPreset[] = [];
  for (const item of raw) {
    const p = parseStoredPreset(item);
    if (p) out.push(p);
  }
  return out.slice(0, FILTER_PRESETS_MAX);
}

/** Load presets from localStorage (safe, returns [] on failure). */
export function loadFilterPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(FILTER_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    return parseStoredPresets(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Persist presets to localStorage (cap at MAX). */
export function saveFilterPresets(presets: FilterPreset[]): void {
  try {
    const capped = presets.slice(0, FILTER_PRESETS_MAX);
    localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // storage may be unavailable
  }
}
