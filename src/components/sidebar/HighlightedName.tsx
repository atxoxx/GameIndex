import { memo } from "react";
import type { HighlightedNameProps } from "./types";

/**
 * HighlightedName
 * ───────────────
 * Renders `name` with any substring matching `query` (case-
 * insensitive) wrapped in a <mark> tag for the matched substring.
 * React's JSX renders <mark> as a real text element so the wrapped
 * chunk can NEVER escape as raw HTML — XSS-safe by construction.
 *
 * Multiple matches are handled: the function walks the string with
 * `String.prototype.indexOf` from the last cursor. Empty/whitespace
 * queries fall through to an unhighlighted render so the search
 * experience feels "clean" once the user clears the input.
 */
function HighlightedNameBase({ name, query }: HighlightedNameProps) {
  const trimmed = query.trim();
  if (!trimmed) return <>{name}</>;
  const qLower = trimmed.toLowerCase();
  const lower = name.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  while (last < name.length) {
    const idx = lower.indexOf(qLower, last);
    if (idx === -1) {
      parts.push(name.substring(last));
      break;
    }
    if (idx > last) parts.push(name.substring(last, idx));
    parts.push(
      <mark key={`${name}-${idx}`}>{name.substring(idx, idx + qLower.length)}</mark>
    );
    last = idx + qLower.length;
  }
  return <>{parts}</>;
}

export const HighlightedName = memo(HighlightedNameBase);
export default HighlightedName;
