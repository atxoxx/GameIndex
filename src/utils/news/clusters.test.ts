import { describe, expect, it } from "vitest";
import type { NewsArticle } from "../../types/news";
import { buildClusters, titleTokens } from "./clusters";
import { topicsForArticle } from "./topics";

function article(overrides: Partial<NewsArticle> & { link: string }): NewsArticle {
  return {
    title: "Untitled",
    description: "",
    content: "",
    pubDate: "2026-10-24T10:00:00Z",
    sourceName: "PC Gamer",
    sourceUrl: "https://www.pcgamer.com/rss/",
    imageUrl: null,
    firstSeen: 1_760_000_000,
    ...overrides,
  };
}

describe("titleTokens", () => {
  it("drops stopwords, generics, punctuation and bare numbers", () => {
    expect(titleTokens("The 10 best games of 2026 are here!")).toEqual(["best"]);
    expect(titleTokens("Silksong gets a release date")).toEqual(["silksong", "release", "date"]);
  });
});

describe("buildClusters", () => {
  it("collapses the same story from several outlets into one cluster", () => {
    const articles = [
      article({
        link: "a",
        title: "Hollow Knight Silksong finally gets a release date",
        sourceName: "PC Gamer",
        imageUrl: "https://example.com/a.jpg",
      }),
      article({
        link: "b",
        title: "Hollow Knight Silksong finally has a release date",
        sourceName: "Eurogamer",
      }),
      article({
        link: "c",
        title: "Silksong release date announced by Team Cherry",
        sourceName: "IGN",
      }),
      article({
        link: "d",
        title: "Valve announces a new Steam Deck revision",
        sourceName: "VGC",
      }),
    ];

    const clusters = buildClusters(articles, new Set(), new Map());
    const silksong = clusters.find((cluster) => cluster.lead.title.includes("Silksong"));

    expect(clusters).toHaveLength(2);
    expect(silksong?.related.map((entry) => entry.link).sort()).toEqual(["b", "c"]);
    // Lead prefers the article with artwork.
    expect(silksong?.lead.link).toBe("a");
  });

  it("keeps unrelated stories apart even when they share a topic", () => {
    const articles = [
      article({ link: "a", title: "Nintendo Direct dated for next week" }),
      article({ link: "b", title: "Nintendo Switch 2 price drops in Japan" }),
      article({ link: "c", title: "A new Mario film is in production" }),
    ];

    const clusters = buildClusters(articles, new Set(), new Map());
    expect(clusters).toHaveLength(3);
  });

  it("marks a cluster unread when any of its articles is unread", () => {
    const articles = [
      article({ link: "a", title: "Silksong release date confirmed" }),
      article({ link: "b", title: "Silksong release date is confirmed", sourceName: "IGN" }),
    ];
    const readLinks = new Set(["a"]);
    const clusters = buildClusters(articles, readLinks, new Map());
    expect(clusters[0].unread).toBe(true);
  });
});

describe("topicsForArticle", () => {
  it("combines the feed category with headline matches", () => {
    const topics = topicsForArticle(
      { title: "Steam Deck OLED gets a price drop", description: "" },
      "tech",
    );
    expect(topics).toContain("tech");
    expect(topics).toContain("pc");
    expect(topics).toContain("deals");
  });

  it("returns no topics for a plain general story", () => {
    expect(
      topicsForArticle({ title: "A quiet week in the industry", description: "" }, "general"),
    ).toEqual([]);
  });
});
