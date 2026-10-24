import type { Game } from "../../types/game";
import type { Emulator, BiosBoardEntry } from "../../types/emulator";
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

// ── BIOS status board ─────────────────────────────────────────────
// Verdicts for the batch firmware check (`check_all_bios_status`).

export type BiosBoardStatus = "ready" | "missing" | "unconfigured";

export interface BiosBoardTotals {
  ready: number;
  missing: number;
  unconfigured: number;
}

/** Board verdict for one entry: `ready` (all mandatory firmware ok),
 *  `unconfigured` (no BIOS folder pointed at anything) or `missing`
 *  (configured but at least one mandatory dump absent/hash-bad). */
export function biosBoardStatus(entry: BiosBoardEntry): BiosBoardStatus {
  if (!entry.check.configured) return "unconfigured";
  if (entry.ready) return "ready";
  return "missing";
}

/** Count each verdict across the board rows. */
export function biosBoardTotals(entries: BiosBoardEntry[]): BiosBoardTotals {
  const totals: BiosBoardTotals = { ready: 0, missing: 0, unconfigured: 0 };
  for (const entry of entries) {
    totals[biosBoardStatus(entry)] += 1;
  }
  return totals;
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

// ── Multi-disc sets ──────────────────────────────────────────────
// Disc images of one game share the No-Intro `romGroup` title. The grid
// shows a single card per set (the `.m3u` playlist when present, otherwise
// disc 1) and the inspector exposes the other discs, so a 3-disc RPG does
// not flood the library with three near-identical cards.

export interface MultiDiscGroup {
  /** Display game (playlist or first disc). */
  representative: Game;
  /** Every disc in disc order, including the representative. */
  discs: Game[];
}

export interface GroupedRoms {
  /** Display order: singles and one entry per multi-disc set. */
  games: Game[];
  /** Representative game id → all discs of that set. */
  groups: Map<string, Game[]>;
  /** Representative game id → number of discs (absent for singles). */
  discCounts: Record<string, number>;
}

function discKey(game: Game): string | undefined {
  const group = game.romGroup?.trim().toLowerCase();
  return group ? group : undefined;
}

function discRank(game: Game): number {
  return game.romDisc && game.romDisc > 0 ? game.romDisc : Number.MAX_SAFE_INTEGER;
}

function isPlaylist(game: Game): boolean {
  const path = (game.romPath ?? game.path ?? "").toLowerCase();
  return path.endsWith(".m3u") || path.endsWith(".m3u8");
}

export function groupMultiDiscRoms(games: Game[]): GroupedRoms {
  const byKey = new Map<string, Game[]>();
  for (const game of games) {
    const key = discKey(game);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(game);
    byKey.set(key, list);
  }

  const representatives = new Map<string, Game>();
  const discCounts: Record<string, number> = {};
  const groups = new Map<string, Game[]>();

  for (const [key, discs] of byKey) {
    if (discs.length < 2) continue;
    const sorted = [...discs].sort((a, b) => {
      const playlistDelta = Number(isPlaylist(b)) - Number(isPlaylist(a));
      if (playlistDelta !== 0) return playlistDelta;
      return discRank(a) - discRank(b);
    });
    const representative = sorted[0];
    representatives.set(key, representative);
    discCounts[representative.id] = sorted.length;
    groups.set(representative.id, sorted);
  }

  const display: Game[] = [];
  const emitted = new Set<string>();
  for (const game of games) {
    const key = discKey(game);
    const representative = key ? representatives.get(key) : undefined;
    if (!representative) {
      display.push(game);
      continue;
    }
    if (representative.id !== game.id) continue;
    if (emitted.has(key!)) continue;
    emitted.add(key!);
    display.push(representative);
  }

  return { games: display, groups, discCounts };
}

/** Accent, glyph and logo for an emulator, reusing the catalog when it matches. */export function emulatorVisual(emulator: Emulator): EmulatorVisual {
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
