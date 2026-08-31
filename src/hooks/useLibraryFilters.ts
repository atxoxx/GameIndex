import { useMemo } from "react";
import type { Game } from "../types/game";
import { parsePlayTime } from "../types/game";
import { useLibraryFilterState } from "../context/LibraryFilterContext";
import {
  EMPTY_LIBRARY_FILTERS,
  filterGames,
  getSearchRelevanceScore,
  hasActiveFilters,
  sortGames,
  SORT_LABELS,
  SORT_OPTIONS,
  tokenizeSearchQuery,
  type LibraryFilters,
  type LibrarySort,
  type LibraryStatus,
} from "./libraryFilters";

export {
  EMPTY_LIBRARY_FILTERS,
  SORT_LABELS,
  SORT_OPTIONS,
  type LibraryFilters,
  type LibrarySort,
  type LibraryStatus,
};

/**
 * useLibraryFilters: filter state + derivation for the Library surface.
 *
 * The filter STATE (facets, sort, persistence) lives in the shared
 * `LibraryFilterContext`, so every consumer — the app Sidebar's game
 * list and the Library page — reads and writes the same live state.
 * This hook adds the per-consumer derivations that depend on the
 * `games` array it's called with:
 *   - **filteredGames** — narrowed + sorted game list
 *   - **availableGenres** / **availablePlatforms** — unique facet
 *     values from the source array (populate the filter rail)
 *   - **hasFilters** — true when any facet is active
 *
 * The return shape is deliberately identical to the pre-context hook so
 * swapping the implementation didn't ripple through callers.
 */
export function useLibraryFilters(games: Game[]) {
  const state = useLibraryFilterState();
  const { filters, ...handlers } = state;

  // Build unique, sorted facet lists from the source array so the sidebar
  // only shows values that actually exist in the user's library.
  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (const game of games) {
      if (game.genres) {
        for (const g of game.genres) {
          if (g) set.add(g);
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const game of games) {
      if (game.platform) set.add(game.platform);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const filteredGames = useMemo(() => {
    const narrowed = filterGames(games, filters);
    const q = filters.search.trim();
    if (q) {
      const tokens = tokenizeSearchQuery(q);
      // Relevance first, then existing sort as tie-breaker (FTS ranking)
      const ranked = [...narrowed];
      const scores = new Map<string, number>();
      for (const g of ranked) {
        scores.set(g.id, getSearchRelevanceScore(g, q, tokens));
      }
      const playtimes = filters.sort === "most_played" ? new Map<string, number>() : null;
      if (playtimes) {
        for (const g of ranked) playtimes.set(g.id, parsePlayTime(g.playTime));
      }
      ranked.sort((a, b) => {
        const sa = scores.get(a.id) ?? 0;
        const sb = scores.get(b.id) ?? 0;
        if (sb !== sa) return sb - sa;
        switch (filters.sort) {
          case "alphabetical":
            return a.name.localeCompare(b.name);
          case "date_added":
            return (b.addedAt ?? 0) - (a.addedAt ?? 0);
          case "most_played":
            return (playtimes?.get(b.id) ?? 0) - (playtimes?.get(a.id) ?? 0);
          case "recently_played":
            return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0);
          case "rating": {
            const ra = a.igdbRating ?? a.criticRating ?? 0;
            const rb = b.igdbRating ?? b.criticRating ?? 0;
            return rb - ra;
          }
          default:
            return 0;
        }
      });
      return ranked;
    }
    return sortGames(narrowed, filters.sort);
  }, [games, filters]);

  const hasFilters = useMemo(() => hasActiveFilters(filters), [filters]);

  return {
    filters,
    filteredGames,
    availableGenres,
    availablePlatforms,
    hasFilters,
    ...handlers,
  };
}
