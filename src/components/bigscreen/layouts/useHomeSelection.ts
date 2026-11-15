// Shared selection state for the home layouts.
//
// The focused card is the page's single source of truth: hero art,
// title, description, actions and the "now selected" strip all read
// from it. `useFocusedGame` re-resolves the remembered id against the
// current pool, so a launch or resort can never leave a stale game on
// screen.

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../../types/game";
import { PLAY_STATUS_DETAILS } from "../../../types/game";
import { useGames } from "../../../context/GameContext";
import { useGameBackdropArt } from "../../../hooks/useGameBackdropArt";
import { useFocusedGame } from "../selection/useFocusedGame";

export function useHomeSelection(pool: Game[]) {
  const navigate = useNavigate();
  const { launchGame, runningGameIds } = useGames();
  const { item: focused } = useFocusedGame({
    items: pool,
    getId: (game) => game.id,
  });

  const focusedId = focused?.id ?? null;

  const open = useCallback(
    (game: Game) => navigate(`/library/${game.id}`),
    [navigate],
  );

  const play = useCallback(
    (game: Game) => {
      launchGame(game);
    },
    [launchGame],
  );

  const backdrop = useGameBackdropArt(focused);
  const isRunning = focusedId ? runningGameIds.includes(focusedId) : false;
  const status = focused
    ? PLAY_STATUS_DETAILS[focused.playStatus || "backlog"]
    : null;

  return {
    focused,
    focusedId,
    backdrop,
    isRunning,
    status,
    open,
    play,
  };
}
