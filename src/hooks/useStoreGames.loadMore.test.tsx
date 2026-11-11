import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { StoreGameSummary } from "../types/game";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// The disk/category cache is irrelevant here: every fetch should go to the
// mocked backend so the assertions see the exact invoke payloads.
vi.mock("./useStoreCache", () => ({
  useStoreCache: () => ({
    getCategoryCache: () => null,
    setCategoryCache: vi.fn(),
  }),
  getCachedSearch: () => null,
  setCachedSearch: vi.fn(),
  dedupedSearchFetch: (_key: string, fetcher: () => Promise<StoreGameSummary[]>) =>
    fetcher(),
  buildSearchCacheKey: () => "search-key",
  buildFiltersKey: () => "{}",
}));

import { invoke } from "@tauri-apps/api/core";
import { useStoreGames } from "./useStoreGames";

const mockedInvoke = vi.mocked(invoke);

function games(count: number, startId: number): StoreGameSummary[] {
  return Array.from({ length: count }, (_, i) => {
    const id = startId + i;
    return {
      id,
      name: `Game ${id}`,
      slug: `game-${id}`,
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
    };
  });
}

function searchCalls(): unknown[][] {
  return mockedInvoke.mock.calls.filter(([command]) => command === "search_store_games");
}

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("useStoreGames pagination", () => {
  it("applies an immediate query and pages it with the same query", async () => {
    // Page 1 (offset 20) repeats id 19, which is what an unstable IGDB offset
    // returns in practice.
    mockedInvoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "fetch_store_games") return Promise.resolve(games(3, 100));
      const { offset } = args as { offset: number };
      return Promise.resolve(offset === 0 ? games(20, 0) : games(20, 19));
    });

    const { result } = renderHook(() => useStoreGames());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSearchQueryImmediate("elden ring"));

    // The controlled input reads this, so a recent-search click must land here.
    await waitFor(() => expect(result.current.searchQuery).toBe("elden ring"));
    await waitFor(() => expect(result.current.games).toHaveLength(20));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(searchCalls()[0][1]).toMatchObject({
      query: "elden ring",
      offset: 0,
    });

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.games).toHaveLength(39));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(searchCalls()).toHaveLength(2);
    expect(searchCalls()[1][1]).toMatchObject({
      query: "elden ring",
      offset: 20,
    });
    const ids = result.current.games.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses to load more while the fresh search page is in flight", async () => {
    const page = games(20, 0);
    let release: (rows: StoreGameSummary[]) => void = () => {};

    mockedInvoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "fetch_store_games") return Promise.resolve(games(3, 100));
      const { offset } = args as { offset: number };
      if (offset === 0) {
        return new Promise<StoreGameSummary[]>((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(games(20, 200));
    });

    const { result } = renderHook(() => useStoreGames());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSearchQueryImmediate("hades"));
    expect(searchCalls()).toHaveLength(1);

    // A scroll-triggered load more must not queue a category page onto the
    // still-empty search list.
    act(() => result.current.loadMore());
    expect(searchCalls()).toHaveLength(1);
    expect(mockedInvoke.mock.calls.filter(([c]) => c === "fetch_store_games")).toHaveLength(1);

    await act(async () => {
      release(page);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.games.map((g) => g.id)).toEqual(page.map((g) => g.id));
  });
});
