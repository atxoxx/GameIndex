import { useMemo } from "react";
import type { Game, PlayStatus } from "../types/game";

export interface LibraryFacetCounts {
  total: number;
  installed: number;
  notInstalled: number;
  /** How many games currently sit in each play status. */
  playStatus: Record<PlayStatus, number>;
  /** Per-platform (store) counts, keyed by `Game.platform`. */
  sources: Record<string, number>;
  /** Per-genre counts — a game counts once per genre it carries. */
  genres: Record<string, number>;
  /** Per-release-year counts, keyed by the four-digit year as a string. */
  years: Record<string, number>;
}

const EMPTY_PLAY_STATUS: Record<PlayStatus, number> = {
  backlog: 0,
  playing: 0,
  completed: 0,
  on_hold: 0,
  abandoned: 0,
};

/**
 * useLibraryFacetCounts — one pass over the library that produces the numbers
 * the scope ribbon and the filter drawer show next to every option.
 *
 * Counts are always computed against the whole library (not the current
 * result set) so the numbers stay stable while a filter is being edited
 * instead of cascading to zero as the user narrows things down.
 */
export function useLibraryFacetCounts(games: Game[]): LibraryFacetCounts {
  return useMemo(() => {
    const playStatus = { ...EMPTY_PLAY_STATUS };
    const sources: Record<string, number> = {};
    const genres: Record<string, number> = {};
    const years: Record<string, number> = {};
    let installed = 0;

    for (const game of games) {
      const status = (game.playStatus ?? "backlog") as PlayStatus;
      if (status in playStatus) playStatus[status] += 1;

      if (game.installed) installed += 1;

      if (game.platform) {
        sources[game.platform] = (sources[game.platform] ?? 0) + 1;
      }

      if (game.genres) {
        for (const genre of game.genres) {
          if (genre) genres[genre] = (genres[genre] ?? 0) + 1;
        }
      }

      const year = game.releaseDate?.slice(0, 4);
      if (year && /^\d{4}$/.test(year)) {
        years[year] = (years[year] ?? 0) + 1;
      }
    }

    return {
      total: games.length,
      installed,
      notInstalled: games.length - installed,
      playStatus,
      sources,
      genres,
      years,
    };
  }, [games]);
}
