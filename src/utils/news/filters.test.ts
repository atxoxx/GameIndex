import { describe, expect, it } from "vitest";
import type { NewsArticle, NewsCluster } from "../../types/news";
import { activeFilterCount, emptyFilterState, filterClusters } from "./filters";

const NOW = Date.now();

function article(link: string, overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    link,
    title: `Story ${link}`,
    description: "A summary",
    content: "",
    pubDate: new Date(NOW - 3_600_000).toISOString(),
    sourceName: "PC Gamer",
    sourceUrl: "https://www.pcgamer.com/rss/",
    imageUrl: null,
    firstSeen: Math.floor(NOW / 1000) - 3_600,
    ...overrides,
  };
}

function cluster(link: string, overrides: Partial<NewsCluster> = {}): NewsCluster {
  const lead = article(link);
  return {
    id: link,
    lead,
    related: [],
    topics: [],
    unread: true,
    latestAt: new Date(lead.pubDate).getTime(),
    ...overrides,
  };
}

describe("filterClusters", () => {
  it("matches every search term across the headline and related outlets", () => {
    const target = cluster("a", {
      lead: article("a", { title: "Silksong release date confirmed" }),
      related: [article("b", { sourceName: "IGN", title: "Team Cherry speaks" })],
    });
    const other = cluster("c", {
      lead: article("c", { title: "Valve refreshes the Steam Deck" }),
    });

    const result = filterClusters(
      [target, other],
      emptyFilterState({ query: "silksong cherry" }),
    );
    expect(result.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("filters by source, topic and unread state together", () => {
    const match = cluster("a", {
      lead: article("a", { sourceName: "Eurogamer" }),
      topics: ["deals"],
    });
    const wrongSource = cluster("b", { topics: ["deals"] });
    const readCluster = cluster("c", { lead: article("c", { sourceName: "Eurogamer" }), unread: false });

    const result = filterClusters(
      [match, wrongSource, readCluster],
      emptyFilterState({ source: "Eurogamer", topics: ["deals"], unreadOnly: true }),
    );
    expect(result.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("drops stories outside the time range and keeps image-less ones optional", () => {
    const stale = cluster("old", {
      lead: article("old", { pubDate: new Date(NOW - 10 * 86_400_000).toISOString() }),
      latestAt: NOW - 10 * 86_400_000,
    });
    const freshNoImage = cluster("fresh");

    expect(filterClusters([stale, freshNoImage], emptyFilterState({ timeRange: "week" }))).toHaveLength(1);
    expect(
      filterClusters([stale, freshNoImage], emptyFilterState({ hasImagesOnly: true })),
    ).toHaveLength(0);
  });

  it("keeps the incoming order for signal sort and re-orders for newest", () => {
    const first = cluster("first", { latestAt: NOW - 10_000 });
    const second = cluster("second", { latestAt: NOW - 1_000 });

    expect(filterClusters([first, second], emptyFilterState()).map((entry) => entry.id)).toEqual([
      "first",
      "second",
    ]);
    expect(
      filterClusters([first, second], emptyFilterState({ sort: "newest" })).map(
        (entry) => entry.id,
      ),
    ).toEqual(["second", "first"]);
  });
});

describe("activeFilterCount", () => {
  it("counts each narrowing control once", () => {
    expect(activeFilterCount(emptyFilterState())).toBe(0);
    expect(
      activeFilterCount(
        emptyFilterState({ unreadOnly: true, source: "IGN", topics: ["deals"], timeRange: "today" }),
      ),
    ).toBe(4);
  });
});
