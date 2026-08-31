import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useGames } from "../context/GameContext";
import {
  applyAdaptiveTheme,
  DEFAULT_ADAPTIVE_COLORS,
  deriveAdaptiveTheme,
  sampleArtworkColors,
} from "../utils/adaptiveTheme";

/**
 * AdaptiveThemeSync
 *
 * Runs inside the provider tree to synchronize the active game's artwork
 * with the global design system when the "Adaptive" theme is selected.
 *
 * When switching games or pages, it extracts the game's average and dominant
 * colors and smoothly updates the background surfaces, text hierarchy,
 * borders, and accents on the root document element.
 */
export function AdaptiveThemeSync() {
  const { currentTheme } = useTheme();
  const { games, selectedGameId, runningGameIds, getGame } = useGames();
  const location = useLocation();
  const isAdaptive = currentTheme === "adaptive";

  // Resolve the active artwork source URL
  const activeArtworkUrl = useMemo<string | null>(() => {
    if (!isAdaptive) return null;

    const path = location.pathname;

    // 1. Direct game page route: /library/:id or /game/:id
    const gameMatch = path.match(/^\/(?:library|game)\/([^/?#]+)/);
    if (gameMatch) {
      const g = getGame(gameMatch[1]);
      if (g) {
        return g.coverArtUrl || g.bannerUrl || (g.steamAppId ? `https://cdn.akamai.steamstatic.com/steam/apps/${g.steamAppId}/library_hero.jpg` : null);
      }
    }

    // 2. Currently running game
    if (runningGameIds.length > 0) {
      const runningGame = getGame(runningGameIds[0]);
      if (runningGame) {
        return runningGame.coverArtUrl || runningGame.bannerUrl || null;
      }
    }

    // 3. Currently selected library game
    if (selectedGameId) {
      const selected = getGame(selectedGameId);
      if (selected) {
        return selected.coverArtUrl || selected.bannerUrl || null;
      }
    }

    // 4. Fallback to most recently played or first available library game
    if (games.length > 0) {
      const sortedByRecent = [...games].sort((a, b) => {
        const tA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
        const tB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
        return tB - tA;
      });
      const topGame = sortedByRecent[0];
      return topGame.coverArtUrl || topGame.bannerUrl || null;
    }

    return null;
  }, [isAdaptive, location.pathname, runningGameIds, selectedGameId, games, getGame]);

  const activeArtworkRef = useRef(activeArtworkUrl);
  activeArtworkRef.current = activeArtworkUrl;

  useEffect(() => {
    const root = document.documentElement;

    if (!isAdaptive) {
      applyAdaptiveTheme(root, null);
      return;
    }

    let cancelled = false;

    if (!activeArtworkUrl) {
      const defaultTokens = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
      applyAdaptiveTheme(root, defaultTokens);
      return;
    }

    sampleArtworkColors(activeArtworkUrl).then((sampled) => {
      if (cancelled) return;
      const tokens = deriveAdaptiveTheme(sampled);
      applyAdaptiveTheme(root, tokens);
    });

    return () => {
      cancelled = true;
    };
  }, [isAdaptive, activeArtworkUrl]);

  return null;
}
