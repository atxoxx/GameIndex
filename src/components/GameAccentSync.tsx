import { useEffect, useRef } from "react";
import { useSettings } from "../context/SettingsContext";
import { useTheme } from "../context/ThemeContext";
import { useActiveGameArtwork } from "../utils/activeGameArtwork";
import { useGameAccent, type GameAccentPalette } from "../hooks/useGameAccent";
import { applyAccentFamily, applyGameAccentFamily } from "../utils/color";

/**
 * GameAccentSync
 *
 * App-wide synchronization of the "auto game palette accent" setting.
 *
 * When enabled, the game's color palette (extracted from the active game's
 * cover/banner art) is applied across the app chrome (sidebar, topnav, window controls,
 * buttons, and indicators). Crucially, this palette stays active even when navigating
 * between pages (Home, Library grid, Settings, Deals, Mods, etc.), and only changes
 * when a user opens another game page (library or store) or disables the auto setting.
 */
export function GameAccentSync() {
  const { autoGameAccent, accentColor } = useSettings();
  const { currentTheme } = useTheme();
  const isAdaptive = currentTheme === "adaptive";

  const activeArtworkUrl = useActiveGameArtwork();
  const palette = useGameAccent(autoGameAccent ? activeArtworkUrl : null);

  const lastAppliedPaletteRef = useRef<GameAccentPalette | null>(null);

  useEffect(() => {
    const root = document.documentElement;

    if (isAdaptive) {
      // The adaptive theme owns the entire palette (surfaces + accent), so
      // the auto game-accent sync yields control.
      delete root.dataset.gameAccent;
      return;
    }

    if (!autoGameAccent) {
      // Leaving auto mode: restore user accent baseline.
      applyAccentFamily(root, accentColor);
      delete root.dataset.gameAccent;
      lastAppliedPaletteRef.current = null;
      return;
    }

    if (palette) {
      applyGameAccentFamily(root, palette);
      root.dataset.gameAccent = "true";
      lastAppliedPaletteRef.current = palette;
    } else if (lastAppliedPaletteRef.current) {
      // Hold onto the last applied palette across page changes or while new art decodes
      applyGameAccentFamily(root, lastAppliedPaletteRef.current);
      root.dataset.gameAccent = "true";
    } else {
      // No game page has ever been opened yet in auto mode
      applyAccentFamily(root, accentColor);
      delete root.dataset.gameAccent;
    }
  }, [isAdaptive, autoGameAccent, palette, accentColor]);

  return null;
}
