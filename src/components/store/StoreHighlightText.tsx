import { Fragment } from "react";
import { getSearchHighlightSegments } from "../../utils/search";

interface StoreHighlightTextProps {
  text: string;
  /**
   * Raw (possibly untrimmed) search query. Empty/whitespace queries
   * short-circuit to plain text — no highlight, no work.
   */
  query?: string;
}

/**
 * Presentational helper: renders `text` with every occurrence of the search
 * tokens wrapped in `<mark class="store-highlight">`.
 *
 * Uses the shared search engine so highlighting stays aligned with matching —
 * it folds diacritics, punctuation, apostrophes and ligatures and maps the
 * ranges back onto the original string (e.g. "pokemon" underlines "Pokémon").
 * Used on suggestion names, game-card titles and genre/platform badges.
 *
 * Deliberately display-only: it never inspects or transforms data, so callers
 * keep using the raw string for lookups. The segment list is deterministic for
 * a given (text, query), so React keys stay stable across re-renders.
 */
export default function StoreHighlightText({ text, query }: StoreHighlightTextProps) {
  const raw = query?.trim();
  if (!raw) return <Fragment>{text}</Fragment>;

  const segments = getSearchHighlightSegments(text, raw);
  if (segments.length === 1 && !segments[0].highlight) return <Fragment>{text}</Fragment>;

  return (
    <Fragment>
      {segments.map((segment, i) =>
        segment.highlight ? (
          <mark key={`${i}-${segment.text}`} className="store-highlight">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={`${i}-${segment.text}`}>{segment.text}</Fragment>
        )
      )}
    </Fragment>
  );
}
