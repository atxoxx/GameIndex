import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "./GameContext";
import {
  FILTER_PRESETS_STORAGE_KEY,
  loadFilterPresets,
  type FilterPreset,
} from "../hooks/libraryFilters";
import { filterGamesByShelf, rulesFromFilters } from "../hooks/shelfRules";
import type { Game, PlayStatus } from "../types/game";
import {
  DEFAULT_SHELF_RULES,
  MAX_SHELVES,
  type Shelf,
  type ShelfRules,
} from "../types/shelf";

/** localStorage flag: the first-run seed / preset migration has run. */
const SHELVES_SEEDED_KEY = "gameindex:shelves-seeded-v1";

/** localStorage flag: the one-time duplicate-starter cleanup has run. */
const SHELVES_DEDUPE_KEY = "gameindex:shelves-dedupe-v1";

/** localStorage flag: the Smart Shelves feature is switched on. */
const SHELVES_ENABLED_KEY = "gamelib.smart_shelves_enabled";

/** localStorage key: the last-applied shelf, restored on relaunch. */
const ACTIVE_SHELF_KEY = "gameindex:active-shelf:v1";

/** Read the Smart Shelves master flag (defaults to on when unset). */
function readShelfEnabled(): boolean {
  try {
    return localStorage.getItem(SHELVES_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Prefix marking a starter shelf whose `name` is an i18n key. */
const STARTER_NAME_PREFIX = "shelves.starter.";

/**
 * Backoff between `shelves_list` attempts on mount (ms). The shelves pool can
 * still be warming up during the first frames, and a single failed read used
 * to be indistinguishable from "the user has no shelves".
 */
const LIST_ATTEMPT_DELAYS_MS = [0, 250, 900];

/** Result of one hydration pass (shipped to every effect run that awaits it). */
interface ShelfHydration {
  shelves: Shelf[];
  completions: [string, number][];
  /** False when the backend never answered, so nothing was seeded/cleaned. */
  listLoaded: boolean;
}

/** Draft accepted by `createShelf` — the DAO fills in id/timestamps. */
export type ShelfDraft = Partial<Omit<Shelf, "rules">> & {
  name: string;
  rules?: ShelfRules;
};

interface ShelfContextValue {
  /** Every shelf in the user's drag order. */
  shelves: Shelf[];
  /** False until the on-disk shelves have finished hydrating. */
  loading: boolean;
  /** Id of the shelf currently applied as a Library filter, if any. */
  activeShelfId: string | null;
  setActiveShelf: (id: string | null) => void;
  /** Master switch — when off, every shelf surface is hidden. */
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  createShelf: (draft: ShelfDraft) => Promise<Shelf | null>;
  updateShelf: (shelf: Shelf) => Promise<void>;
  deleteShelf: (id: string) => Promise<void>;
  reorderShelves: (ids: string[]) => Promise<void>;
  /** The games currently matching a shelf (live). */
  shelfGames: (id: string) => Game[];
  /** Live match count for a shelf. */
  shelfCount: (id: string) => number;
  /** Completion timestamp (unix ms) for a game, if recorded. */
  completedAtOf: (gameId: string) => number | undefined;
  /** Record or clear a game's completion timestamp. */
  setCompletion: (gameId: string, completedAt: number) => Promise<void>;
  /** Look up a shelf by id. */
  getShelf: (id: string) => Shelf | undefined;
}

const globalShelfObj = globalThis as unknown as {
  __gamelib_shelf_context__?: React.Context<ShelfContextValue | null>;
};
const ShelfContext =
  globalShelfObj.__gamelib_shelf_context__ ??
  (globalShelfObj.__gamelib_shelf_context__ = createContext<ShelfContextValue | null>(null));

/** Build a shelf from a legacy localStorage filter preset. */
function shelfFromPreset(preset: FilterPreset): Shelf {
  return {
    id: "",
    name: preset.name,
    icon: "layers",
    color: "accent",
    rules: rulesFromFilters({ ...preset.filters, search: "", sort: preset.sort }),
    sort: preset.sort,
    pinned: false,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Midnight (local) on Jan 1 of the current year, in unix ms. */
function startOfYearMs(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), 0, 1).getTime();
}

/** The shelves a fresh install starts with (names are i18n keys). */
function starterShelves(now: number): Shelf[] {
  const base = {
    id: "",
    icon: "layers",
    color: "accent",
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  };
  return [
    {
      ...base,
      name: "shelves.starter.continuePlaying",
      icon: "clock",
      rules: { status: "installed", lastPlayedWithinDays: 14 },
      sort: "recently_played",
      pinned: true,
    },
    {
      ...base,
      name: "shelves.starter.backlog",
      icon: "bookmark",
      rules: { playStatus: "backlog" },
      sort: "date_added",
      pinned: true,
    },
    {
      ...base,
      name: "shelves.starter.shortGames",
      icon: "timer",
      color: "info",
      rules: { storyMaxHours: 5 },
      sort: "shortest",
      pinned: false,
    },
    {
      ...base,
      name: "shelves.starter.neverPlayed",
      icon: "sparkles",
      color: "warning",
      rules: { playtimeMaxHours: 0 },
      sort: "date_added",
      pinned: false,
    },
    {
      ...base,
      name: "shelves.starter.coopNight",
      icon: "users",
      color: "ingame",
      rules: { modes: ["Co-operative", "Multiplayer"] },
      sort: "alphabetical",
      pinned: false,
    },
    {
      ...base,
      name: "shelves.starter.beatenThisYear",
      icon: "trophy",
      color: "success",
      rules: { completedFrom: startOfYearMs(now) },
      sort: "recently_completed",
      pinned: false,
    },
  ];
}

async function saveShelf(shelf: Shelf): Promise<Shelf> {
  return invoke<Shelf>("shelves_save", { shelf });
}

/** True when a Tauri runtime is present (false for plain `npm run dev`). */
function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Read every stored shelf, retrying briefly while the backend warms up.
 * Returns `null` when the backend never answered - callers must not treat
 * that as an empty library, or a transient failure would seed/overwrite it.
 */
async function readShelves(): Promise<Shelf[] | null> {
  const delays = hasTauriRuntime() ? LIST_ATTEMPT_DELAYS_MS : [0];
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await invoke<Shelf[]>("shelves_list");
    } catch {
      /* retry */
    }
  }
  return null;
}

/**
 * Run the one-time seed/migration exactly once per app launch.
 *
 * Rows whose name already exists are skipped, so a partially failed pass is
 * safe to retry: the seed flag is only written once every row landed.
 */
async function seedShelves(loaded: Shelf[]): Promise<Shelf[]> {
  try {
    if (localStorage.getItem(SHELVES_SEEDED_KEY)) return loaded;
  } catch {
    // Storage unavailable - there is nothing to migrate from and no way to
    // remember that we ran, so leave the stored shelves untouched.
    return loaded;
  }

  const presets = loadFilterPresets();
  const seeds =
    presets.length > 0
      ? presets.map(shelfFromPreset)
      : loaded.length === 0
        ? starterShelves(Date.now())
        : [];

  const existingNames = new Set(loaded.map((shelf) => shelf.name));
  const saved: Shelf[] = [];
  let failed = 0;
  for (const shelf of seeds) {
    if (existingNames.has(shelf.name)) continue;
    try {
      saved.push(await saveShelf(shelf));
      existingNames.add(shelf.name);
    } catch {
      failed += 1;
    }
  }

  if (failed === 0) {
    try {
      localStorage.setItem(SHELVES_SEEDED_KEY, "1");
      if (presets.length > 0) localStorage.removeItem(FILTER_PRESETS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return [...loaded, ...saved];
}

/**
 * One-time heal: early builds could seed the starter set twice, leaving
 * duplicate `shelves.starter.*` rows. Keep the first of each and delete the
 * rest. The flag is only written when every delete succeeded, so a failure
 * gets another go on the next launch instead of stranding the duplicates.
 */
async function dedupeStarterShelves(loaded: Shelf[]): Promise<Shelf[]> {
  try {
    if (localStorage.getItem(SHELVES_DEDUPE_KEY)) return loaded;
  } catch {
    return loaded;
  }

  const seen = new Set<string>();
  const kept: Shelf[] = [];
  let failed = 0;
  for (const shelf of loaded) {
    if (shelf.name.startsWith(STARTER_NAME_PREFIX)) {
      if (seen.has(shelf.name)) {
        try {
          await invoke("shelves_delete", { id: shelf.id });
        } catch {
          failed += 1;
          kept.push(shelf);
        }
        continue;
      }
      seen.add(shelf.name);
    }
    kept.push(shelf);
  }

  if (failed === 0) {
    try {
      localStorage.setItem(SHELVES_DEDUPE_KEY, "1");
    } catch {
      /* ignore */
    }
  }
  return kept;
}

/**
 * Load the shelf list, seed/migrate on first run, then load completion
 * timestamps. Never rejects: every step degrades to "keep what we have".
 */
async function hydrateShelves(): Promise<ShelfHydration> {
  const stored = await readShelves();
  let shelves = stored ?? [];

  if (stored !== null) {
    shelves = await seedShelves(shelves);
    shelves = await dedupeStarterShelves(shelves);
  }

  let completions: [string, number][] = [];
  try {
    completions = await invoke<[string, number][]>("shelves_completions");
  } catch {
    /* completion dates are optional - date rules simply won't match */
  }

  return { shelves, completions, listLoaded: stored !== null };
}

export function ShelfProvider({ children }: { children: ReactNode }) {
  const { games } = useGames();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const [enabled, setEnabledState] = useState<boolean>(readShelfEnabled);
  const [completions, setCompletions] = useState<Map<string, number>>(new Map());
  // Hydration is started by the first effect run and shared by every later run
  // of this provider instance. React StrictMode mounts, tears down and remounts
  // in development: without the shared promise the teardown discarded the
  // in-flight result and the remount skipped it, leaving `loading` stuck at
  // `true` and the shelf list permanently empty.
  const hydrationRef = useRef<Promise<ShelfHydration> | null>(null);

  // Hydrate shelves + completion timestamps, seeding/migrating on first run.
  useEffect(() => {
    let disposed = false;
    const hydration = (hydrationRef.current ??= hydrateShelves());

    void hydration.then((result) => {
      if (disposed) return;
      // Keep anything created while hydration was in flight, but never drop a
      // stored shelf: the read is the source of truth for what's on disk.
      setShelves((prev) => {
        const loadedIds = new Set(result.shelves.map((shelf) => shelf.id));
        return [...result.shelves, ...prev.filter((shelf) => !loadedIds.has(shelf.id))];
      });
      setCompletions(new Map(result.completions));
      setLoading(false);

      if (!result.listLoaded) return;

      // Restore the last-applied shelf, dropping a stale reference so the
      // sidebar doesn't keep a dead selection alive between launches.
      try {
        const persisted = localStorage.getItem(ACTIVE_SHELF_KEY);
        if (!persisted) return;
        if (result.shelves.some((shelf) => shelf.id === persisted)) {
          setActiveShelfId(persisted);
        } else {
          localStorage.removeItem(ACTIVE_SHELF_KEY);
        }
      } catch {
        /* localStorage unavailable — start with no active shelf */
      }
    });

    return () => {
      disposed = true;
    };
  }, []);

  const completedAtOf = useCallback(
    (gameId: string): number | undefined => completions.get(gameId),
    [completions]
  );

  const membership = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const shelf of shelves) {
      map.set(shelf.id, filterGamesByShelf(games, shelf.rules, completedAtOf));
    }
    return map;
  }, [shelves, games, completedAtOf]);

  const createShelf = useCallback(async (draft: ShelfDraft): Promise<Shelf | null> => {
    const shelf: Shelf = {
      id: draft.id ?? "",
      name: draft.name.trim(),
      icon: draft.icon || "layers",
      color: draft.color || "accent",
      rules: draft.rules ?? DEFAULT_SHELF_RULES,
      sort: draft.sort ?? "alphabetical",
      pinned: draft.pinned ?? false,
      position: draft.position ?? 0,
      createdAt: draft.createdAt ?? 0,
      updatedAt: draft.updatedAt ?? 0,
    };
    if (!shelf.name) return null;
    if (shelf.id === "" && shelves.length >= MAX_SHELVES) return null;
    try {
      const saved = await saveShelf(shelf);
      setShelves((prev) => [...prev, saved]);
      return saved;
    } catch {
      return null;
    }
  }, [shelves.length]);

  const updateShelf = useCallback(async (shelf: Shelf) => {
    try {
      const saved = await saveShelf(shelf);
      setShelves((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    } catch {
      /* ignore */
    }
  }, []);

  const deleteShelf = useCallback(async (id: string) => {
    try {
      await invoke("shelves_delete", { id });
      const wasActive = activeShelfId === id;
      setShelves((prev) => prev.filter((s) => s.id !== id));
      setActiveShelfId((current) => (current === id ? null : current));
      if (wasActive) {
        try {
          localStorage.removeItem(ACTIVE_SHELF_KEY);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }, [activeShelfId]);

  const reorderShelves = useCallback(async (ids: string[]) => {
    // Optimistic: apply the new order immediately, persist in the background.
    setShelves((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      const next: Shelf[] = [];
      ids.forEach((id, index) => {
        const shelf = byId.get(id);
        if (shelf) next.push({ ...shelf, position: index });
      });
      // Keep any shelf the caller didn't mention (defensive).
      for (const shelf of prev) if (!ids.includes(shelf.id)) next.push(shelf);
      return next;
    });
    try {
      await invoke("shelves_reorder", { ids });
    } catch {
      /* ignore */
    }
  }, []);

  const setCompletion = useCallback(async (gameId: string, completedAt: number) => {
    setCompletions((prev) => {
      const next = new Map(prev);
      if (completedAt === 0) next.delete(gameId);
      else next.set(gameId, completedAt);
      return next;
    });
    try {
      await invoke("shelves_set_completion", { gameId, completedAt });
    } catch {
      /* ignore */
    }
  }, []);

  // Record the completion timestamp as a game's play status flips to
  // "completed" (and clear it if the status moves away again), so
  // completion-date rules and "recently completed" sorting have real data.
  // The first sighting of each game is skipped, so an existing library is
  // never backfilled with today's date.
  const previousStatusRef = useRef<Map<string, PlayStatus>>(new Map());
  useEffect(() => {
    const previous = previousStatusRef.current;
    const next = new Map<string, PlayStatus>();
    for (const game of games) {
      const status = game.playStatus || "backlog";
      next.set(game.id, status);
      const before = previous.get(game.id);
      if (before === undefined || before === status) continue;
      if (status === "completed") void setCompletion(game.id, Date.now());
      else if (before === "completed") void setCompletion(game.id, 0);
    }
    previousStatusRef.current = next;
  }, [games, setCompletion]);

  const shelfGames = useCallback((id: string) => membership.get(id) ?? [], [membership]);
  const shelfCount = useCallback((id: string) => membership.get(id)?.length ?? 0, [membership]);
  const getShelf = useCallback((id: string) => shelves.find((s) => s.id === id), [shelves]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(SHELVES_ENABLED_KEY, next ? "true" : "false");
    } catch {
      /* ignore */
    }
    if (!next) {
      setActiveShelfId(null);
      try {
        localStorage.removeItem(ACTIVE_SHELF_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  /** Apply a shelf as the Library filter and persist the choice. */
  const setActiveShelf = useCallback((id: string | null) => {
    setActiveShelfId(id);
    try {
      if (id) localStorage.setItem(ACTIVE_SHELF_KEY, id);
      else localStorage.removeItem(ACTIVE_SHELF_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ShelfContextValue>(
    () => ({
      shelves,
      loading,
      activeShelfId,
      setActiveShelf,
      enabled,
      setEnabled,
      createShelf,
      updateShelf,
      deleteShelf,
      reorderShelves,
      shelfGames,
      shelfCount,
      completedAtOf,
      setCompletion,
      getShelf,
    }),
    [
      shelves,
      loading,
      activeShelfId,
      enabled,
      setEnabled,
      createShelf,
      updateShelf,
      deleteShelf,
      reorderShelves,
      shelfGames,
      shelfCount,
      completedAtOf,
      setCompletion,
      getShelf,
    ]
  );

  return <ShelfContext.Provider value={value}>{children}</ShelfContext.Provider>;
}

export function useShelves(): ShelfContextValue {
  const ctx = useContext(ShelfContext);
  if (!ctx) {
    throw new Error("useShelves must be used within a ShelfProvider");
  }
  return ctx;
}
