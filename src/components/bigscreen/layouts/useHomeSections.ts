// Shared home-screen data for the five layouts.
//
// Business logic (what belongs in each shelf) is identical across
// layouts - only the composition differs, so it lives here once.

import { useMemo } from "react";
import type { Game } from "../../../types/game";
import { useGames } from "../../../context/GameContext";

export interface HomeSections {
  /** Everything in the library, unchanged. */
  all: Game[];
  /** Most recently played first. */
  continuePlaying: Game[];
  /** Latest additions, newest first. */
  recentlyAdded: Game[];
  /** User favourites (ROM favorite flag). */
  favorites: Game[];
  /** Installed right now, most recently played first. */
  installed: Game[];
  /** Highest reported playtime. */
  mostPlayed: Game[];
  /** A stable hero pool; the first entry is the default selection. */
  pool: Game[];
  /** Whole-library counts for summary strips. */
  installedCount: number;
  favoritesCount: number;
}

function uniqueById(games: Game[]): Game[] {
  const seen = new Set<string>();
  const out: Game[] = [];
  for (const game of games) {
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    out.push(game);
  }
  return out;
}

/** Parse "12h 30m" / "3.5h" / "45m" into minutes for sorting. */
export function playtimeMinutes(game: Game): number {
  if (typeof game.steamPlaytime === "number" && game.steamPlaytime > 0) {
    return game.steamPlaytime;
  }
  if (typeof game.gogPlaytime === "number" && game.gogPlaytime > 0) {
    return game.gogPlaytime;
  }
  const text = game.playTime ?? "";
  const hours = /([\d.]+)\s*h/i.exec(text);
  const minutes = /([\d.]+)\s*m/i.exec(text);
  return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
}

export function useHomeSections(): HomeSections {
  const { games } = useGames();

  return useMemo(() => {
    const played = [...games]
      .filter((game) => (game.lastPlayed ?? 0) > 0)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));

    const recentlyAdded = [...games]
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .slice(0, 16);

    const favorites = [...games]
      .filter((game) => game.favorite)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 16);

    const installed = [...games]
      .filter((game) => game.installed)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 16);

    const mostPlayed = [...games]
      .filter((game) => playtimeMinutes(game) > 0)
      .sort((a, b) => playtimeMinutes(b) - playtimeMinutes(a))
      .slice(0, 16);

    const continuePlaying = played.slice(0, 12);
    const pool = uniqueById([
      ...continuePlaying,
      ...installed,
      ...recentlyAdded,
      ...games,
    ]);

    return {
      all: games,
      continuePlaying,
      recentlyAdded,
      favorites,
      installed,
      mostPlayed,
      pool,
      installedCount: games.filter((game) => game.installed).length,
      favoritesCount: games.filter((game) => game.favorite).length,
    };
  }, [games]);
}
