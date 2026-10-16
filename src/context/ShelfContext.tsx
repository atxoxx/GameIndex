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

/** Prefix marking a starter shelf whose `name` is an i18n key. */
const STARTER_NAME_PREFIX = "shelves.starter.";

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

export function ShelfProvider({ children }: { children: ReactNode }) {
  const { games } = useGames();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const [completions, setCompletions] = useState<Map<string, number>>(new Map());
  // Ensures seeding runs at most once per mounted provider, even under React
  // StrictMode's double-invoked effects (which otherwise seeds the starter
  // set twice before the localStorage flag is written).
  const seededRef = useRef(false);

  // Hydrate shelves + completion timestamps, seeding/migrating on first run.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    let cancelled = false;
    (async () => {
      let loaded: Shelf[] = [];
      try {
        loaded = await invoke<Shelf[]>("shelves_list");
      } catch {
        // Invoke unavailable (plain `npm run dev`) — run in-memory only.
      }

      try {
        if (!localStorage.getItem(SHELVES_SEEDED_KEY)) {
          const migrated: Shelf[] = loadFilterPresets().map(shelfFromPreset);
          for (const shelf of migrated) {
            try {
              loaded.push(await saveShelf(shelf));
            } catch {
              /* one bad preset shouldn't block the rest */
            }
          }
          // A fresh install (nothing migrated) gets the starter set.
          if (migrated.length === 0 && loaded.length === 0) {
            for (const shelf of starterShelves(Date.now())) {
              try {
                loaded.push(await saveShelf(shelf));
              } catch {
                /* ignore */
              }
            }
          }
          localStorage.setItem(SHELVES_SEEDED_KEY, "1");
          localStorage.removeItem(FILTER_PRESETS_STORAGE_KEY);
        }

        // One-time heal: early builds could seed the starter set twice,
        // leaving duplicate "shelves.starter.*" rows. Keep the first of each
        // and delete the rest.
        if (!localStorage.getItem(SHELVES_DEDUPE_KEY)) {
          const seen = new Set<string>();
          const kept: Shelf[] = [];
          for (const shelf of loaded) {
            if (shelf.name.startsWith(STARTER_NAME_PREFIX)) {
              if (seen.has(shelf.name)) {
                try {
                  await invoke("shelves_delete", { id: shelf.id });
                } catch {
                  /* keep the row in memory if the delete fails */
                }
                continue;
              }
              seen.add(shelf.name);
            }
            kept.push(shelf);
          }
          loaded = kept;
          localStorage.setItem(SHELVES_DEDUPE_KEY, "1");
        }
      } catch {
        // localStorage unavailable — skip seeding.
      }

      let completionRows: [string, number][] = [];
      try {
        completionRows = await invoke<[string, number][]>("shelves_completions");
      } catch {
        /* ignore */
      }

      if (!cancelled) {
        setShelves(loaded);
        setCompletions(new Map(completionRows));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
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
      setShelves((prev) => prev.filter((s) => s.id !== id));
      setActiveShelfId((current) => (current === id ? null : current));
    } catch {
      /* ignore */
    }
  }, []);

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

  const value = useMemo<ShelfContextValue>(
    () => ({
      shelves,
      loading,
      activeShelfId,
      setActiveShelf: setActiveShelfId,
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
