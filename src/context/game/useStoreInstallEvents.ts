import { useEffect, type MutableRefObject } from "react";
import type { Game } from "../../types/game";
import type { ToastType } from "../ToastContext";
import { subscribeStoreInstallFinished } from "../../hooks/useStoreInstalls";

interface StoreInstallEventsArgs {
  gamesRef: MutableRefObject<Game[]>;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  showToast: (message: string, type: ToastType) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

/**
 * Reacts to a store transfer finishing: the game is installed now, and
 * the library should say so without waiting for the next store scan.
 *
 * A first install flips `installed`; an update leaves the flag alone and
 * only earns a different toast. Both paths read the game from `gamesRef`
 * rather than inside a state updater, because the toast is a side effect
 * and React may invoke updaters more than once.
 */
export function useStoreInstallEvents({
  gamesRef,
  setGames,
  showToast,
  t,
}: StoreInstallEventsArgs) {
  useEffect(() => {
    return subscribeStoreInstallFinished((finished) => {
      const game = gamesRef.current.find((g) => g.id === finished.gameId);
      if (!game) return;

      const wasInstalled = game.installed;
      showToast(
        t(wasInstalled ? "storeInstall.updatedToast" : "storeInstall.installedToast", {
          name: game.name,
        }),
        "success",
      );

      if (wasInstalled) return;
      setGames((prev) =>
        prev.map((g) => (g.id === finished.gameId ? { ...g, installed: true } : g)),
      );
    });
  }, [gamesRef, setGames, showToast, t]);
}
