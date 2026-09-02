import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useSettings } from "../context/SettingsContext";
import { useTheme } from "../context/ThemeContext";
import { useGameAccent } from "../hooks/useGameAccent";
import { applyAccentFamily, applyGameAccentFamily } from "../utils/color";

/**
 * GameAccentSync
 *
 * App-wide half of the "auto game palette accent" setting. The game-detail
 * pages mount <GameHero>, which already tints the accent family with the
 * page game's art — this component covers everything else:
 *
 *  1. When a game is actually running, its palette becomes the app-wide
 *     accent (library grid, home, settings, …) so the UI wears the colors
 *     of the "active" game, matching the setting's label.
 *  2. When no game context applies, it restores the user's accent baseline
 *     (`applyAccentFamily` with the stored accent color), which also fixes
 *     the old leak where a game accent stayed applied after leaving a game
 *     page (nothing ever reset the family).
 *
 * Game-detail and store-detail routes are left to the hero so its richer
 * accent source (cover → hero → banner) keeps winning there.
 */
export function GameAccentSync() {
  const { autoGameAccent, accentColor } = useSettings();
  const { runningGameIds, getGame } = useGames();
  const { currentTheme } = useTheme();
  const location = useLocation();

  const isAdaptive = currentTheme === "adaptive";

  const isPageOwnedRoute =
    /^\/(?:library|game)\/[^/?#]+/.test(location.pathname) ||
    /^\/store\/[^/?#]+/.test(location.pathname);

  const runningGame =
    runningGameIds.length > 0 ? getGame(runningGameIds[0]) : null;
  const artworkUrl = runningGame?.coverArtUrl ?? runningGame?.bannerUrl ?? null;

  const palette = useGameAccent(
    autoGameAccent && !isPageOwnedRoute ? artworkUrl : null
  );

  useEffect(() => {
    const root = document.documentElement;
    if (isAdaptive) {
      // The adaptive theme owns the entire palette (surfaces + accent), so
      // the auto game-accent sync must not overwrite it between pages.
      delete root.dataset.gameAccent;
      return;
    }
    if (!autoGameAccent) {
      // Leaving auto mode: hand control back to the user accent baseline.
      applyAccentFamily(root, accentColor);
      delete root.dataset.gameAccent;
      return;
    }
    if (isPageOwnedRoute) return; // the page hero owns the family here
    if (!palette) {
      // No active game artwork — restore the persisted accent baseline.
      applyAccentFamily(root, accentColor);
      delete root.dataset.gameAccent;
      return;
    }
    applyGameAccentFamily(root, palette);
    // Flag the chrome tint (sidebar/topnav/window controls) that reads the
    // live game accent; cleared above whenever the baseline is restored.
    root.dataset.gameAccent = "true";
  }, [isAdaptive, autoGameAccent, palette, accentColor, isPageOwnedRoute]);

  return null;
}
