import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useMapSuggestions } from "./useMapSuggestions";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("useMapSuggestions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("debounces a query and returns titles", async () => {
    invokeMock.mockResolvedValue(["STALKER 2: Heart of Chornobyl"]);
    const { result } = renderHook(() => useMapSuggestions("stalk", true));

    expect(invokeMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(invokeMock).toHaveBeenCalledWith("search_map_games", {
      query: "stalk",
      limit: 8,
    });
    expect(result.current).toEqual(["STALKER 2: Heart of Chornobyl"]);
  });

  it("does not query below two characters or while disabled", async () => {
    const { rerender } = renderHook(
      ({ query, enabled }: { query: string; enabled: boolean }) =>
        useMapSuggestions(query, enabled),
      { initialProps: { query: "s", enabled: true } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(invokeMock).not.toHaveBeenCalled();

    rerender({ query: "stalk", enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("falls back to no suggestions when the lookup fails", async () => {
    invokeMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMapSuggestions("stalk", true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current).toEqual([]);
  });
});
