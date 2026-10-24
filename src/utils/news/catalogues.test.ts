import { describe, expect, it } from "vitest";
import type { NewsCardItem, NewsFeed } from "../../types/news";
import { mergeFeeds } from "./catalogues";
import { emptyFilterState, filterCardItems } from "./filters";

const DE_REGIONAL = "https://www.eurogamer.de/feed";

describe("mergeFeeds", () => {
  it("keeps the catalogue name but takes the stored enabled flag", () => {
    const stored: NewsFeed[] = [
      { name: "Stale name", url: "https://www.pcgamer.com/rss/", isDefault: true, enabled: false },
    ];
    const merged = mergeFeeds(stored, "en");
    const pcGamer = merged.find((feed) => feed.url === "https://www.pcgamer.com/rss/");

    expect(pcGamer?.name).toBe("PC Gamer");
    expect(pcGamer?.enabled).toBe(false);
  });

  it("appends custom feeds and only the active language's regional feeds", () => {
    const stored: NewsFeed[] = [
      {
        name: "My feed",
        url: "https://example.com/feed",
        isDefault: false,
        enabled: true,
        category: "tech",
      },
    ];

    expect(mergeFeeds(stored, "en").some((feed) => feed.url === DE_REGIONAL)).toBe(false);
    expect(mergeFeeds([], "de").some((feed) => feed.url === DE_REGIONAL)).toBe(true);

    const english = mergeFeeds(stored, "en");
    expect(english.find((feed) => feed.url === "https://example.com/feed")?.category).toBe("tech");
  });
});

function card(overrides: Partial<NewsCardItem> = {}): NewsCardItem {
  const article = {
    link: "https://example.com/a",
    title: "A story about Steam Deck",
    description: "Handheld hardware",
    content: "",
    pubDate: new Date().toISOString(),
    sourceName: "PC Gamer",
    sourceUrl: "",
    imageUrl: null,
  };
  return { key: article.link, article, related: [], topics: ["pc"], unread: true, ...overrides };
}

describe("filterCardItems", () => {
  it("matches query and topics for saved/history rows", () => {
    const items = [
      card(),
      card({
        key: "b",
        topics: ["deals"],
        article: { ...card().article, link: "https://example.com/b", title: "A bundle" },
      }),
    ];

    expect(filterCardItems(items, emptyFilterState({ query: "steam" }))).toHaveLength(1);
    expect(filterCardItems(items, emptyFilterState({ topics: ["deals"] }))).toHaveLength(1);
  });

  it("can ignore unread and time for saved rows", () => {
    const base = card();
    const old = card({
      key: "old",
      article: {
        ...base.article,
        pubDate: new Date(Date.now() - 90 * 86_400_000).toISOString(),
      },
      unread: false,
    });

    expect(
      filterCardItems([old], emptyFilterState({ unreadOnly: true, timeRange: "week" }), {
        ignoreUnread: true,
        ignoreTime: true,
      }),
    ).toHaveLength(1);
  });
});
