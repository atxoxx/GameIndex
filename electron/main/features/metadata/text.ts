/** Text / title helpers shared by the metadata providers. */
import * as cheerio from "cheerio";

/** Decode the HTML entities that show up in scraped titles and snippets. */
export function decodeEntities(input: string): string {
  return cheerio.load(`<span>${input}</span>`)("span").text();
}

/** Collapse whitespace and trim. */
export function collapse(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Strip tags from an HTML fragment and collapse whitespace. */
export function htmlToText(html: string): string {
  if (!html) return "";
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return collapse($.root().text());
}

/**
 * Normalize a title for comparison: decode entities, fold diacritics,
 * lowercase, and reduce to alphanumeric tokens.
 */
export function normalizeTitle(input: string): string {
  return cleanGameName(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const PUNCTUATION_NOISE = /\[[^\]]*\]|\{[^}]*\}|\((?:v\d[^)]*|fitgirl|dodi|repack|gog|proper|multi\d*)\)/gi;

/** Clean an imported executable/folder name before searching a provider. */
export function cleanGameName(input: string): string {
  let value = input.replace(/\.exe$/i, "");
  value = splitCamelCase(value);
  value = value.replace(PUNCTUATION_NOISE, " ");
  value = value.replace(/[._]+/g, " ");
  return collapse(value);
}

export function splitCamelCase(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");
}

/**
 * Similarity in [0, 1] used to rank provider search hits. Mirrors the Rust
 * `title_similarity`: exact normalized equality is 1, containment is scaled
 * by the token-count ratio, otherwise Jaccard token overlap.
 */
export function titleSimilarity(query: string, candidate: string): number {
  const q = normalizeTitle(query);
  const c = normalizeTitle(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) {
    const qTokens = q.split(" ").length;
    const cTokens = c.split(" ").length;
    return Math.min(1, Math.min(qTokens, cTokens) / Math.max(qTokens, cTokens));
  }
  const qSet = new Set(q.split(" "));
  const cSet = new Set(c.split(" "));
  let intersection = 0;
  for (const token of qSet) if (cSet.has(token)) intersection += 1;
  const union = new Set([...qSet, ...cSet]).size;
  return union === 0 ? 0 : Math.min(1, intersection / union);
}

export const MIN_TITLE_SIMILARITY = 0.6;

/** Extract a 4-digit year from a title ("Prototype (2009)" → "2009"). */
export function extractYear(input: string): string | null {
  const match = input.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}

/** Remove a parenthesised year so it does not skew relevance ranking. */
export function stripYearMarker(input: string): string {
  return collapse(input.replace(/\(\s*(?:19|20)\d{2}\s*\)/g, " "));
}

/** URL-safe slug used by store/review pages. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Parse "1,666 User Ratings" / "24 positive reviews" into 1666 / 24. */
export function firstNumber(value: string): number | null {
  let digits = "";
  let started = false;
  for (const char of value) {
    if (char >= "0" && char <= "9") {
      digits += char;
      started = true;
    } else if (started) {
      if (/[,. \u00a0\u202f]/.test(char)) continue;
      break;
    }
  }
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Format a Unix timestamp (seconds) as the ISO date IGDB/React expect. */
export function formatUnixTimestamp(ts: number): string {
  if (!Number.isFinite(ts) || ts < 0) return "";
  const iso = new Date(ts * 1000).toISOString();
  return ts % 86_400 === 0 ? iso.slice(0, 10) : iso;
}
