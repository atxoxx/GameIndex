import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSteamIntegration } from "./useSteamIntegration";
import { useEpicIntegration } from "./useEpicIntegration";
import { useGogIntegration } from "./useGogIntegration";
import { useHumbleIntegration } from "./useHumbleIntegration";
import { useRockstarIntegration } from "./useRockstarIntegration";
import { useUplayIntegration } from "./useUplayIntegration";

/**
 * useIntegrations — the single source of truth for every store
 * integration on the Settings page. Combines the six per-store hooks
 * and adds:
 *  - `connectedIntegrations`: live count driving the sidebar badge.
 *  - `connectionStatus`: anchor-id → connected map for the sidebar dots.
 *  - `removeIntegrationGames`: one-click wipe of every game imported
 *    from a given platform (confirmation is the tab's responsibility).
 */
export function useIntegrations() {
  const { showToast } = useToast();
  const { games, removeGames } = useGames();
  const { t } = useLanguage();

  const steam = useSteamIntegration();
  const epic = useEpicIntegration();
  const gog = useGogIntegration();
  const humble = useHumbleIntegration();
  const rockstar = useRockstarIntegration();
  const uplay = useUplayIntegration();

  // Live count of connected integrations — drives the badge on the
  // Integrations pill in the sidebar. Lints to 0 when none are
  // connected and to 4 when Steam + Epic + GOG + Humble are all linked.
  const connectedIntegrations =
    (steam.steamAuth.isAuthenticated ? 1 : 0) +
    (epic.epicAuth.isAuthenticated ? 1 : 0) +
    (gog.gogAuth.isAuthenticated ? 1 : 0) +
    (humble.humbleAuth.isAuthenticated ? 1 : 0);

  const connectionStatus: Record<string, boolean> = {
    "integration-steam": steam.steamAuth.isAuthenticated,
    "integration-epic": epic.epicAuth.isAuthenticated,
    "integration-gog": gog.gogAuth.isAuthenticated,
    "integration-humble": humble.humbleAuth.isAuthenticated,
  };

  /** Number of library games imported from a given store platform. */
  function platformGameCount(platform: string) {
    return games.filter((g) => g.platform === platform).length;
  }

  /** Wipe every game imported from a given integration in one click. */
  function removeIntegrationGames(platform: string) {
    const count = platformGameCount(platform);
    if (count === 0) {
      showToast(t("settings.integrations.noGamesToRemove", { platform }), "info");
      return;
    }
    removeGames((g) => g.platform === platform);
    showToast(t("settings.integrations.removedGames", { count, platform }), "success");
  }

  return {
    steam,
    epic,
    gog,
    humble,
    rockstar,
    uplay,
    connectedIntegrations,
    connectionStatus,
    platformGameCount,
    removeIntegrationGames,
  };
}
