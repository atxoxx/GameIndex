import { describe, expect, it, vi } from "vitest";
import type { StoreGameSummary } from "../types/game";

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
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../context/GameContext", () => ({
  useGames: () => ({ addStoreGame: vi.fn() }),
}));

vi.mock("./useStoreGames", () => ({
  useStoreGames: () => ({}),
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

import { sortSearchResults } from "./useStoreCatalogue";

function game(overrides: Partial<StoreGameSummary> & { name: string }): StoreGameSummary {
  return {
    id: 0,
    slug: overrides.name.toLowerCase().replace(/\s+/g, "-"),
    summary: null,
    rating: null,
    aggregatedRating: null,
    coverUrl: null,
    logoUrl: null,
    genres: [],
    platforms: [],
    firstReleaseDate: null,
    totalRatingCount: 0,
    hypes: 0,
    ...overrides,
  };
}

describe("sortSearchResults", () => {
  it("orders by popularity (total rating count) descending", () => {
    const modest = game({ name: "Modest", totalRatingCount: 120 });
    const huge = game({ name: "Huge", totalRatingCount: 9000 });

    const result = sortSearchResults([modest, huge], "popularity");

    expect(result.map((g) => g.name)).toEqual(["Huge", "Modest"]);
  });

  it("orders the whole set by rating, including out-of-order input", () => {
    const low = game({ name: "Low", rating: 10 });
    const high = game({ name: "High", rating: 99 });

    const result = sortSearchResults([low, high], "rating");

    expect(result.map((g) => g.name)).toEqual(["High", "Low"]);
  });

  it("sorts by the real follows field, not hypes", () => {
    const quiet = game({ name: "Quiet", follows: 5, hypes: 9999 });
    const followed = game({ name: "Followed", follows: 80, hypes: 0 });

    const result = sortSearchResults([quiet, followed], "follows");

    expect(result.map((g) => g.name)).toEqual(["Followed", "Quiet"]);
  });

  it("treats a missing follows count as zero", () => {
    const missing = game({ name: "Missing" });
    const some = game({ name: "Some", follows: 3 });

    const result = sortSearchResults([missing, some], "follows");

    expect(result.map((g) => g.name)).toEqual(["Some", "Missing"]);
  });
});
