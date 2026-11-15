/**
 * OverlayGameAccentSync - game-driven accent for the HUD.
 *
 * The desktop `GameAccentSync` follows the page the user is browsing. The
 * overlay has no pages: its active game is the running session, so this
 * component gives the running game priority and falls back to the artwork the
 * main window published. When the user picked Adaptive, `OverlayAdaptiveTheme`
 * owns the whole palette and this component stands down.
 */
import { useEffect, useMemo, useRef } from "react";
import { useSettings } from "../context/SettingsContext";
import { useTheme } from "../context/ThemeContext";
import { useGames } from "../context/GameContext";
import { useActiveGameArtwork } from "../utils/activeGameArtwork";
import { useGameAccent, type GameAccentPalette } from "../hooks/useGameAccent";
import { applyAccentFamily, applyGameAccentFamily } from "../utils/color";
import { accentPalettesClose } from "./GameAccentSync";

export function OverlayGameAccentSync() {
  const { autoGameAccent, accentColor } = useSettings();
  const { currentTheme } = useTheme();
  const { games, getGame, runningGameIds, selectedGameId } = useGames();
  const isAdaptive = currentTheme === "adaptive";
  const publishedArtworkUrl = useActiveGameArtwork();

  const runningArtworkUrl = useMemo(() => {
    if (runningGameIds.length === 0) return null;
    const running = getGame(runningGameIds[0]);
    return running?.coverArtUrl || running?.bannerUrl || null;
  }, [runningGameIds, getGame]);

  const fallbackArtworkUrl = useMemo(() => {
    if (selectedGameId) {
      const selected = getGame(selectedGameId);
      if (selected) return selected.coverArtUrl || selected.bannerUrl || null;
    }
    if (games.length === 0) return null;
    let top = games[0];
    let topPlayed = top.lastPlayed ?? 0;
    for (const game of games) {
      const played = game.lastPlayed ?? 0;
      if (played > topPlayed) {
        top = game;
        topPlayed = played;
      }
    }
    return top.coverArtUrl || top.bannerUrl || null;
  }, [games, getGame, selectedGameId]);

  const source = runningArtworkUrl || publishedArtworkUrl || fallbackArtworkUrl;
  const palette = useGameAccent(autoGameAccent && !isAdaptive ? source : null);
  const lastAppliedRef = useRef<GameAccentPalette | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (isAdaptive) {
      delete root.dataset.gameAccent;
      return;
    }
    if (!autoGameAccent) {
      applyAccentFamily(root, accentColor);
      delete root.dataset.gameAccent;
      lastAppliedRef.current = null;
      return;
    }
    if (palette) {
      if (lastAppliedRef.current && accentPalettesClose(lastAppliedRef.current, palette)) {
        root.dataset.gameAccent = "true";
        return;
      }
      applyGameAccentFamily(root, palette);
      root.dataset.gameAccent = "true";
      lastAppliedRef.current = palette;
      return;
    }
    if (lastAppliedRef.current) {
      applyGameAccentFamily(root, lastAppliedRef.current);
      root.dataset.gameAccent = "true";
      return;
    }
    applyAccentFamily(root, accentColor);
    delete root.dataset.gameAccent;
  }, [isAdaptive, autoGameAccent, palette, accentColor]);

  return null;
}
