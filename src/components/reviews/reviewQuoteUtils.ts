import type { Game } from "../../types/game";
import type { ReviewItem } from "./types";
import type { ReviewQuoteDraft } from "../../types/reviewQuote";

/** Stable identity for a review across re-fetches. */
export function reviewKeyOf(review: ReviewItem): string {
  return [
    review.source,
    review.authorSteamId || review.username || "unknown",
    review.dateAdded ?? "",
    (review.title || review.content).slice(0, 48),
  ].join(":");
}

/** Build a whole-review bookmark draft. */
export function reviewDraft(
  game: Game,
  review: ReviewItem,
  reviewUrl?: string | null,
): ReviewQuoteDraft {
  return {
    gameId: game.id,
    gameName: game.name,
    kind: "review",
    reviewKey: reviewKeyOf(review),
    source: review.source,
    sourceLabel: review.sourceLabel,
    author: review.username,
    title: review.title,
    excerpt: review.content.trim().slice(0, 4000),
    rating: review.rating,
    reviewUrl: reviewUrl ?? null,
  };
}

/** Build an excerpt draft from a selected passage. */
export function excerptDraft(
  game: Game,
  review: ReviewItem,
  excerpt: string,
  reviewUrl?: string | null,
): ReviewQuoteDraft {
  return {
    ...reviewDraft(game, review, reviewUrl),
    kind: "excerpt",
    excerpt: excerpt.trim().slice(0, 4000),
  };
}

/** Text to save when the reader hasn't highlighted a passage. */
export function fallbackExcerpt(content: string, limit = 320): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).trimEnd()}…`;
}
