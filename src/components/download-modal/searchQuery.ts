// Download modal search — now a thin adapter over the shared search engine
// (`src/utils/search.ts`), which owns character folding, roman/arabic
// equivalence, typo tolerance and highlighting so every surface matches the
// same way. Kept as a module so the modal's call sites and their established
// API (parseQuery / matchesQuery / highlightSegments) don't churn.

import {
  foldSearchText,
  parseSearchQuery,
  searchTextMatches,
  getSearchMatchRanges,
  getSearchHighlightSegments,
} from "../../utils/search";

export type { QueryToken, ParsedSearchQuery as ParsedQuery, HighlightRange } from "../../utils/search";

export { foldSearchText };

/** Parse a raw query string into words + quoted phrases. */
export const parseQuery = parseSearchQuery;

/** True when every word and phrase is present in the folded haystack. */
export function textMatches(
  parsed: ReturnType<typeof parseSearchQuery>,
  foldedField: string
): boolean {
  return searchTextMatches(parsed, [foldedField]);
}

/**
 * True when the parsed query matches any of the given fields. Fields are
 * folded per-field so a token can never straddle a field boundary.
 */
export function matchesQuery(
  parsed: ReturnType<typeof parseSearchQuery>,
  fields: Array<string | null | undefined>
): boolean {
  return searchTextMatches(parsed, fields);
}

export const highlightRanges = getSearchMatchRanges;
export const highlightSegments = getSearchHighlightSegments;
