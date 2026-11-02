import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { PluginAvailabilityHit, PluginInfo } from "../types/plugins";
import type { StoreGameSummary } from "../types/game";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

function plugin(id: string, name: string, platformCategory = "pc"): PluginInfo {
  return {
    id,
    name,
    version: "1.0.0",
    author: "tester",
    description: "",
    sourceUrl: "",
    fileHash: "",
    filePath: "",
    enabled: true,
    importedAt: 0,
    lastError: null,
    platformCategory,
  } as PluginInfo;
}

function game(slug: string, name: string): StoreGameSummary {
  return { slug, name } as unknown as StoreGameSummary;
}

function hit(
  pluginId: string,
  matches: number,
  error: string | null = null
): PluginAvailabilityHit {
  return { pluginId, name: pluginId, platformCategory: "pc", matches, error };
}

/**
 * Wire the invoke mock: the plugin inventory loads once, the disk cache is
 * empty, and `plugins_check_availability` answers from `answers` keyed by
 * query. Unknown commands resolve undefined.
 */
function mockBackend(
  plugins: PluginInfo[],
  answers: Record<string, PluginAvailabilityHit[]>
) {
  mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "plugins_list") return plugins;
    if (command === "load_plugin_availability_cache") return "";
    if (command === "save_plugin_availability_cache") return undefined;
    if (command === "plugins_check_availability") {
      const { query } = args as { query: string };
      return answers[query] ?? [];
    }
    return undefined;
  });
}

import { usePluginAvailabilityCache } from "./usePluginAvailabilityCache";

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("usePluginAvailabilityCache", () => {
  it("keeps games a selected plugin returned hits for", async () => {
    mockBackend([plugin("p1", "Alpha")], {
      "Hollow Knight": [hit("p1", 2)],
      Celeste: [hit("p1", 0)],
    });

    const games = [game("hollow-knight", "Hollow Knight"), game("celeste", "Celeste")];
    const { result } = renderHook(() =>
      usePluginAvailabilityCache(games, ["p1"], "any")
    );

    await waitFor(() =>
      expect(result.current.visibleGames.map((g) => g.slug)).toEqual(["hollow-knight"])
    );
    expect(result.current.pluginCounts.p1).toEqual({ checked: 2, available: 1 });
    expect(result.current.availableSlugs.get("hollow-knight")).toBe(1);
    expect(result.current.uncheckedPlugins).toBe(0);
    expect(result.current.pending).toBe(0);
  });

  it("excludes games and surfaces the plugin when a probe errors", async () => {
    mockBackend([plugin("p1", "Alpha")], {
      Celeste: [hit("p1", 0, "missing API key")],
    });

    const { result } = renderHook(() =>
      usePluginAvailabilityCache([game("celeste", "Celeste")], ["p1"], "all")
    );

    await waitFor(() => expect(result.current.uncheckedPlugins).toBe(1));
    expect(result.current.visibleGames).toEqual([]);
    expect(result.current.pluginErrors.p1).toBe("missing API key");
    expect(result.current.pluginCounts.p1).toEqual({ checked: 1, available: 0 });
  });

  it("matches every selected plugin in all mode", async () => {
    mockBackend([plugin("p1", "Alpha"), plugin("p2", "Beta")], {
      Hades: [hit("p1", 1), hit("p2", 0)],
    });

    const { result } = renderHook(() =>
      usePluginAvailabilityCache([game("hades", "Hades")], ["p1", "p2"], "all")
    );

    await waitFor(() =>
      expect(result.current.pluginCounts.p2).toEqual({ checked: 1, available: 0 })
    );
    expect(result.current.visibleGames).toEqual([]);
  });

  it("does not probe while no plugin is selected", async () => {
    mockBackend([plugin("p1", "Alpha")], {});

    const { result } = renderHook(() =>
      usePluginAvailabilityCache([game("celeste", "Celeste")], [], "any")
    );

    await waitFor(() => expect(result.current.plugins).toHaveLength(1));
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "plugins_check_availability",
      expect.anything()
    );
    expect(result.current.visibleGames.map((g) => g.slug)).toEqual(["celeste"]);
  });
});
