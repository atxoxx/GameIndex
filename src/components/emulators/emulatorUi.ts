import type { Game } from "../../types/game";
import type { Emulator } from "../../types/emulator";
import {
  accentForPlatform,
  matchKnownEmulator,
  type KnownEmulator,
} from "../../types/emulator";

/** Status filter used by the sidebar and the KPI tiles. */
export type EmuStatusFilter = "all" | "ready" | "needsSetup";

export interface EmulatorKpis {
  systems: number;
  ready: number;
  games: number;
  totalSizeBytes: number;
}

export interface EmulatorVisual {
  accent: string;
  glyph: string;
  logo?: string;
  known?: KnownEmulator;
}

/** An emulator is "ready" once it has both an executable and a ROM folder. */
export function isEmulatorReady(emulator: Emulator): boolean {
  return (
    emulator.executablePath.trim().length > 0 &&
    emulator.romFolder.trim().length > 0
  );
}

export function matchesStatusFilter(
  emulator: Emulator,
  filter: EmuStatusFilter
): boolean {
  if (filter === "ready") return isEmulatorReady(emulator);
  if (filter === "needsSetup") return !isEmulatorReady(emulator);
  return true;
}

export function computeEmulatorKpis(
  emulators: Emulator[],
  romCounts: Record<string, number>,
  totalSizeBytes: number
): EmulatorKpis {
  let ready = 0;
  let games = 0;
  for (const emu of emulators) {
    if (isEmulatorReady(emu)) ready += 1;
    games += romCounts[emu.id] ?? 0;
  }
  return { systems: emulators.length, ready, games, totalSizeBytes };
}

export type SetupStepKey = "executable" | "romFolder" | "scan";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
}

/**
 * The three things a working emulator needs. `scan` is only considered done
 * once at least one ROM has been detected for the emulator.
 */
export function emulatorSetupSteps(
  emulator: Emulator,
  romCount: number
): SetupStep[] {
  return [
    { key: "executable", done: emulator.executablePath.trim().length > 0 },
    { key: "romFolder", done: emulator.romFolder.trim().length > 0 },
    { key: "scan", done: romCount > 0 },
  ];
}

export function setupProgress(steps: SetupStep[]): {
  done: number;
  total: number;
} {
  return {
    done: steps.filter((step) => step.done).length,
    total: steps.length,
  };
}

export type RomSortKey = "name" | "size" | "playtime" | "dateAdded";
export type RomSortDir = "asc" | "desc";

export interface RomFilter {
  search?: string;
  favoritesOnly?: boolean;
  region?: string;
  language?: string;
}

/** Leading number of a playtime string ("12h 30m" → 12); 0 when unparseable. */
function playtimeHours(playTime?: string): number {
  if (!playTime) return 0;
  const value = Number.parseFloat(playTime);
  return Number.isFinite(value) ? value : 0;
}

export function filterAndSortRoms(
  games: Game[],
  filter: RomFilter,
  sortKey: RomSortKey,
  sortDir: RomSortDir
): Game[] {
  const query = filter.search?.trim().toLowerCase() ?? "";

  const filtered = games.filter((game) => {
    if (query && !game.name.toLowerCase().includes(query)) return false;
    if (filter.favoritesOnly && !game.favorite) return false;
    if (filter.region && game.romRegion !== filter.region) return false;
    if (filter.language && game.romLanguage !== filter.language) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let result = 0;
    switch (sortKey) {
      case "size":
        result = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
        break;
      case "playtime":
        result = playtimeHours(a.playTime) - playtimeHours(b.playTime);
        break;
      case "dateAdded":
        result = (a.addedAt ?? 0) - (b.addedAt ?? 0);
        break;
      case "name":
      default:
        result = a.name.localeCompare(b.name);
        break;
    }
    return sortDir === "desc" ? -result : result;
  });

  return sorted;
}

/** Accent, glyph and logo for an emulator, reusing the catalog when it matches. */
export function emulatorVisual(emulator: Emulator): EmulatorVisual {
  const known = matchKnownEmulator(emulator);
  if (known) {
    return {
      accent: known.accent,
      glyph: known.glyph,
      logo: emulator.iconUrl ?? known.logo,
      known,
    };
  }
  return {
    accent: accentForPlatform(emulator.platform),
    glyph: "🎮",
    logo: emulator.iconUrl,
  };
}
