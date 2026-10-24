import { describe, expect, it } from "vitest";
import type { NewsArticle, NewsCluster } from "../../types/news";
import { countNewSince, rankClusters, scoreCluster, type RankContext } from "./ranking";

const NOW = new Date("2026-10-24T12:00:00Z").getTime();

function article(overrides: Partial<NewsArticle> & { link: string }): NewsArticle {
  return {
    title: "A story",
    description: "",
    content: "",
    pubDate: "2026-10-24T10:00:00Z",
    sourceName: "PC Gamer",
    sourceUrl: "https://www.pcgamer.com/rss/",
    imageUrl: null,
    firstSeen: Math.floor(NOW / 1000) - 7_200,
    ...overrides,
  };
}

function cluster(overrides: Partial<NewsCluster> & { lead: NewsArticle }): NewsCluster {
  return {
    id: overrides.lead.link,
    related: [],
    topics: [],
    unread: true,
    latestAt: new Date(overrides.lead.pubDate).getTime(),
    ...overrides,
  };
}

function context(overrides: Partial<RankContext> = {}): RankContext {
  return {
    now: NOW,
    readLinks: new Set(),
    relatedGames: new Map(),
    followedTopics: new Set(),
    mutedTopics: new Set(),
    ...overrides,
  };
}

describe("scoreCluster", () => {
  it("rewards an owned-game match above a newer generic story", () => {
    const owned = cluster({
      lead: article({ link: "owned", title: "Elden Ring gets a patch", pubDate: "2026-10-24T04:00:00Z" }),
    });
    const generic = cluster({
      lead: article({ link: "generic", title: "Studio hires new writer", pubDate: "2026-10-24T11:00:00Z" }),
    });
    const ctx = context({ relatedGames: new Map([["owned", "Elden Ring"]]) });

    expect(scoreCluster(owned, ctx)).toBeGreaterThan(scoreCluster(generic, ctx));
  });

  it("boosts followed topics and ignores muted ones in ranking", () => {
    const deals = cluster({
      lead: article({ link: "deals", title: "Big sale" }),
      topics: ["deals"],
    });
    const plain = cluster({
      lead: article({ link: "plain", title: "Studio news" }),
    });
    const ctx = context({ followedTopics: new Set(["deals"]) });

    expect(scoreCluster(deals, ctx)).toBeGreaterThan(scoreCluster(plain, ctx));
    expect(rankClusters([deals, plain], { ...ctx, mutedTopics: new Set(["deals"]) })).toEqual([
      plain,
    ]);
  });

  it("prefers unread over read at the same age", () => {
    const unread = cluster({ lead: article({ link: "u" }), unread: true });
    const read = cluster({ lead: article({ link: "r" }), unread: false });
    const ctx = context();
    expect(scoreCluster(unread, ctx)).toBeGreaterThan(scoreCluster(read, ctx));
  });
});

describe("rankClusters", () => {
  it("spreads one prolific source across the top of the feed", () => {
    const clusters = [
      cluster({ lead: article({ link: "1", sourceName: "IGN", title: "One" }) }),
      cluster({ lead: article({ link: "2", sourceName: "IGN", title: "Two" }) }),
      cluster({ lead: article({ link: "3", sourceName: "IGN", title: "Three" }) }),
      cluster({ lead: article({ link: "4", sourceName: "Eurogamer", title: "Four" }) }),
    ];

    const ranked = rankClusters(clusters, context());
    // The first three were tied on score; the fourth slot must break the run.
    expect(ranked.slice(0, 3).map((entry) => entry.lead.sourceName)).toContain("Eurogamer");
  });

  it("falls back to newest-first when scores tie", () => {
    const older = cluster({ lead: article({ link: "a", pubDate: "2026-10-24T08:00:00Z" }) });
    const newer = cluster({ lead: article({ link: "b", pubDate: "2026-10-24T11:00:00Z" }) });
    const ranked = rankClusters([older, newer], context());
    expect(ranked[0].lead.link).toBe("b");
  });
});

describe("countNewSince", () => {
  it("counts only stories first seen after the last visit", () => {
    const lastVisit = Date.now() - 60 * 60 * 1000;
    const fresh = cluster({
      lead: article({ link: "fresh", firstSeen: Math.floor(Date.now() / 1000) - 120 }),
    });
    const old = cluster({
      lead: article({ link: "old", firstSeen: Math.floor(Date.now() / 1000) - 7_200 }),
    });
    expect(countNewSince([fresh, old], lastVisit)).toBe(1);
  });
});
