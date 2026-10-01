// Token-aware search for the download modal's result filter.
//
// The old filter used a single `String.includes` on the full query, so
// "elden ring fitgirl" only matched a title containing that exact run of
// characters. This module parses the query into independent tokens (plus
// optional `"quoted phrases"`) and requires all of them to appear, in any
// order, across the searchable fields. Matching is case-, punctuation-,
// and diacritic-insensitive, and it can report the character ranges that
// matched so the UI can highlight them in the original title.

export interface QueryToken {
  /** Folded form used for matching. */
  text: string;
  /** Original text as typed by the user. */
  raw: string;
}

export interface ParsedQuery {
  raw: string;
  /** Independent AND terms. */
  words: QueryToken[];
  /** `"quoted"` substrings that must appear verbatim. */
  phrases: QueryToken[];
  isEmpty: boolean;
}

export interface HighlightRange {
  start: number;
  end: number;
}

const DIACRITIC_MARKS = /[\u0300-\u036f]/g;

interface FoldedText {
  folded: string;
  /** Source index for every character in `folded`. */
  map: number[];
}

/**
 * Fold a string to lowercase, strip diacritics, and replace every
 * non-alphanumeric character with a space — one output character per
 * input character (which keeps `map` index-aligned for highlighting).
 */
function foldText(input: string): FoldedText {
  const folded: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const base = input[i].normalize("NFD").replace(DIACRITIC_MARKS, "");
    for (let j = 0; j < base.length; j++) {
      const lower = base[j].toLowerCase();
      folded.push(/[a-z0-9]/.test(lower) ? lower : " ");
      map.push(i);
    }
  }
  return { folded: folded.join(""), map };
}

/** Fold a field value into its matchable form. */
export function foldSearchText(input: string | null | undefined): string {
  if (!input) return "";
  return foldText(input).folded.replace(/\s+/g, " ").trim();
}

/** Parse a raw query string into words + quoted phrases. */
export function parseQuery(raw: string | null | undefined): ParsedQuery {
  const text = raw ?? "";
  const phrases: QueryToken[] = [];
  const phraseRe = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = phraseRe.exec(text)) !== null) {
    const folded = foldSearchText(match[1]);
    if (folded) phrases.push({ text: folded, raw: match[1] });
  }

  const remainder = text.replace(phraseRe, " ");
  const words: QueryToken[] = [];
  for (const part of remainder.split(/\s+/)) {
    const folded = foldSearchText(part);
    if (folded) words.push({ text: folded, raw: part });
  }

  return {
    raw: text,
    words,
    phrases,
    isEmpty: words.length === 0 && phrases.length === 0,
  };
}

/** True when every word and phrase is present in the folded haystack. */
export function textMatches(parsed: ParsedQuery, foldedField: string): boolean {
  if (parsed.isEmpty) return true;
  for (const word of parsed.words) {
    if (!foldedField.includes(word.text)) return false;
  }
  for (const phrase of parsed.phrases) {
    if (!foldedField.includes(phrase.text)) return false;
  }
  return true;
}

/**
 * True when the parsed query matches any of the given fields. Fields are
 * folded and joined with a NUL sentinel so a token can never straddle a
 * field boundary.
 */
export function matchesQuery(
  parsed: ParsedQuery,
  fields: Array<string | null | undefined>,
): boolean {
  if (parsed.isEmpty) return true;
  const haystack = fields
    .map((field) => foldSearchText(field))
    .filter(Boolean)
    .join(" \u0000 ");
  return textMatches(parsed, haystack);
}

/**
 * Character ranges in `text` that satisfy the query, merged and sorted.
 * Used to highlight matches in a title without altering its case.
 */
export function highlightRanges(
  text: string,
  parsed: ParsedQuery,
): HighlightRange[] {
  if (parsed.isEmpty || !text) return [];
  const { folded, map } = foldText(text);
  const raw: Array<[number, number]> = [];

  const addMatches = (needle: string) => {
    if (!needle) return;
    let from = 0;
    for (;;) {
      const idx = folded.indexOf(needle, from);
      if (idx < 0) break;
      const start = map[idx];
      const end = map[idx + needle.length - 1] + 1;
      raw.push([start, end]);
      from = idx + needle.length;
    }
  };

  for (const word of parsed.words) addMatches(word.text);
  for (const phrase of parsed.phrases) addMatches(phrase.text);
  if (raw.length === 0) return [];

  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of raw) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged.map(([start, end]) => ({ start, end }));
}

/**
 * Split text into highlighted / plain segments for rendering. Returns a
 * flat segment list so callers can map directly to React nodes.
 */
export function highlightSegments(
  text: string,
  parsed: ParsedQuery,
): Array<{ text: string; highlight: boolean }> {
  const ranges = highlightRanges(text, parsed);
  if (ranges.length === 0) return [{ text, highlight: false }];

  const segments: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), highlight: false });
    }
    segments.push({ text: text.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false });
  }
  return segments;
}
