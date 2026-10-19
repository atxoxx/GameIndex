import { useEffect, useRef } from "react";
import { useSettings } from "../context/SettingsContext";
import { useTheme } from "../context/ThemeContext";
import { useActiveGameArtwork } from "../utils/activeGameArtwork";
import { useGameAccent, type GameAccentPalette } from "../hooks/useGameAccent";
import {
  applyAccentFamily,
  applyGameAccentFamily,
  parseCssColor,
  sampledColorsClose,
} from "../utils/color";

/**
 * True when the newly extracted accent palette is a perceptual continuation of
 * the applied one — used to skip a needless re-application (and the subtle
 * colour drift it causes) when two covers share a similar identity.
 */
function accentPalettesClose(
  prev: GameAccentPalette,
  next: GameAccentPalette
): boolean {
  const prevPrimary = parseCssColor(prev.primary);
  const nextPrimary = parseCssColor(next.primary);
  if (!prevPrimary || !nextPrimary) return false;
  if (!sampledColorsClose(prevPrimary, nextPrimary, 12, 0.1, 0.1)) return false;

  const prevSecondary = parseCssColor(prev.secondary);
  const nextSecondary = parseCssColor(next.secondary);
  if (
    prevSecondary &&
    nextSecondary &&
    !sampledColorsClose(prevSecondary, nextSecondary, 20, 0.15, 0.15)
  ) {
    return false;
  }
  return true;
}

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
      // Similar artwork keeps the applied family — no visible drift between
      // covers that share a palette. The ref keeps the applied palette, not
      // the latest sample, so a chain of near-identical covers cannot drift.
      if (
        lastAppliedPaletteRef.current &&
        accentPalettesClose(lastAppliedPaletteRef.current, palette)
      ) {
        root.dataset.gameAccent = "true";
        return;
      }
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
