import { describe, expect, it } from "vitest";
import type { Game } from "../../types/game";
import type { ReviewItem } from "./types";
import {
  excerptDraft,
  fallbackExcerpt,
  reviewDraft,
  reviewKeyOf,
} from "./reviewQuoteUtils";

const game = { id: "game-1", name: "Portal 2" } as Game;

const review: ReviewItem = {
  id: "steam-1",
  sourceIndex: 0,
  source: "steam",
  sourceLabel: "Steam",
  username: "Player",
  rating: 92,
  ratingLabel: "92/100",
  title: "Still brilliant",
  content: "The co-op campaign is a masterpiece. ".repeat(30),
  reviewLength: 900,
  reviewLengthBytes: 900,
  sentiment: "positive",
  authorSteamId: "76561198000000000",
  dateAdded: 1_700_000_000_000,
};

describe("reviewQuoteUtils", () => {
  it("builds a stable review key and a bookmark draft", () => {
    const key = reviewKeyOf(review);
    expect(key).toContain("steam");
    expect(key).toContain("76561198000000000");

    const draft = reviewDraft(game, review, "https://example.com/review");
    expect(draft.gameId).toBe("game-1");
    expect(draft.kind).toBe("review");
    expect(draft.reviewKey).toBe(key);
    expect(draft.rating).toBe(92);
    expect(draft.excerpt.length).toBeLessThanOrEqual(4000);
  });

  it("trims an excerpt and keeps its identity", () => {
    const draft = excerptDraft(game, review, "  A great line  ");
    expect(draft.kind).toBe("excerpt");
    expect(draft.excerpt).toBe("A great line");
    expect(draft.reviewKey).toBe(reviewKeyOf(review));
  });

  it("falls back to the start of the review when nothing is selected", () => {
    const excerpt = fallbackExcerpt(review.content, 40);
    expect(excerpt.length).toBeLessThanOrEqual(41);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(fallbackExcerpt("Short review", 40)).toBe("Short review");
  });
});
