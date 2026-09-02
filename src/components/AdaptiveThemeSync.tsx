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
 * When the user opens a game page, it extracts the game's average and
 * dominant colors and smoothly updates the background surfaces, text
 * hierarchy, borders, and accents on the root document element. Navigating
 * between pages keeps the last used palette — the colors are only
 * recomputed when a new game page is opened.
 */
export function AdaptiveThemeSync() {
  const { currentTheme } = useTheme();
  const { games, selectedGameId, runningGameIds, getGame } = useGames();
  const location = useLocation();
  const isAdaptive = currentTheme === "adaptive";

  // The game page the user has actually opened — the only thing allowed to
  // change the adaptive palette. Navigating between pages must keep the
  // last used colors; the palette is recomputed only when a new game page
  // is opened.
  const gamePageArtworkUrl = useMemo<string | null>(() => {
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

  // Initial backdrop only — used before the first palette has ever been
  // applied so the app doesn't boot with the flat default colors (running
  // game, then selected, then most recently played). Once any palette
  // exists this is ignored: page changes keep the last used colors.
  const initialArtworkUrl = useMemo<string | null>(() => {
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

  // The last palette actually applied to the document. The adaptive theme
  // must hold onto this palette when navigating between pages — the color
  // is only recomputed from new artwork when a game page is in view, never
  // reset while the user browses.
  const lastTokensRef = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    const root = document.documentElement;

    if (!isAdaptive) {
      applyAdaptiveTheme(root, null);
      return;
    }

    let cancelled = false;

    // The palette follows the game page the user opened. Until the first
    // palette exists the initial backdrop provides the boot colors; after
    // that, artwork from any other source is ignored so plain navigation
    // between pages never changes the palette.
    const artworkUrl =
      gamePageArtworkUrl ?? (lastTokensRef.current ? null : initialArtworkUrl);

    if (!artworkUrl) {
      if (!lastTokensRef.current) {
        lastTokensRef.current = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
      }
      applyAdaptiveTheme(root, lastTokensRef.current);
      return;
    }

    sampleArtworkColors(artworkUrl).then((sampled) => {
      if (cancelled) return;
      if (!sampled) {
        // Artwork failed to load or was unreadable (offline, CORS, timeout)
        // — hold the current palette instead of snapping to the default.
        if (!lastTokensRef.current) {
          lastTokensRef.current = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
        }
        applyAdaptiveTheme(root, lastTokensRef.current);
        return;
      }
      const tokens = deriveAdaptiveTheme(sampled);
      lastTokensRef.current = tokens;
      applyAdaptiveTheme(root, tokens);
    });

    return () => {
      cancelled = true;
    };
  }, [isAdaptive, gamePageArtworkUrl, initialArtworkUrl]);

  return null;
}
