import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { StoreGameSummary } from "../types/game";
import { COMPARE_MAX } from "../components/store/storeCompare";

const showToast = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("../context/DensityContext", () => ({
  useDensityContext: () => ({ density: "cozy", setDensity: vi.fn() }),
}));

vi.mock("../context/SourceContext", () => ({
  useSources: () => ({ sources: [], loading: false }),
}));

vi.mock("../context/WishlistContext", () => ({
  useWishlistContext: () => ({ isWishlisted: () => false, toggle: vi.fn() }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../context/GameContext", () => ({
  useGames: () => ({ addStoreGame: vi.fn() }),
}));

vi.mock("./useStoreGames", () => ({
  useStoreGames: () => ({
    games: [],
    loading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    searchQuery: "",
    setSearchQuery: vi.fn(),
    applyExternalQuery: vi.fn(),
    flushSearch: vi.fn(),
    setSearchQueryImmediate: vi.fn(),
    isSearching: false,
    applyFilters: vi.fn(),
    resetFilters: vi.fn(),
    clearSearch: vi.fn(),
    sort: "default",
    setSort: vi.fn(),
  }),
}));

vi.mock("./useLibraryIndex", () => ({
  useLibraryIndex: () => ({ isInLibrary: () => false }),
}));

vi.mock("./useHiddenGames", () => ({
  useHiddenGames: () => ({ count: 0, hiddenSet: new Set(), hide: vi.fn() }),
}));

vi.mock("./useRecentlyViewed", () => ({
  useRecentlyViewed: () => ({ items: [], record: vi.fn() }),
}));

vi.mock("./useRecentSearches", () => ({
  useRecentSearches: () => ({
    searches: [],
    record: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock("./useIgdbPlatforms", () => ({
  useIgdbPlatforms: () => [],
}));

vi.mock("./useSourceAvailabilityCache", () => ({
  useSourceAvailabilityCache: (games: StoreGameSummary[]) => ({
    visibleGames: games,
    pending: 0,
    isFilterActive: false,
    sourceCounts: {},
  }),
}));

import { useStoreCatalogue } from "./useStoreCatalogue";

function game(slug: string): StoreGameSummary {
  return { slug, name: slug.toUpperCase() } as unknown as StoreGameSummary;
}

const storageBacking = new Map<string, string>();

beforeEach(() => {
  showToast.mockClear();
  storageBacking.clear();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storageBacking.get(key) ?? null,
      setItem: (key: string, value: string) => storageBacking.set(key, value),
      removeItem: (key: string) => storageBacking.delete(key),
      clear: () => storageBacking.clear(),
      key: () => null,
      length: 0,
    },
  });
});

afterEach(cleanup);

describe("useStoreCatalogue compare state", () => {
  it("toggles games in and out and persists the set", () => {
    const { result } = renderHook(() => useStoreCatalogue());

    act(() => result.current.toggleCompare(game("a")));
    act(() => result.current.toggleCompare(game("b")));
    expect(result.current.compareGames.map((g) => g.slug)).toEqual(["a", "b"]);
    expect(result.current.compareSlugs.has("a")).toBe(true);
    expect(storageBacking.get("gamelib_store_compare_v1")).toContain('"a"');

    act(() => result.current.toggleCompare(game("a")));
    expect(result.current.compareGames.map((g) => g.slug)).toEqual(["b"]);

    act(() => result.current.removeCompare("b"));
    expect(result.current.compareGames).toEqual([]);
  });

  it("ignores duplicates and warns once the cap is reached", () => {
    const { result } = renderHook(() => useStoreCatalogue());

    act(() => {
      for (let i = 0; i < COMPARE_MAX; i += 1) {
        result.current.addCompare(game(`g${i}`));
      }
    });
    expect(result.current.compareGames.length).toBe(COMPARE_MAX);
    expect(showToast).not.toHaveBeenCalled();

    act(() => result.current.addCompare(game("overflow")));
    expect(result.current.compareGames.length).toBe(COMPARE_MAX);
    expect(showToast).toHaveBeenCalledWith("store.compare.full", "info");

    act(() => result.current.addCompare(game("g0")));
    expect(result.current.compareGames.length).toBe(COMPARE_MAX);
  });

  it("clears the pinned set", () => {
    const { result } = renderHook(() => useStoreCatalogue());

    act(() => result.current.toggleCompare(game("a")));
    act(() => result.current.clearCompare());
    expect(result.current.compareGames).toEqual([]);
    expect(storageBacking.get("gamelib_store_compare_v1")).toBe("[]");
  });
});
