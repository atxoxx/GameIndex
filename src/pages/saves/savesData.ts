import type { Game } from "../../types/game";
import type { SaveBackup, SaveLocation, SaveLocationHealth } from "../../types/saves";
import { localDayKey } from "../../utils/savesTime";

/** A snapshot older than this is surfaced as "needs backup". */
export const STALE_BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

export type ProtectionState = "protected" | "stale" | "never" | "missing" | "excluded";

export type GameFilter = "all" | "protected" | "needsBackup" | "issues";

export type GameSort = "name" | "attention" | "recent" | "snapshots";

export interface TrackedSaveGame {
  gameId: string;
  /** Null when snapshots survive a game that was removed from the library. */
  game: Game | null;
  name: string;
  installed: boolean;
  locations: SaveLocation[];
  includedLocations: SaveLocation[];
  /** Included locations whose path no longer exists. */
  missingCount: number;
  /** Newest first. */
  snapshots: SaveBackup[];
  latest: SaveBackup | null;
  snapshotBytes: number;
  state: ProtectionState;
}

export interface SavesOverview {
  tracked: TrackedSaveGame[];
  byId: Map<string, TrackedSaveGame>;
  counts: Record<GameFilter, number> & { attention: number };
  totalSnapshotBytes: number;
}

export function protectionLabelKey(state: ProtectionState): string {
  switch (state) {
    case "protected":
      return "saves.state.protected";
    case "stale":
      return "saves.state.stale";
    case "never":
      return "saves.state.never";
    case "missing":
      return "saves.state.missing";
    default:
      return "saves.state.excluded";
  }
}

/** 0 = most urgent. Drives the "attention" sort and default selection. */
export function protectionRank(state: ProtectionState): number {
  switch (state) {
    case "missing":
      return 0;
    case "never":
      return 1;
    case "stale":
      return 2;
    case "excluded":
      return 3;
    default:
      return 4;
  }
}

function stateFor(
  included: SaveLocation[],
  missingCount: number,
  latest: SaveBackup | null,
  now: number,
): ProtectionState {
  if (included.length === 0) return "excluded";
  if (missingCount > 0) return "missing";
  if (!latest) return "never";
  if (now - latest.createdAt > STALE_BACKUP_MS) return "stale";
  return "protected";
}

/**
 * Join the three backend lists into the roster model the hub renders.
 *
 * Pure on purpose: the filters, counts and per-game status are the parts most
 * likely to drift, so they are unit-tested without mounting React.
 */
export function buildSavesOverview({
  games,
  locations,
  backups,
  health,
  now = Date.now(),
}: {
  games: Game[];
  locations: SaveLocation[];
  backups: SaveBackup[];
  health: SaveLocationHealth[];
  now?: number;
}): SavesOverview {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const healthById = new Map(health.map((entry) => [entry.id, entry.exists]));

  const locationsByGame = new Map<string, SaveLocation[]>();
  for (const location of locations) {
    const list = locationsByGame.get(location.gameId);
    if (list) list.push(location);
    else locationsByGame.set(location.gameId, [location]);
  }

  const backupsByGame = new Map<string, SaveBackup[]>();
  for (const backup of backups) {
    const list = backupsByGame.get(backup.gameId);
    if (list) list.push(backup);
    else backupsByGame.set(backup.gameId, [backup]);
  }

  const ids = new Set<string>([...locationsByGame.keys(), ...backupsByGame.keys()]);
  const tracked: TrackedSaveGame[] = [];

  for (const gameId of ids) {
    const game = gameById.get(gameId) ?? null;
    const gameLocations = locationsByGame.get(gameId) ?? [];
    const included = gameLocations.filter((location) => location.include);
    // Unknown health (backend too old, or the probe has not returned yet) is
    // not the same as a missing path: only an explicit `false` counts.
    const missingCount = included.filter(
      (location) => healthById.get(location.id) === false,
    ).length;
    const snapshots = [...(backupsByGame.get(gameId) ?? [])].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const latest = snapshots[0] ?? null;
    tracked.push({
      gameId,
      game,
      name: game?.displayName?.trim() || game?.name || latest?.gameName || gameId,
      installed: game?.installed ?? false,
      locations: gameLocations,
      includedLocations: included,
      missingCount,
      snapshots,
      latest,
      snapshotBytes: snapshots.reduce((sum, backup) => sum + backup.totalBytes, 0),
      state: stateFor(included, missingCount, latest, now),
    });
  }

  tracked.sort((a, b) => a.name.localeCompare(b.name));

  const byId = new Map(tracked.map((entry) => [entry.gameId, entry]));
  const counts: SavesOverview["counts"] = {
    all: tracked.length,
    protected: tracked.filter((entry) => entry.state === "protected").length,
    needsBackup: tracked.filter((entry) => entry.state === "never" || entry.state === "stale")
      .length,
    issues: tracked.filter((entry) => entry.state === "missing").length,
    attention: tracked.filter((entry) => entry.state !== "protected").length,
  };

  return {
    tracked,
    byId,
    counts,
    totalSnapshotBytes: tracked.reduce((sum, entry) => sum + entry.snapshotBytes, 0),
  };
}

/** Filter + search + sort for the games rail. */
export function filterTrackedGames(
  tracked: TrackedSaveGame[],
  {
    filter,
    search,
    sort,
  }: {
    filter: GameFilter;
    search: string;
    sort: GameSort;
  },
): TrackedSaveGame[] {
  const query = search.trim().toLowerCase();
  const matches = tracked.filter((entry) => {
    if (query && !entry.name.toLowerCase().includes(query)) return false;
    if (filter === "protected") return entry.state === "protected";
    if (filter === "needsBackup") {
      return entry.state === "never" || entry.state === "stale";
    }
    if (filter === "issues") return entry.state === "missing";
    return true;
  });

  return matches.sort((a, b) => {
    if (sort === "recent") {
      return (b.latest?.createdAt ?? 0) - (a.latest?.createdAt ?? 0);
    }
    if (sort === "snapshots") {
      return b.snapshots.length - a.snapshots.length || a.name.localeCompare(b.name);
    }
    if (sort === "attention") {
      return protectionRank(a.state) - protectionRank(b.state) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
}

export type SnapshotSort = "newest" | "oldest" | "size";

export interface SnapshotFilters {
  search: string;
  gameId: string;
  kind: "all" | string;
  sort: SnapshotSort;
}

/** Filter + sort for the library-wide snapshot timeline. */
export function filterSnapshots(backups: SaveBackup[], filters: SnapshotFilters): SaveBackup[] {
  const query = filters.search.trim().toLowerCase();
  return backups
    .filter((backup) => {
      if (filters.gameId !== "all" && backup.gameId !== filters.gameId) return false;
      if (filters.kind !== "all" && backup.kind !== filters.kind) return false;
      if (!query) return true;
      return (
        backup.gameName.toLowerCase().includes(query) ||
        (backup.note ?? "").toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (filters.sort === "oldest") return a.createdAt - b.createdAt;
      if (filters.sort === "size") return b.totalBytes - a.totalBytes;
      return b.createdAt - a.createdAt;
    });
}

export interface SnapshotDayGroup {
  /** Local `YYYY-MM-DD` key. */
  key: string;
  backups: SaveBackup[];
  bytes: number;
}

/** Group a sorted snapshot list into local calendar days, preserving order. */
export function groupSnapshotsByDay(backups: SaveBackup[]): SnapshotDayGroup[] {
  const groups = new Map<string, SnapshotDayGroup>();
  for (const backup of backups) {
    const key = localDayKey(backup.createdAt);
    const group = groups.get(key);
    if (group) {
      group.backups.push(backup);
      group.bytes += backup.totalBytes;
    } else {
      groups.set(key, { key, backups: [backup], bytes: backup.totalBytes });
    }
  }
  return Array.from(groups.values());
}
