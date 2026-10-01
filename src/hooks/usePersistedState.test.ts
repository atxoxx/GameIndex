import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePersistedState } from "./usePersistedState";

const KEY = "gamelib.test.view_mode_v1";
const ALLOWED = ["grid", "list", "timeline"] as const;
type Mode = (typeof ALLOWED)[number];

describe("usePersistedState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the default on first visit", () => {
    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));
    expect(result.current[0]).toBe("grid");
  });

  it("restores a valid persisted value on mount", () => {
    localStorage.setItem(KEY, "timeline");
    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));
    expect(result.current[0]).toBe("timeline");
  });

  it("falls back to the default when the stored value is unknown", () => {
    localStorage.setItem(KEY, "diagonal");
    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));
    expect(result.current[0]).toBe("grid");
  });

  it("persists a value set through the setter", () => {
    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));

    act(() => result.current[1]("list"));

    expect(result.current[0]).toBe("list");
    expect(localStorage.getItem(KEY)).toBe("list");
  });

  it("resolves a functional updater against the latest value", () => {
    localStorage.setItem(KEY, "list");
    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));

    act(() => result.current[1]((prev) => (prev === "list" ? "timeline" : "grid")));

    expect(result.current[0]).toBe("timeline");
    expect(localStorage.getItem(KEY)).toBe("timeline");
  });

  it("mirrors cross-tab storage events", () => {
    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "list" }));
    });

    expect(result.current[0]).toBe("list");
  });

  it("ignores storage events with unknown values", () => {
    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "bogus" }));
    });

    expect(result.current[0]).toBe("grid");
  });

  it("survives a localStorage read that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));
    expect(result.current[0]).toBe("grid");
  });

  it("survives a localStorage write that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const { result } = renderHook(() => usePersistedState<Mode>(KEY, "grid", ALLOWED));

    expect(() => act(() => result.current[1]("list"))).not.toThrow();
    expect(result.current[0]).toBe("list");
  });
});
