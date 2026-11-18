/**
 * Download-search pipeline: per-plugin retry and progress behaviour.
 */
import { describe, expect, it, vi } from "vitest";

import { runDownloadSearch, type DownloadSearchDeps } from "./search";
import type { PluginDownloadResult } from "../plugins/types";
import type { MatchedDownload } from "../../../../src/types/source";

function pluginRow(title: string): PluginDownloadResult {
  return {
    id: `p:${title}`,
    sourceName: "Plugin One",
    sourceId: "p1",
    title,
    fileSize: "1 GB",
    uris: [`magnet:?xt=urn:btih:${"a".repeat(40)}`],
    magnet: null,
    uploadDate: null,
    matchScore: 0.9,
    isNew: false,
    provider: "plugin",
    pluginId: "p1",
    infohash: "a".repeat(40),
    seeds: 5,
    peers: 1,
    torrentUrl: null,
    verified: null,
    detailUrl: null,
    platform: null,
    provenance: null,
    referer: null,
    platformCategory: "pc",
    matchTitle: null,
    fileList: null,
    checksums: null,
    version: null,
    region: null,
    coverUrl: null,
    description: null,
    releaseGroup: null,
    recommended: null,
  };
}

function sourceRow(title: string): MatchedDownload {
  return {
    sourceName: "Custom Source",
    sourceId: "src-1",
    title,
    fileSize: "2 GB",
    uris: ["https://example.com/game.torrent"],
    magnet: null,
    uploadDate: null,
    matchScore: 0.85,
    isNew: false,
  };
}

function deps(overrides: Partial<DownloadSearchDeps> = {}): DownloadSearchDeps {
  return {
    listPlugins: () => [{ id: "p1", name: "Plugin One", platformCategory: "pc" }],
    searchPlugin: async () => [],
    pluginError: () => null,
    searchSources: () => [],
    ...overrides,
  };
}

describe("runDownloadSearch plugin retries", () => {
  it("retries with the cleaned query when a plugin simply found nothing", async () => {
    const searchPlugin = vi.fn(async () => []);
    await runDownloadSearch({ query: "Stellar Odyssey (2020)" }, deps({ searchPlugin }));

    expect(searchPlugin).toHaveBeenCalledTimes(2);
    // The retry drops the year/punctuation a substring index would not match.
    expect(searchPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1" }),
      "Stellar Odyssey",
      expect.anything(),
    );
  });

  it("does not retry a plugin that just failed", async () => {
    const searchPlugin = vi.fn(async () => []);
    const outcome = await runDownloadSearch(
      { query: "Stellar Odyssey (2020)" },
      deps({
        searchPlugin,
        pluginError: () => "plugin p1 timed out after 20s",
      }),
    );

    // A second sandbox would only duplicate the upstream traffic; the recorded
    // failure becomes the error row instead.
    expect(searchPlugin).toHaveBeenCalledTimes(1);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].title).toContain("timed out");
  });
});

describe("runDownloadSearch aliases", () => {
  it("retries an empty plugin with the first alternative name", async () => {
    const searchPlugin = vi.fn(async (_plugin, query: string) =>
      query === "Star Odyssey" ? [pluginRow("Star Odyssey")] : [],
    );
    const outcome = await runDownloadSearch(
      { query: "Stellar Odyssey", aliases: ["Star Odyssey"] },
      deps({ searchPlugin }),
    );

    expect(searchPlugin).toHaveBeenCalledWith(
      expect.anything(),
      "Star Odyssey",
      expect.anything(),
    );
    expect(outcome.results.map((row) => row.title)).toContain("Star Odyssey");
  });

  it("passes aliases to the cached-source index", async () => {
    const searchSources = vi.fn((_query: string, _aliases?: readonly string[]) => [
      sourceRow("The Witcher 3: Wild Hunt"),
    ]);
    const outcome = await runDownloadSearch(
      { query: "Witcher 3", aliases: ["Wiedźmin 3"] },
      deps({ searchSources, listPlugins: () => [] }),
    );

    expect(searchSources).toHaveBeenCalledWith("Witcher 3", ["Wiedźmin 3"]);
    expect(outcome.results[0].title).toBe("The Witcher 3: Wild Hunt");
  });
});
