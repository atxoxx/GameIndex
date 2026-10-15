// Shared, dependency-free search engine used by every text-matching surface
// (command palette, download modal, store browsing).
//
// The goal is precision across "different characters": the same title written
// with or without accents, punctuation, apostrophes, ligatures, roman numerals
// or "&"/"and" should all match each other. Matching is:
//   - case-insensitive
//   - diacritic-insensitive (Pokémon → pokemon)
//   - punctuation-insensitive ("Assassin's Creed" → assassins creed)
//   - ligature-insensitive (ß → ss, æ → ae, …)
//   - ampersand/plus-aware (& → and, + → plus)
//   - roman ↔ arabic aware (GTA V ↔ GTA 5, Mafia III ↔ Mafia 3)
//   - typo tolerant, but only as a last-resort fallback
//
// Everything folds to lowercase ASCII words; roman/arabic equivalence is kept
// as a separate token-level check so a bare "v" is not rewritten into "5"
// everywhere (which would wreck ordinary words).

const DIACRITIC_MARKS = /[\u0300-\u036f]/g;
const APOSTROPHES = new Set(["'", "\u2019", "\u2018", "\u02bc", "\u00b4", "`"]);
const WORD_SPLIT = /[\s]+/;

/** Characters NFD/NFKC does not reduce to a plain ASCII letter. */
const LIGATURE_FOLD: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l",
  ħ: "h",
  ı: "i",
  ŋ: "n",
  ĸ: "k",
  ẞ: "ss",
};

const ROMAN_VALUES: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

const ROMAN_TABLE: Array<[number, string]> = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

export interface FoldedText {
  /** Folded string, not whitespace-collapsed (kept index-aligned with `map`). */
  folded: string;
  /** Source index for every character in `folded`. */
  map: number[];
}

/**
 * Fold a string into its matchable form while keeping a source-index map so
 * highlighted ranges can be mapped back onto the original string. One or more
 * output characters can point at the same input character (ligatures, "&").
 */
export function foldWithMap(input: string): FoldedText {
  const out: string[] = [];
  const map: number[] = [];

  const push = (chunk: string, source: number) => {
    for (const ch of chunk) {
      out.push(ch);
      map.push(source);
    }
  };

  for (let i = 0; i < input.length; i++) {
    const source = input[i];
    const lowered = source.normalize("NFKC").toLowerCase();
    const stripped = lowered.normalize("NFD").replace(DIACRITIC_MARKS, "");
    for (const ch of stripped) {
      if (APOSTROPHES.has(ch)) continue; // drop, joining the surrounding letters
      if (ch === "&") {
        push(" and ", i);
        continue;
      }
      if (ch === "+") {
        push(" plus ", i);
        continue;
      }
      const ligature = LIGATURE_FOLD[ch];
      if (ligature) {
        push(ligature, i);
        continue;
      }
      if (ch >= "a" && ch <= "z") {
        push(ch, i);
        continue;
      }
      if (ch >= "0" && ch <= "9") {
        push(ch, i);
        continue;
      }
      push(" ", i);
    }
  }

  return { folded: out.join(""), map };
}

/** Fold a value into its canonical, whitespace-collapsed searchable form. */
export function foldSearchText(input: string | null | undefined): string {
  if (!input) return "";
  return foldWithMap(input).folded.replace(/\s+/g, " ").trim();
}

/** Alias kept for readability at call sites that think in terms of "normalize". */
export const normalizeSearchText = foldSearchText;

export interface QueryToken {
  /** Folded form used for matching. */
  text: string;
  /** Original text as typed by the user. */
  raw: string;
}

export interface ParsedSearchQuery {
  raw: string;
  /** Independent AND terms. */
  words: QueryToken[];
  /** `"quoted"` substrings that must appear verbatim. */
  phrases: QueryToken[];
  isEmpty: boolean;
}

/** Parse a raw query string into words + quoted phrases. */
export function parseSearchQuery(raw: string | null | undefined): ParsedSearchQuery {
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
  for (const part of remainder.split(WORD_SPLIT)) {
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

/** Split a free-text query into folded tokens. Empty query → []. */
export function tokenizeSearchQuery(query: string): string[] {
  if (!query) return [];
  const folded = foldSearchText(query);
  return folded ? folded.split(" ").filter(Boolean) : [];
}

/** Standard Levenshtein edit distance. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep the shorter string on the inner axis to bound memory.
  if (a.length > b.length) [a, b] = [b, a];

  let prev = new Array<number>(a.length + 1);
  let curr = new Array<number>(a.length + 1);
  for (let j = 0; j <= a.length; j++) prev[j] = j;

  for (let i = 1; i <= b.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j - 1] + cost, prev[j] + 1, curr[j - 1] + 1);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/** True when the edit distance between `a` and `b` is at most `max`. */
export function levenshteinWithin(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  return levenshteinDistance(a, b) <= max;
}

/** Canonical roman form of `n` (1–3999), or null when out of range. */
export function numberToRoman(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return null;
  let remaining = n;
  let out = "";
  for (const [value, symbol] of ROMAN_TABLE) {
    while (remaining >= value) {
      out += symbol;
      remaining -= value;
    }
  }
  return out;
}

/**
 * Numeric value of a well-formed roman numeral, or null when `token` is not a
 * canonical roman numeral (so "iiii", "mix"-as-a-word and anything >3999 are
 * rejected).
 */
export function romanToNumber(token: string): number | null {
  const s = token.toLowerCase();
  if (!s || !/^[ivxlcdm]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const current = ROMAN_VALUES[s[i]];
    const next = i + 1 < s.length ? ROMAN_VALUES[s[i + 1]] : 0;
    total += current < next ? -current : current;
  }
  if (total < 1 || total > 3999) return null;
  return numberToRoman(total) === s ? total : null;
}

/** True when two folded tokens denote the same value (e.g. "v" ↔ "5"). */
export function searchTokensEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ra = romanToNumber(a);
  if (ra !== null && String(ra) === b) return true;
  const rb = romanToNumber(b);
  if (rb !== null && String(rb) === a) return true;
  return false;
}

/**
 * True when a single folded query token matches a single folded target token.
 * Exact, roman/arabic, prefix and (for longer tokens) small-typo matches pass.
 */
export function searchTokenMatches(queryToken: string, targetToken: string): boolean {
  if (!queryToken || !targetToken) return false;
  if (searchTokensEqual(queryToken, targetToken)) return true;
  if (queryToken.length >= 2 && targetToken.startsWith(queryToken)) return true;
  if (queryToken.length >= 4) {
    const max = queryToken.length >= 7 ? 2 : 1;
    if (levenshteinWithin(queryToken, targetToken, max)) return true;
  }
  return false;
}

/** Fold `fields` and decide whether a single token appears in any of them. */
function fieldHasToken(foldedFields: string[], token: string): boolean {
  if (token.length >= 4) {
    for (const field of foldedFields) {
      if (field.includes(token)) return true;
      if (field.replace(/ /g, "").includes(token)) return true;
    }
  }
  for (const field of foldedFields) {
    if (field.split(" ").some((word) => searchTokenMatches(token, word))) return true;
  }
  return false;
}

/**
 * True when every word (AND) and every quoted phrase is present across the
 * given fields. Phrases and tokens never straddle a field boundary.
 */
export function searchTextMatches(
  query: string | ParsedSearchQuery,
  fields: Array<string | null | undefined>
): boolean {
  const parsed = typeof query === "string" ? parseSearchQuery(query) : query;
  if (parsed.isEmpty) return true;

  const foldedFields = fields
    .map((field) => foldSearchText(field))
    .filter(Boolean);
  if (foldedFields.length === 0) return false;

  for (const phrase of parsed.phrases) {
    if (!foldedFields.some((field) => field.includes(phrase.text))) return false;
  }

  for (const word of parsed.words) {
    if (fieldHasToken(foldedFields, word.text)) continue;
    if (foldedFields.some((field) => field.includes(word.text))) continue;
    return false;
  }
  return true;
}

/** True when `foldedQuery` occurs at a word start inside `foldedTarget`. */
function wordBoundaryIndex(foldedTarget: string, foldedQuery: string): number {
  const index = foldedTarget.indexOf(foldedQuery);
  if (index === 0) return 0;
  if (index > 0 && foldedTarget[index - 1] === " ") return index;
  return -1;
}

/**
 * Rank `target` against `query`. Returns -1 when nothing matches, 0 for an
 * empty query, otherwise a positive score (higher is a stronger match).
 *
 * Bands (best → worst): exact 1500 · prefix 1100 · word-boundary 950 · acronym
 * 860/840/780 · value-equivalent 700 · multi-token 600+ · substring 500 ·
 * fuzzy subsequence 380–160 · typo 280 · extra metadata 200/140.
 */
export function scoreSearchMatch(
  query: string,
  target: string,
  extraTerms: Array<string | undefined> = []
): number {
  const q = foldSearchText(query);
  if (!q) return 0;
  const t = foldSearchText(target);
  if (!t) {
    for (const term of extraTerms) {
      const folded = foldSearchText(term);
      if (folded && folded.includes(q)) return 140;
    }
    return -1;
  }

  if (t === q) return 1500;
  if (t.startsWith(q)) return 1100 + Math.max(0, 60 - (t.length - q.length));

  const boundary = wordBoundaryIndex(t, q);
  if (boundary !== -1) return 950 + Math.max(0, 40 - boundary);

  const words = t.split(" ").filter(Boolean);
  const qTokens = q.split(" ").filter(Boolean);

  // Whole-query value equivalence (e.g. "5" ↔ "V" in a title like "V Rising").
  if (qTokens.length === 1 && words.some((w) => searchTokensEqual(q, w))) {
    return 700;
  }

  if (words.length > 1) {
    const acronym = words.map((w) => w[0]).join("");
    if (acronym === q) return 860;
    if (acronym.startsWith(q)) return 780;

    const numericAcronym = words
      .map((w) => {
        const match = w.match(/^(\d+)/);
        return match ? match[1] : w[0];
      })
      .join("");
    if (numericAcronym === q) return 840;
  }

  if (qTokens.length > 1) {
    let allMatched = true;
    let tokenScore = 600;
    let prevIndex = -1;

    for (const token of qTokens) {
      const directIdx = t.indexOf(token);
      if (directIdx !== -1) {
        tokenScore += 60;
        if (prevIndex !== -1 && directIdx > prevIndex) tokenScore += 50;
        prevIndex = directIdx;
        continue;
      }
      if (words.some((w) => searchTokenMatches(token, w))) {
        tokenScore += 40;
        continue;
      }
      const fromExtra = extraTerms.some((term) => {
        const folded = foldSearchText(term);
        return folded && folded.split(" ").some((w) => searchTokenMatches(token, w));
      });
      if (fromExtra) {
        tokenScore += 30;
        continue;
      }
      allMatched = false;
      break;
    }

    if (allMatched) return tokenScore;
  }

  const subIdx = t.indexOf(q);
  if (subIdx !== -1) return 500 - Math.min(subIdx * 2, 120);

  // Fuzzy subsequence (query characters appearing in order).
  let qIdx = 0;
  let gapPenalty = 0;
  let prevMatchIdx = -1;
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      if (prevMatchIdx !== -1) gapPenalty += Math.max(0, i - prevMatchIdx - 1);
      prevMatchIdx = i;
      qIdx++;
    }
  }
  if (qIdx === q.length) return Math.max(160, 380 - gapPenalty * 5);

  // Typo tolerance for a single word (only for long enough queries).
  if (q.length >= 4 && words.length > 0) {
    let best = Number.POSITIVE_INFINITY;
    const allowance = q.length > 6 ? 2 : 1;
    for (const word of words) {
      if (Math.abs(word.length - q.length) > allowance + 2) continue;
      const dist = levenshteinDistance(q, word.slice(0, q.length + allowance + 1));
      if (dist < best) best = dist;
    }
    if (best <= allowance) return 280 - best * 60;
  }

  for (const term of extraTerms) {
    const folded = foldSearchText(term);
    if (!folded) continue;
    if (folded.startsWith(q)) return 200;
    if (folded.includes(q)) return 140;
  }

  return -1;
}

export interface HighlightRange {
  start: number;
  end: number;
}

function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRange[] = [];
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= current.end) {
      current.end = Math.max(current.end, sorted[i].end);
    } else {
      merged.push(current);
      current = { ...sorted[i] };
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Character ranges in `text` that literally satisfy the query's tokens, mapped
 * back across diacritics/punctuation so the UI can highlight the original
 * string. Value-equivalent (roman) matches are intentionally not underlined.
 */
export function getSearchMatchRanges(
  text: string,
  query: string | ParsedSearchQuery
): HighlightRange[] {
  const parsed = typeof query === "string" ? parseSearchQuery(query) : query;
  if (parsed.isEmpty || !text) return [];

  const { folded, map } = foldWithMap(text);
  const needles = [...parsed.words, ...parsed.phrases]
    .map((token) => token.text)
    .filter(Boolean);

  const ranges: HighlightRange[] = [];
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const idx = folded.indexOf(needle, from);
      if (idx < 0) break;
      const start = map[idx];
      const end = map[idx + needle.length - 1] + 1;
      ranges.push({ start, end });
      from = idx + needle.length;
    }
  }
  return mergeRanges(ranges);
}

/** Split text into highlighted / plain segments for rendering. */
export function getSearchHighlightSegments(
  text: string,
  query: string | ParsedSearchQuery
): Array<{ text: string; highlight: boolean }> {
  const ranges = getSearchMatchRanges(text, query);
  if (ranges.length === 0) return [{ text, highlight: false }];

  const segments: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlight: false });
    segments.push({ text: text.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlight: false });
  return segments;
}
