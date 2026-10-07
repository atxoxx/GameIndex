import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useModBookmarks } from "./useModBookmarks";
import type { RemoteModSummary } from "../../../types/mods";

const mockMod: RemoteModSummary = {
  source: "nexus",
  id: "12345",
  name: "Immersive Armor",
  author: "Hothtrooper44",
  summary: "Adds countless new lore-friendly armors.",
  url: "https://www.nexusmods.com/skyrim/mods/12345",
  downloads: 5000000,
  endorsements: 120000,
};

describe("useModBookmarks", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with empty bookmarks list", () => {
    const { result } = renderHook(() => useModBookmarks("game-1"));
    expect(result.current.bookmarks).toEqual([]);
    expect(result.current.isBookmarked("nexus", "12345")).toBe(false);
  });

  it("toggles bookmark adding and removing", () => {
    const { result } = renderHook(() => useModBookmarks("game-1"));

    // Add bookmark
    act(() => {
      const added = result.current.toggleBookmark(mockMod, "game-1", "Skyrim");
      expect(added).toBe(true);
    });

    expect(result.current.bookmarks.length).toBe(1);
    expect(result.current.isBookmarked("nexus", "12345")).toBe(true);
    expect(result.current.bookmarks[0].mod.name).toBe("Immersive Armor");

    // Toggle again to remove
    act(() => {
      const added = result.current.toggleBookmark(mockMod, "game-1", "Skyrim");
      expect(added).toBe(false);
    });

    expect(result.current.bookmarks.length).toBe(0);
    expect(result.current.isBookmarked("nexus", "12345")).toBe(false);
  });

  it("clears bookmarks for a game", () => {
    const { result } = renderHook(() => useModBookmarks("game-1"));

    act(() => {
      result.current.toggleBookmark(mockMod, "game-1", "Skyrim");
    });
    expect(result.current.bookmarks.length).toBe(1);

    act(() => {
      result.current.clearBookmarks("game-1");
    });
    expect(result.current.bookmarks.length).toBe(0);
  });
});
