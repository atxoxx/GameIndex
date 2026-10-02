import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useGameMaps } from "./useGameMaps";
import type { MapSourceResult } from "../types/game";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const sources: MapSourceResult[] = [
  {
    id: "mapgenie",
    label: "MapGenie",
    title: "Elden Ring",
    url: "https://mapgenie.io/elden-ring/maps/the-lands-between",
    maps: [
      {
        title: "The Lands Between",
        url: "https://mapgenie.io/elden-ring/maps/the-lands-between",
      },
    ],
  },
  {
    id: "wand",
    label: "Wand",
    title: "Elden Ring",
    url: "https://wand.com/maps/elden-ring",
    maps: [{ title: "Elden Ring", url: "https://wand.com/maps/elden-ring" }],
  },
];

describe("useGameMaps", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns every resolved provider", async () => {
    invokeMock.mockResolvedValue(sources);

    const { result } = renderHook(() => useGameMaps("Elden Ring"));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.sources).toHaveLength(2);
    expect(invokeMock).toHaveBeenCalledWith("fetch_game_maps", {
      gameName: "Elden Ring",
    });
  });

  it("reports an empty ready result when no provider matches", async () => {
    invokeMock.mockResolvedValue([]);

    const { result } = renderHook(() => useGameMaps("Some Obscure Game"));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.sources).toEqual([]);
  });

  it("treats a failed lookup as empty instead of throwing", async () => {
    invokeMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useGameMaps("Elden Ring"));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.sources).toEqual([]);
  });

  it("never queries the backend for a blank name", () => {
    const { result } = renderHook(() => useGameMaps("   "));

    expect(result.current.status).toBe("ready");
    expect(result.current.sources).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
