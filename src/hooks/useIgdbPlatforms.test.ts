import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

/**
 * The Store filter sidebar maps over this list. A `null` payload used to reach
 * the state and crash the whole page ("Cannot read properties of null (reading
 * 'map')"), so the hook must always hand back an array.
 */
async function loadHook() {
  vi.resetModules();
  return import("./useIgdbPlatforms");
}

describe("useIgdbPlatforms", () => {
  beforeEach(() => {
    invoke.mockReset();
    cleanup();
  });

  it("keeps the platform list from the backend", async () => {
    invoke.mockResolvedValue([{ id: 6, name: "PC (Windows)" }]);
    const { useIgdbPlatforms } = await loadHook();
    const { result } = renderHook(() => useIgdbPlatforms());
    await act(async () => {});
    expect(result.current).toEqual([{ id: 6, name: "PC (Windows)" }]);
  });

  it("falls back to an empty array when the backend answers null", async () => {
    invoke.mockResolvedValue(null);
    const { useIgdbPlatforms } = await loadHook();
    const { result } = renderHook(() => useIgdbPlatforms());
    await act(async () => {});
    expect(result.current).toEqual([]);
    expect(Array.isArray(result.current)).toBe(true);
  });

  it("falls back to an empty array when the command fails", async () => {
    invoke.mockRejectedValue(new Error("no IGDB credentials"));
    const { useIgdbPlatforms } = await loadHook();
    const { result } = renderHook(() => useIgdbPlatforms());
    await act(async () => {});
    expect(result.current).toEqual([]);
  });
});
