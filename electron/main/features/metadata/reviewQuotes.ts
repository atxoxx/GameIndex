/**
 * Saved review bookmarks and excerpts.
 *
 * Ported from `review_quotes.rs`; the Rust build kept a bounded JSON array in
 * the kv domain, so this uses the same `state/jsonStore.ts` pattern.
 */
import { createSqliteStore } from "../../state/sqliteStore";

export type ReviewQuoteKind = "review" | "excerpt";

export interface ReviewQuote {
  id: string;
  gameId: string;
  gameName: string;
  kind: ReviewQuoteKind;
  reviewKey: string;
  source: string;
  sourceLabel: string;
  author: string;
  title: string;
  excerpt: string;
  rating?: number | null;
  reviewUrl?: string | null;
  createdAt: number;
}

interface QuotesDocument {
  quotes: ReviewQuote[];
}

const MAX_QUOTES = 500;
const MAX_EXCERPT_CHARS = 4000;

const store = createSqliteStore<QuotesDocument>({
  domain: "kv",
  document: "review-quotes",
  createDefault: () => ({ quotes: [] }),
  normalize: (value) => ({
    quotes: Array.isArray(value.quotes) ? value.quotes : [],
  }),
});

function normalize(input: Partial<ReviewQuote>): ReviewQuote {
  const now = Date.now();
  const id = (input.id ?? "").trim() || `quote-${now}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    gameId: (input.gameId ?? "").trim(),
    gameName: (input.gameName ?? "").trim(),
    kind: input.kind === "excerpt" ? "excerpt" : "review",
    reviewKey: (input.reviewKey ?? "").trim(),
    source: (input.source ?? "").trim(),
    sourceLabel: (input.sourceLabel ?? "").trim(),
    author: (input.author ?? "").trim(),
    title: (input.title ?? "").trim(),
    excerpt: (input.excerpt ?? "").trim().slice(0, MAX_EXCERPT_CHARS),
    rating: input.rating ?? null,
    reviewUrl: input.reviewUrl?.trim() || null,
    createdAt: input.createdAt && input.createdAt > 0 ? input.createdAt : now,
  };
}

export function reviewQuoteList(gameId?: string | null): ReviewQuote[] {
  const quotes = store.read().quotes;
  const scoped = gameId?.trim()
    ? quotes.filter((quote) => quote.gameId === gameId)
    : quotes;
  return [...scoped].sort((a, b) => b.createdAt - a.createdAt);
}

export function reviewQuoteSave(quote: Partial<ReviewQuote>): ReviewQuote {
  const normalized = normalize(quote);
  if (!normalized.gameId) throw new Error("Review quote needs a game id.");
  if (!normalized.excerpt) throw new Error("Review quote needs an excerpt.");
  store.update((document) => {
    const isBookmark = normalized.kind === "review";
    const kept = document.quotes.filter((existing) => {
      if (existing.id === normalized.id) return false;
      if (
        isBookmark &&
        normalized.reviewKey &&
        existing.reviewKey === normalized.reviewKey &&
        existing.gameId === normalized.gameId
      ) {
        return false;
      }
      return true;
    });
    return { quotes: [normalized, ...kept].slice(0, MAX_QUOTES) };
  });
  return normalized;
}

export function reviewQuoteDelete(id: string): number {
  let removed = 0;
  store.update((document) => {
    const kept = document.quotes.filter((quote) => quote.id !== id);
    removed = document.quotes.length - kept.length;
    return { quotes: kept };
  });
  return removed;
}
