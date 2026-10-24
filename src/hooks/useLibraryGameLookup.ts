import { useMemo } from "react";
import { useGames } from "../context/GameContext";
import { normalizeTitle } from "../utils/gameTitle";
import type { Game } from "../types/game";

/**
 * useLibraryGameLookup - resolve a title to the library game that owns it.
 *
 * Deal/giveaway/playtest modals use it to offer "open the game page" only when
 * the title is actually in the library (the game page renders library data, so
 * an unowned title has no page to open).
 */
export function useLibraryGameLookup(): (title: string) => Game | null {
  const { games } = useGames();

  const byTitle = useMemo(() => {
    const map = new Map<string, Game>();
    for (const game of games) {
      map.set(normalizeTitle(game.name), game);
    }
    return map;
  }, [games]);

  return useMemo(
    () => (title: string) => byTitle.get(normalizeTitle(title)) ?? null,
    [byTitle],
  );
}
