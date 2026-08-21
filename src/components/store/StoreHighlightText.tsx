import { Fragment } from "react";

/** Escape regex metacharacters so a user query is treated as literal text. */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface StoreHighlightTextProps {
  text: string;
  /**
   * Raw (possibly untrimmed) search query. Empty/whitespace queries
   * short-circuit to plain text — no highlight, no work.
   */
  query?: string;
}

/**
 * Presentational helper: renders `text` with every case-insensitive
 * occurrence of each token in `query` wrapped in `<mark class="store-highlight">`.
 * Used on suggestion names (`StoreSearchBar`), game-card titles
 * (`StoreGameCard`) and genre/platform badges so the user sees exactly
 * where their search terms hit.
 *
 * Tokenized: `query` is split on whitespace, each token escaped and
 * joined into an alternation regex (`token1|token2|…`). Longest tokens
 * are placed first so a query like "a ab" correctly highlights "ab"
 * as a whole rather than just its "a" prefix. Matching is case-insensitive.
 *
 * Deliberately display-only: it never inspects or transforms data, so
 * callers keep using the raw string for lookups (crackwatch/price hooks,
 * `aria-label`, `title` attributes, etc.). `String.prototype.split` with a
 * capturing group keeps the matched parts at the odd indices; the segment
 * list is deterministic for a given (text, query), so React keys stay
 * stable across re-renders.
 */
export default function StoreHighlightText({ text, query }: StoreHighlightTextProps) {
  const raw = query?.trim();
  if (!raw) return <Fragment>{text}</Fragment>;

  // Tokenize on whitespace, deduplicate case-insensitively, sort longest-first
  const rawTokens = raw.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return <Fragment>{text}</Fragment>;

  const seen = new Set<string>();
  const uniqueTokens: string[] = [];
  for (const tok of rawTokens) {
    const low = tok.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      uniqueTokens.push(tok);
    }
  }
  // Longest first ensures "elden ring" style alternation prefers full tokens
  uniqueTokens.sort((a, b) => b.length - a.length);

  const escapedTokens = uniqueTokens.map(escapeRegExp).filter(Boolean);
  if (escapedTokens.length === 0) return <Fragment>{text}</Fragment>;

  const pattern = escapedTokens.join("|");
  // Capturing group preserves matches as odd-indexed splits
  const regex = new RegExp(`(${pattern})`, "gi");

  const parts = text.split(regex);
  // If no split (no match), avoid extra work — return plain text
  // `split` with capturing group returns [text] when no match
  if (parts.length === 1) return <Fragment>{text}</Fragment>;

  return (
    <Fragment>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={`${i}-${part}`} className="store-highlight">
            {part}
          </mark>
        ) : (
          <Fragment key={`${i}-${part}`}>{part}</Fragment>
        )
      )}
    </Fragment>
  );
}
