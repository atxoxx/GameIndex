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
 * occurrence of `query` wrapped in `<mark class="store-highlight">`.
 * Used on suggestion names (`StoreSearchBar`) and game-card titles
 * (`StoreGameCard`) so the user sees exactly where their search term hit.
 *
 * Deliberately display-only: it never inspects or transforms data, so
 * callers keep using the raw string for lookups (crackwatch/price hooks,
 * `aria-label`, `title` attributes, etc.). `String.prototype.split` with a
 * capturing group keeps the matched parts at the odd indices; the segment
 * list is deterministic for a given (text, query), so React keys stay
 * stable across re-renders.
 */
export default function StoreHighlightText({ text, query }: StoreHighlightTextProps) {
  const q = query?.trim();
  if (!q) return <Fragment>{text}</Fragment>;

  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
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
