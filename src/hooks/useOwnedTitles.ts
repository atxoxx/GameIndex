import { useMemo } from "react";
import { useGames } from "../context/GameContext";
import { normalizeTitle } from "../utils/gameTitle";

/**
 * useOwnedTitles - one normalised title set for the library.
 *
 * Deal, giveaway and game-pass cards all need the same "do I already own
 * this?" check. Building the set once per library change (instead of a
 * `games.some(...)` scan inside every card) keeps a 300-card grid from doing
 * 300 full library scans on each render.
 */
export function useOwnedTitles(): (title: string) => boolean {
  const { games } = useGames();

  const owned = useMemo(
    () => new Set(games.map((game) => normalizeTitle(game.name))),
    [games],
  );

  return useMemo(
    () => (title: string) => owned.has(normalizeTitle(title)),
    [owned],
  );
}
