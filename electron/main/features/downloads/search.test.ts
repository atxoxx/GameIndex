/**
 * Download-search pipeline: per-plugin retry and progress behaviour.
 */
import { describe, expect, it, vi } from "vitest";

import { runDownloadSearch, type DownloadSearchDeps } from "./search";

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
