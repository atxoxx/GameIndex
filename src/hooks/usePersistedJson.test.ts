import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePersistedJson } from "./usePersistedJson";

const KEY = "test.deals.filters";
const DEFAULTS = { store: "all", minDiscount: 0, wishlistOnly: false };

describe("usePersistedJson", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("hydrates a stored filter set and merges it over the defaults", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ store: "gog", minDiscount: 50, wishlistOnly: true }),
    );

    const { result } = renderHook(() => usePersistedJson(KEY, DEFAULTS));
    expect(result.current[0]).toEqual({
      store: "gog",
      minDiscount: 50,
      wishlistOnly: true,
    });
  });

  it("ignores fields whose type no longer matches the defaults", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ store: 42, minDiscount: "a lot", wishlistOnly: true }),
    );

    const { result } = renderHook(() => usePersistedJson(KEY, DEFAULTS));
    expect(result.current[0]).toEqual({
      store: "all",
      minDiscount: 0,
      wishlistOnly: true,
    });
  });

  it("falls back on corrupt JSON and writes the next value", () => {
    localStorage.setItem(KEY, "{not json");

    const { result } = renderHook(() => usePersistedJson(KEY, DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);

    act(() => {
      result.current[1]((prev) => ({ ...prev, store: "steam" }));
    });

    expect(result.current[0].store).toBe("steam");
    expect(JSON.parse(localStorage.getItem(KEY) as string).store).toBe("steam");
  });
});
