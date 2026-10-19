import { useEffect, useMemo, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
import { useGames } from "../context/GameContext";
import { useActiveGameArtwork } from "../utils/activeGameArtwork";
import {
  applyAdaptiveTheme,
  cancelAdaptiveThemeCrossfade,
  crossfadeAdaptiveTheme,
  DEFAULT_ADAPTIVE_COLORS,
  deriveAdaptiveTheme,
  sampledPaletteClose,
  sampleArtworkColors,
  type SampledColors,
} from "../utils/adaptiveTheme";

/**
 * OverlayAdaptiveTheme — keeps the in-game HUD palette in lockstep with the
 * app's **Adaptive** theme.
 *
 * The main window drives adaptive colors through `AdaptiveThemeSync`, which
 * lives inside the router and reacts to the opened game page. The overlay is a
 * separate, router-less webview, so it needs its own copy: it samples the
 * currently published artwork (or, failing that, the running/selected game's
 * art) and applies the same derived CSS custom properties on `documentElement`.
 * For every other theme the overlay simply follows `data-theme`, so this
 * component only acts when Adaptive is active.
 */
export function OverlayAdaptiveTheme() {
  const { currentTheme } = useTheme();
  const { games, getGame, runningGameIds, selectedGameId } = useGames();
  const isAdaptive = currentTheme === "adaptive";
  const activeArtworkUrl = useActiveGameArtwork();

  // The running game is the authoritative source for the HUD: it must win over
  // the "last browsed" artwork (which the main window publishes and which can
  // be stale), otherwise launching a different game would leave the palette
  // frozen on whatever page was open last. `runningGameIds` is kept live by the
  // shared `game-started`/`game-exited` events, which reach this webview too.
  const runningArtworkUrl = useMemo<string | null>(() => {
    if (!isAdaptive || runningGameIds.length === 0) return null;
    const running = getGame(runningGameIds[0]);
    if (!running) return null;
    return running.coverArtUrl || running.bannerUrl || null;
  }, [isAdaptive, runningGameIds, getGame]);

  const fallbackArtworkUrl = useMemo<string | null>(() => {
    if (!isAdaptive) return null;

    if (selectedGameId) {
      const selected = getGame(selectedGameId);
      if (selected) return selected.coverArtUrl || selected.bannerUrl || null;
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
  }, [isAdaptive, selectedGameId, games, getGame]);

  const targetArtworkUrl =
    runningArtworkUrl || activeArtworkUrl || fallbackArtworkUrl;

  const lastAppliedTokensRef = useRef<Record<string, string> | null>(null);
  const lastSampledUrlRef = useRef<string | null>(null);
  const lastSampledColorsRef = useRef<SampledColors | null>(null);

  useEffect(() => {
    const root = document.documentElement;

    if (!isAdaptive) {
      cancelAdaptiveThemeCrossfade();
      applyAdaptiveTheme(root, null);
      lastSampledUrlRef.current = null;
      lastSampledColorsRef.current = null;
      return;
    }

    if (!targetArtworkUrl) {
      if (!lastAppliedTokensRef.current) {
        lastAppliedTokensRef.current = deriveAdaptiveTheme(DEFAULT_ADAPTIVE_COLORS);
      }
      applyAdaptiveTheme(root, lastAppliedTokensRef.current);
      return;
    }

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
      if (
        lastAppliedTokensRef.current &&
        lastSampledColorsRef.current &&
        sampledPaletteClose(lastSampledColorsRef.current, sampled)
      ) {
        applyAdaptiveTheme(root, lastAppliedTokensRef.current);
        return;
      }
      const tokens = deriveAdaptiveTheme(sampled);
      lastAppliedTokensRef.current = tokens;
      lastSampledUrlRef.current = targetArtworkUrl;
      lastSampledColorsRef.current = sampled;
      crossfadeAdaptiveTheme(root, tokens);
    });

    return () => {
      cancelled = true;
    };
  }, [isAdaptive, targetArtworkUrl]);

  useEffect(() => () => cancelAdaptiveThemeCrossfade(), []);

  return null;
}
