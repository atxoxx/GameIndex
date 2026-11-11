import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Game } from "../../types/game";
import { LanguageProvider } from "../../context/LanguageContext";
import GameNewsTab from "./GameNewsTab";

/* ── IntersectionObserver harness ────────────────────────────────────
 * jsdom ships no observer; this fake records the sentinel target and lets a
 * test report an intersection by hand, which is exactly the "scrolled to the
 * bottom" moment the tab reacts to. */
interface FakeObserver {
  callback: IntersectionObserverCallback;
  targets: Element[];
  disconnected: boolean;
}

const observers: FakeObserver[] = [];

class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  targets: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  unobserve(target: Element) {
    this.targets = this.targets.filter((item) => item !== target);
  }

  disconnect() {
    this.disconnected = true;
    this.targets = [];
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/* ── Feed + Steam state the tab reads from its providers ───────────── */

const words = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
  "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey", "xray",
  "yankee", "zulu", "anchor", "beacon", "cobalt", "domino",
];

const demand = vi.hoisted(() => ({
  articles: [] as unknown[],
  loading: false,
  error: false,
  refresh: () => undefined,
  markRead: () => undefined,
  setRead: () => undefined,
  addToHistory: () => undefined,
  readLinks: new Set<string>(),
  savedLinks: new Set<string>(),
  saved: [] as unknown[],
  toggleSaved: () => undefined,
  loadArticle: async () => null,
}));

const steam = vi.hoisted(() => ({
  appId: undefined as number | undefined,
  isResolving: false,
}));

vi.mock("../../context/NewsContext", () => ({
  useNewsDemand: () => demand,
}));

vi.mock("../../hooks/useSteamAppId", () => ({
  useSteamAppId: () => ({ appId: steam.appId, isResolving: steam.isResolving }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => "",
}));

const game: Game = {
  id: "game-portal-2",
  name: "Portal 2",
  path: "",
  platform: "Steam",
  installed: true,
  playTime: "12h",
  addedAt: Date.now(),
};

function buildArticles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    title: `Portal 2 ${words[index]}`,
    link: `https://example.com/portal-${index}`,
    description: `Portal 2 story ${index}`,
    content: "",
    pubDate: new Date(Date.UTC(2026, 0, 28 - index)).toUTCString(),
    sourceName: "Example News",
    sourceUrl: "https://example.com",
    imageUrl: null,
  }));
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={["/?newsView=feed&newsDensity=list"]}>
      <LanguageProvider>
        <GameNewsTab game={game} />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function scrollToSentinel() {
  const sentinel = document.querySelector(".game-news-load-more");
  expect(sentinel).not.toBeNull();

  const observer = [...observers]
    .reverse()
    .find((item) => !item.disconnected && item.targets.includes(sentinel as Element));
  expect(observer).toBeDefined();

  act(() => {
    observer!.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  });
}

describe("GameNewsTab infinite scroll", () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    localStorage.clear();
    demand.articles = buildArticles(30);
    demand.loading = false;
    demand.error = false;
    steam.appId = undefined;
    steam.isResolving = false;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads the next page when the sentinel is reached, with no button", async () => {
    renderTab();

    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(screen.queryByText(/load more/i)).toBeNull();

    scrollToSentinel();

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(24),
    );
    // Still a third page left, so the sentinel stays and pages again.
    scrollToSentinel();

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(30),
    );
    expect(document.querySelector(".game-news-load-more")).toBeNull();
  });

  it("keeps the skeleton while the Steam id is still resolving", () => {
    demand.articles = [];
    steam.isResolving = true;

    const { container } = renderTab();

    expect(container.querySelectorAll(".skeleton-card").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no news found/i)).toBeNull();
  });

  it("fills a thin Steam RSS feed from the Web API without a scroll", async () => {
    steam.appId = 730;
    demand.articles = [];

    const thinRss = `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Steam</title>
      <item>
        <title>Portal 2 beta branch</title>
        <link>https://store.steampowered.com/news/app/730/view/1</link>
        <description>Beta notes</description>
        <pubDate>Wed, 07 Jan 2026 00:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;

    const apiJson = JSON.stringify({
      appnews: {
        count: 2,
        newsitems: [
          {
            gid: "900",
            title: "Portal 2 Zebra",
            contents: "[p]Fixed a test[/p]",
            feedlabel: "Steam",
            feedname: "steam_community_announcements",
            feed_type: 1,
            date: 1767744000,
          },
          {
            gid: "901",
            title: "Portal 2 Yak",
            contents: "[p]Fixed another test[/p]",
            feedlabel: "Steam",
            feedname: "steam_community_announcements",
            feed_type: 1,
            date: 1767657600,
          },
        ],
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("ISteamNews/GetNewsForApp")) {
        return { ok: true, status: 200, text: async () => apiJson };
      }
      return { ok: true, status: 200, text: async () => thinRss };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderTab();

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("ISteamNews/GetNewsForApp"),
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByText("Portal 2 Zebra")).toBeInTheDocument(),
    );
  });
});
