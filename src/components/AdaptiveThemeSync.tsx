import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useGames } from "../context/GameContext";
import {
  setActiveGameArtwork,
  useActiveGameArtwork,
} from "../utils/activeGameArtwork";
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
 * When the user opens a game page (from library or store), it extracts the
 * game's average and dominant colors and smoothly updates the background
 * surfaces, text hierarchy, borders, and accents on the root document
 * element. Navigating between pages keeps the last used palette — the
 * colors are only recomputed when a new game page is opened.
 */
export function AdaptiveThemeSync() {
  const { currentTheme } = useTheme();
  const { games, selectedGameId, runningGameIds, getGame } = useGames();
  const location = useLocation();
  const isAdaptive = currentTheme === "adaptive";

  const activeArtworkUrl = useActiveGameArtwork();

  // Fast-path for direct library game page routes (/library/:id or /game/:id)
  const libraryRouteArtwork = useMemo(() => {
    if (!isAdaptive) return null;
    const gameMatch = location.pathname.match(/^\/(?:library|game)\/([^/?#]+)/);
    if (!gameMatch) return null;
    const g = getGame(gameMatch[1]);
    if (!g) return null;
    return (
      g.coverArtUrl ||
      g.bannerUrl ||
      (g.steamAppId
        ? `https://cdn.akamai.steamstatic.com/steam/apps/${g.steamAppId}/library_hero.jpg`
        : null)
    );
  }, [isAdaptive, location.pathname, getGame]);

  // When a library game page is opened directly, ensure it is recorded as active
  useEffect(() => {
    if (libraryRouteArtwork) {
      setActiveGameArtwork(libraryRouteArtwork);
    }
  }, [libraryRouteArtwork]);

  // Initial fallback artwork on cold boot if no game page was ever opened
  const fallbackArtworkUrl = useMemo<string | null>(() => {
    if (!isAdaptive) return null;

    if (runningGameIds.length > 0) {
      const runningGame = getGame(runningGameIds[0]);
      if (runningGame) {
        return runningGame.coverArtUrl || runningGame.bannerUrl || null;
      }
    }

    if (selectedGameId) {
      const selected = getGame(selectedGameId);
      if (selected) {
        return selected.coverArtUrl || selected.bannerUrl || null;
      }
    }

    if (games.length > 0) {
      let topGame = games[0];
      let maxT = typeof topGame.lastPlayed === "number" ? topGame.lastPlayed : 0;
      for (let i = 1; i < games.length; i++) {
        const g = games[i];
        const t = typeof g.lastPlayed === "number" ? g.lastPlayed : 0;
        if (t > maxT) {
          maxT = t;
          topGame = g;
        }
      }
      return topGame.coverArtUrl || topGame.bannerUrl || null;
    }

    return null;
  }, [isAdaptive, runningGameIds, selectedGameId, games, getGame]);

  const targetArtworkUrl =
    activeArtworkUrl || libraryRouteArtwork || fallbackArtworkUrl;

  const lastAppliedTokensRef = useRef<Record<string, string> | null>(null);
  const lastSampledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;

    if (!isAdaptive) {
      applyAdaptiveTheme(root, null);
      lastSampledUrlRef.current = null;
      return;
    }

    if (!targetArtworkUrl) {
      if (!lastAppliedTokensRef.current) {
        lastAppliedTokensRef.current = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
      }
      applyAdaptiveTheme(root, lastAppliedTokensRef.current);
      return;
    }

    // Re-apply cached tokens if artwork has not changed
    if (
      targetArtworkUrl === lastSampledUrlRef.current &&
      lastAppliedTokensRef.current
    ) {
      applyAdaptiveTheme(root, lastAppliedTokensRef.current);
      return;
    }

    let cancelled = false;

    sampleArtworkColors(targetArtworkUrl).then((sampled) => {
      if (cancelled) return;
      if (!sampled) {
        if (!lastAppliedTokensRef.current) {
          lastAppliedTokensRef.current = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
        }
        applyAdaptiveTheme(root, lastAppliedTokensRef.current);
        return;
      }
      const tokens = deriveAdaptiveTheme(sampled);
      lastAppliedTokensRef.current = tokens;
      lastSampledUrlRef.current = targetArtworkUrl;
      applyAdaptiveTheme(root, tokens);
    });

    return () => {
      cancelled = true;
    };
  }, [isAdaptive, targetArtworkUrl]);

  return null;
}
