import { useMemo } from "react";
import { useOptionalGames } from "../../context/GameContext";
import type { OverlaySession } from "../../context/OverlayContext";
import type { Game } from "../../types/game";

/** Resolve a session's library entry from a games list. Pure, so widgets that
 * already hold the list can reuse it without another context read. */
export function findSessionGame(
  session: OverlaySession | null,
  games: Game[],
  runningGameIds: string[],
): Game | null {
  if (session?.gameId) {
    const match = games.find(
      (game) =>
        game.id === session.gameId || String(game.id) === String(session.gameId),
    );
    if (match) return match;
  }
  if (runningGameIds.length > 0) {
    return (
      games.find(
        (game) =>
          game.id === runningGameIds[0] ||
          String(game.id) === String(runningGameIds[0]),
      ) ?? null
    );
  }
  return null;
}

/**
 * Resolve the library entry behind the HUD's session. Falls back to the first
 * running game when the watcher has not published a session yet, and returns
 * null for externally detected titles (they have no library row).
 */
export function useOverlayGame(session: OverlaySession | null): Game | null {
  const ctx = useOptionalGames();
  const games = ctx?.games ?? [];
  const runningGameIds = ctx?.runningGameIds ?? [];

  return useMemo(
    () => findSessionGame(session, games, runningGameIds),
    [session, games, runningGameIds],
  );
}
