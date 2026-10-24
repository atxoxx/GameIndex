import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NewsProvider, useNewsDemand } from "./NewsContext";

const { setPref, ingest, snapshot } = vi.hoisted(() => {
  const article = {
    link: "https://example.com/story",
    title: "A story",
    description: "Summary",
    content: "",
    pubDate: new Date().toISOString(),
    sourceName: "PC Gamer",
    sourceUrl: "https://www.pcgamer.com/rss/",
    imageUrl: null,
    firstSeen: Math.floor(Date.now() / 1000),
  };
  return {
    setPref: vi.fn(async () => undefined),
    ingest: vi.fn(async () => [article]),
    snapshot: {
      feeds: [],
      articles: [article],
      read: [],
      saved: [],
      history: [],
      prefs: { lastVisit: String(Math.floor(Date.now() / 1000) - 3600) },
    },
  };
});

vi.mock("./LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("./GameContext", () => ({ useGames: () => ({ games: [] }) }));
vi.mock("../hooks/useWishlist", () => ({ useWishlist: () => ({ wishlist: [] }) }));
vi.mock("../utils/news/storage", () => ({
  newsStorage: {
    snapshot: vi.fn(async () => snapshot),
    ingest,
    setPref,
  },
}));
vi.mock("../utils/news/feed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/news/feed")>();
  return { ...actual, fetchUrlText: vi.fn(async () => "<rss></rss>"), hasTauri: () => false };
});

function Probe() {
  const news = useNewsDemand();
  return (
    <div data-testid="state">
      {`${news.hydrated ? "hyd" : "boot"}|${news.loading ? "load" : "idle"}|${news.articles.length}`}
    </div>
  );
}

describe("NewsProvider", () => {
  it("hydrates under StrictMode and finishes the boot cycle", async () => {
    render(
      <StrictMode>
        <NewsProvider>
          <Probe />
        </NewsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("hyd|");
    });
    expect(screen.getByTestId("state")).toHaveTextContent(/\|idle\|1$/);
    // The previous session's visit is preserved for the "since last visit" copy.
    expect(setPref).toHaveBeenCalledWith("lastVisit", expect.any(String));
  });
});
