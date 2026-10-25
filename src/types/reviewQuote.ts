/**
 * Saved review bookmarks and excerpts.
 *
 * Backed by the `review_quotes` Rust module, which keeps a bounded JSON list
 * in the kv domain. The frontend falls back to localStorage when the Tauri
 * bridge is unavailable (frontend-only dev).
 */

export type ReviewQuoteKind = "review" | "excerpt";

export interface ReviewQuote {
  id: string;
  gameId: string;
  gameName: string;
  kind: ReviewQuoteKind;
  /** Stable identity of the source review (source:author:timestamp). */
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

export type ReviewQuoteDraft = Omit<ReviewQuote, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
};
