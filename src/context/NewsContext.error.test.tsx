import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NewsProvider, useNewsDemand } from "./NewsContext";

vi.mock("./LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("./GameContext", () => ({ useGames: () => ({ games: [] }) }));
vi.mock("../hooks/useWishlist", () => ({ useWishlist: () => ({ wishlist: [] }) }));
vi.mock("../utils/news/storage", () => ({
  newsStorage: {
    snapshot: vi.fn(async () => {
      throw new Error("db locked");
    }),
    ingest: vi.fn(async () => []),
    setPref: vi.fn(async () => undefined),
  },
}));
vi.mock("../utils/news/feed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/news/feed")>();
  return { ...actual, fetchUrlText: vi.fn(async () => ""), hasTauri: () => false };
});

function Probe() {
  const news = useNewsDemand();
  return (
    <div data-testid="state">{`${news.hydrated ? "hyd" : "boot"}|${news.loading ? "load" : "idle"}|${news.error ? "err" : "-"}`}</div>
  );
}

describe("NewsProvider store failure", () => {
  it("stops loading and exposes the error instead of spinning", async () => {
    render(
      <NewsProvider>
        <Probe />
      </NewsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("boot|idle|err"));
  });
});
