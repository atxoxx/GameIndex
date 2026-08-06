import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LibrarySource, PlayStatus } from "../types/game";
import { LIBRARY_FILTERS_STORAGE_KEY } from "../types/game";
import {
  EMPTY_LIBRARY_FILTERS,
  parseStoredFilters,
  type LibraryFilters,
  type LibrarySort,
  type LibraryStatus,
} from "../hooks/libraryFilters";

/**
 * LibraryFilterContext — single source of truth for the library filter
 * state, shared live by every consumer (the app Sidebar's game list, the
 * Library page's filter rail, and the Big Screen library).
 *
 * Why a context instead of the old "each consumer runs useLibraryFilters
 * and syncs via localStorage":
 *   - Before, Sidebar and LibraryPage each held their own `useState`
 *     copy. The `storage` event only fires across browser tabs/windows,
 *     so within a single window the two instances silently diverged the
 *     moment one of them changed a facet — the other only caught up on
 *     its next mount. Filtering in the Library page left the Sidebar's
 *     list, chips and badge stale until a remount.
 *   - Now every consumer reads the same context value, so a facet change
 *     propagates to all of them in the same render. Persistence still
 *     survives restarts (localStorage), and cross-tab sync still works
 *     via the `storage` event — both now handled once, here.
 */
interface LibraryFilterContextValue {
  filters: LibraryFilters;
  setSearch: (q: string) => void;
  setGenres: (g: string[]) => void;
  setPlatforms: (p: string[]) => void;
  setYearRange: (min: number | null, max: number | null) => void;
  setRatingMin: (r: number | null) => void;
  setStatus: (s: LibraryStatus) => void;
  setSource: (s: LibrarySource) => void;
  setPlayStatus: (ps: PlayStatus | "all") => void;
  setSort: (s: LibrarySort) => void;
  removeGenre: (g: string) => void;
  removePlatform: (p: string) => void;
  removeYear: () => void;
  removeRating: () => void;
  removeStatus: () => void;
  removePlayStatus: () => void;
  removeSearch: () => void;
  removeSource: () => void;
  reset: () => void;
}

const LibraryFilterContext = createContext<LibraryFilterContextValue | null>(null);

/** Read the persisted filter state from localStorage (safe init). */
function loadInitialFilters(): LibraryFilters {
  try {
    const raw = localStorage.getItem(LIBRARY_FILTERS_STORAGE_KEY);
    if (raw) return parseStoredFilters(JSON.parse(raw));
  } catch {
    // localStorage may be unavailable or the stored value corrupt.
  }
  return EMPTY_LIBRARY_FILTERS;
}

export function LibraryFilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<LibraryFilters>(loadInitialFilters);

  // Persist filter state to localStorage on every change so choices
  // survive app restarts. Mirrors the pattern used by useViewDensity
  // and useSizeUnit.
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // localStorage may throw in private browsing / sandboxed contexts.
    }
  }, [filters]);

  // Cross-tab sync: the `storage` event propagates writes from OTHER
  // windows/tabs (same origin). Within a single window the event doesn't
  // fire — but with the context every consumer in this window already
  // shares `filters`, so there's nothing to sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LIBRARY_FILTERS_STORAGE_KEY || !e.newValue) return;
      try {
        setFilters(parseStoredFilters(JSON.parse(e.newValue)));
      } catch {
        /* stored value unreadable — keep current in-memory state */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Bulk setters (replace the whole facet) ─────────────────────────
  const setSearch = useCallback(
    (q: string) => setFilters((f) => ({ ...f, search: q })),
    []
  );
  const setGenres = useCallback(
    (g: string[]) => setFilters((f) => ({ ...f, genres: g })),
    []
  );
  const setPlatforms = useCallback(
    (p: string[]) => setFilters((f) => ({ ...f, platforms: p })),
    []
  );
  const setYearRange = useCallback(
    (min: number | null, max: number | null) =>
      setFilters((f) => ({ ...f, yearMin: min, yearMax: max })),
    []
  );
  const setRatingMin = useCallback(
    (r: number | null) => setFilters((f) => ({ ...f, ratingMin: r })),
    []
  );
  const setStatus = useCallback(
    (s: LibraryStatus) => setFilters((f) => ({ ...f, status: s })),
    []
  );
  const setSource = useCallback(
    (s: LibrarySource) => setFilters((f) => ({ ...f, source: s })),
    []
  );
  const setPlayStatus = useCallback(
    (ps: PlayStatus | "all") => setFilters((f) => ({ ...f, playStatus: ps })),
    []
  );
  const setSort = useCallback(
    (s: LibrarySort) => setFilters((f) => ({ ...f, sort: s })),
    []
  );

  // ── Single-value removers (used by the chips) ──────────────────────
  const removeGenre = useCallback(
    (g: string) =>
      setFilters((f) => ({ ...f, genres: f.genres.filter((x) => x !== g) })),
    []
  );
  const removePlatform = useCallback(
    (p: string) =>
      setFilters((f) => ({
        ...f,
        platforms: f.platforms.filter((x) => x !== p),
      })),
    []
  );
  const removeYear = useCallback(
    () => setFilters((f) => ({ ...f, yearMin: null, yearMax: null })),
    []
  );
  const removeRating = useCallback(
    () => setFilters((f) => ({ ...f, ratingMin: null })),
    []
  );
  const removeStatus = useCallback(
    () => setFilters((f) => ({ ...f, status: "all" })),
    []
  );
  const removePlayStatus = useCallback(
    () => setFilters((f) => ({ ...f, playStatus: "all" })),
    []
  );
  const removeSearch = useCallback(
    () => setFilters((f) => ({ ...f, search: "" })),
    []
  );
  const removeSource = useCallback(
    () => setFilters((f) => ({ ...f, source: "all" })),
    []
  );
  const reset = useCallback(() => setFilters(EMPTY_LIBRARY_FILTERS), []);

  const value = useMemo<LibraryFilterContextValue>(
    () => ({
      filters,
      setSearch,
      setGenres,
      setPlatforms,
      setYearRange,
      setRatingMin,
      setStatus,
      setSource,
      setPlayStatus,
      setSort,
      removeGenre,
      removePlatform,
      removeYear,
      removeRating,
      removeStatus,
      removePlayStatus,
      removeSearch,
      removeSource,
      reset,
    }),
    [
      filters,
      setSearch,
      setGenres,
      setPlatforms,
      setYearRange,
      setRatingMin,
      setStatus,
      setSource,
      setPlayStatus,
      setSort,
      removeGenre,
      removePlatform,
      removeYear,
      removeRating,
      removeStatus,
      removePlayStatus,
      removeSearch,
      removeSource,
      reset,
    ]
  );

  return (
    <LibraryFilterContext.Provider value={value}>
      {children}
    </LibraryFilterContext.Provider>
  );
}

export function useLibraryFilterState(): LibraryFilterContextValue {
  const ctx = useContext(LibraryFilterContext);
  if (!ctx) {
    throw new Error("useLibraryFilterState must be used within a LibraryFilterProvider");
  }
  return ctx;
}
