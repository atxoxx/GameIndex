/**
 * Title matching for plugin hits.
 *
 * Ported from `src-tauri/src/source_manager.rs` (`normalize_title`,
 * `title_similarity`, `best_title_similarity`, `apply_release_year_adj`,
 * `clean_search_query`). The Rust pipeline applied the same 0.2 match floor to
 * plugin results that it applied to cached source results, so these helpers
 * keep plugin rows comparable with `sources_search_game`.
 *
 * The other Electron feature modules keep their own smaller copies of these
 * helpers; this version is the fuller port because plugin results carry
 * `matchTitle`, aliases and a release year.
 */

/** Tokens that never change a title's identity. */
const NOISE_TOKENS = new Set([
  "edition",
  "definitive",
  "game",
  "of",
  "the",
  "year",
  "goty",
  "deluxe",
  "collectors",
  "collector",
  "complete",
  "special",
  "ultimate",
  "premium",
  "standard",
  "gold",
  "platinum",
  "anniversary",
  "remastered",
  "remaster",
  "enhanced",
  "directors",
  "director",
  "cut",
  "pc",
  "windows",
  "linux",
  "mac",
  "steam",
  "gog",
  "epic",
  "fitgirl",
  "repack",
  "v",
  "for",
  "and",
  "with",
  "pack",
  "iso",
  "setup",
  "installer",
  "portable",
  "build",
  "update",
  "patch",
  "hotfix",
  "multi",
  "multilanguage",
  "multi5",
  "multi10",
  "nintendo",
  "switch",
  "playstation",
  "xbox",
  "ps4",
  "ps5",
  "fit",
  "girl",
  "codex",
  "plaza",
  "skidrow",
  "cpy",
  "goldberg",
  "empress",
  "tenoke",
  // Release-container / codec / resolution tags. They describe the file, not
  // the game; leaving them in made a scene release look like a different title.
  "dlc",
  "expansion",
  "addon",
  "soundtrack",
  "rip",
  "webrip",
  "bdrip",
  "brrip",
  "hdr",
  "x264",
  "x265",
  "h264",
  "h265",
  "hevc",
  "av1",
  "aac",
  "ac3",
  "dts",
  "truehd",
  "atmos",
  "1080p",
  "720p",
  "2160p",
  "4k",
  "uhd",
]);

const TRADEMARKS = /[\u00ae\u2122\u00a9]/g;

/**
 * Remove release-container noise before camel/digit splitting: `x265` would
 * otherwise become `x 265`, and `(2016)` is a year annotation, not a word.
 */
function stripReleaseTags(input: string): string {
  return input
    .replace(/[\[(]\s*(?:19|20)\d{2}\s*[\])]/g, " ")
    .replace(
      /\b(?:x26[45]|h26[45]|hevc|av1|aac|ac3|dts|truehd|atmos|hdr10?|1080p|720p|2160p|4k|uhd|web-?rip|bd-?rip|br-?rip|dvd-?rip)\b/gi,
      " ",
    );
}

/** Words an acronym may skip; "of" is kept because "CoD" is the common form. */
const ACRONYM_SKIP = new Set(["the"]);

/** Acronym source words from the raw title (before noise-token filtering). */
function acronymWords(raw: string): string[] {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’‘]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && !ACRONYM_SKIP.has(word));
}

/** Insert spaces at camelCase / letter-digit boundaries. */
function splitBoundaries(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2");
}

/** Primary name before `:` or a spaced dash (bare hyphens survive). */
function splitPrimary(title: string): string {
  let cut = title.indexOf(":");
  for (const separator of [" - ", " \u2013 ", " \u2014 "]) {
    const at = title.indexOf(separator);
    if (at >= 0) cut = cut < 0 ? at : Math.min(cut, at);
  }
  if (cut >= 0 && title.slice(0, cut).trim().length >= 3) {
    return title.slice(0, cut).trim();
  }
  return title;
}

/**
 * Drop a parenthesised/bracketed release year ("Doom (2016)"). A bare trailing
 * year is kept: "Battlefield 2042" and "Football Manager 2024" use it as part
 * of the name, and the scorer discounts real release years contextually.
 */
function stripTrailingYear(input: string): string {
  const trimmed = input.trimEnd();
  const bracketed = /(?:\(|\[)\s*((?:19|20)\d{2})\s*(?:\)|\])\s*$/.exec(trimmed);
  if (bracketed) return trimmed.slice(0, bracketed.index).trimEnd();
  return input;
}

/**
 * Lowercase, accent-folded, edition-noise-free title.
 *
 * Subtitles after `:` / ` - ` are deliberately kept: they are identity, not
 * release noise. Dropping them made "Call of Duty: Modern Warfare" normalize
 * to the same key as "Call of Duty", so a search for one entry could return
 * (and outrank) another. `cleanSearchQuery` below still offers the short
 * primary-name fallback for upstream indexes that need it.
 */
export function normalizeTitle(input: string): string {
  const cleaned = splitBoundaries(stripReleaseTags(String(input ?? "")))
    .replace(TRADEMARKS, "")
    .replace(/['’‘]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const flattened = stripTrailingYear(cleaned)
    .replace(/[()[\]{}]/g, " ")
    .replace(/[:–—.,!?/\\"'|+&=~*_]/g, " ");
  return flattened
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token && !NOISE_TOKENS.has(token))
    .join(" ");
}

function tokenize(value: string): string[] {
  const normalized = normalizeTitle(value);
  return normalized ? normalized.split(" ") : [];
}

function parseYear(token: string): number | null {
  if (!/^\d{4}$/.test(token)) return null;
  const year = Number(token);
  return year >= 1900 && year <= 2099 ? year : null;
}

function findYear(tokens: string[]): number | null {
  for (const token of tokens) {
    const year = parseYear(token);
    if (year !== null) return year;
  }
  return null;
}

/** True for a bare four-digit release year token. */
function isYearToken(token: string): boolean {
  return parseYear(token) !== null;
}

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

function numberToRoman(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 3999) return null;
  let remaining = value;
  let out = "";
  for (const [amount, symbol] of ROMAN_TABLE) {
    while (remaining >= amount) {
      out += symbol;
      remaining -= amount;
    }
  }
  return out;
}

/** Canonical roman numeral value, or null for ordinary words like "mix". */
function romanTokenValue(token: string): number | null {
  if (!/^[ivxlcdm]+$/.test(token)) return null;
  let total = 0;
  for (let index = 0; index < token.length; index += 1) {
    const current = ROMAN_VALUES[token[index]];
    const next = index + 1 < token.length ? ROMAN_VALUES[token[index + 1]] : 0;
    total += current < next ? -current : current;
  }
  if (total < 1 || total > 3999) return null;
  return numberToRoman(total) === token ? total : null;
}

/** Numeric value of an arabic or canonical roman token, or null. */
function tokenNumber(token: string): number | null {
  if (/^\d{1,4}$/.test(token)) {
    const value = Number.parseInt(token, 10);
    return value >= 1 && value <= 3999 ? value : null;
  }
  return romanTokenValue(token);
}

/** True when two tokens denote the same value ("V" ↔ "5", "III" ↔ "3"). */
function sameTokenValue(a: string, b: string): boolean {
  if (a === b) return true;
  const valueA = tokenNumber(a);
  if (valueA === null) return false;
  return tokenNumber(b) === valueA;
}

/** First letters of the first `length` tokens, keeping numeric tokens whole. */
function acronymOf(tokens: string[], length: number): string {
  return tokens
    .slice(0, length)
    .map((token) => (/^\d+$/.test(token) ? token : token[0] ?? ""))
    .join("");
}

/** Bounded edit distance; `null` when the distance exceeds `max`. */
function boundedEditDistance(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let previous = Array.from({ length: shorter.length + 1 }, (_, index) => index);
  for (let i = 0; i < longer.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < shorter.length; j += 1) {
      const cost = longer[i] === shorter[j] ? 0 : 1;
      current.push(
        Math.min(previous[j] + cost, current[j] + 1, previous[j + 1] + 1),
      );
    }
    if (Math.min(...current) > max) return null;
    previous = current;
  }
  return previous[shorter.length] <= max ? previous[shorter.length] : null;
}

/** Credit for a mid-word typo; short and numeric tokens never fuzzy-match. */
function fuzzyTokenCredit(queryToken: string, titleTokens: string[]): number | null {
  if (queryToken.length < 4 || /^\d+$/.test(queryToken)) return null;
  let best: number | null = null;
  for (const candidate of titleTokens) {
    if (candidate.length < 3) continue;
    const distance = boundedEditDistance(queryToken, candidate, 2);
    if (distance === 1) return 0.75;
    if (distance === 2) best = best === null ? 0.6 : Math.max(best, 0.6);
  }
  return best;
}

/** Similarity in [0, 1] between a raw query and a candidate title. */
export function titleSimilarity(rawQuery: string, candidate: string): number {
  const queryNormalized = normalizeTitle(rawQuery);
  const titleNormalized = normalizeTitle(candidate);
  if (!queryNormalized || !titleNormalized) return 0;
  if (queryNormalized === titleNormalized) return 1;

  const queryTokens = queryNormalized.split(" ");
  const titleTokens = titleNormalized.split(" ");
  const titleSet = new Set(titleTokens);
  // Years are a hint, not an identity token: a query "Game (2020)" should still
  // match a listing that omits the year, while a conflicting year is handled
  // by the adjustment below.
  const queryWords = queryTokens.filter((token) => !isYearToken(token));
  const required = queryWords.length > 0 ? queryWords : queryTokens;
  const titleWords = titleTokens.filter((token) => !isYearToken(token));

  let weightedMatch = 0;
  let weightTotal = 0;
  let fullyMatched = 0;
  for (let index = 0; index < required.length; index += 1) {
    const token = required[index];
    const positionWeight =
      1 + Math.max(0, required.length - 1 - index) * 0.04;
    weightTotal += positionWeight;
    if (titleSet.has(token)) {
      weightedMatch += positionWeight;
      fullyMatched += 1;
      continue;
    }
    // Roman/arabic equivalence: "GTA V" ↔ "GTA 5", "Mafia III" ↔ "Mafia 3".
    if (titleTokens.some((candidateToken) => sameTokenValue(token, candidateToken))) {
      weightedMatch += positionWeight * 0.97;
      fullyMatched += 1;
      continue;
    }
    if (
      token.length >= 3 &&
      titleTokens.some(
        (candidateToken) =>
          candidateToken.startsWith(token) || token.startsWith(candidateToken),
      )
    ) {
      weightedMatch += positionWeight * 0.75;
      continue;
    }
    const fuzzy = fuzzyTokenCredit(token, titleTokens);
    if (fuzzy !== null) weightedMatch += positionWeight * fuzzy;
  }

  const recall = weightTotal > 0 ? Math.min(1, weightedMatch / weightTotal) : 0;
  const extra = Math.max(0, new Set(titleWords).size - fullyMatched);
  const noisePenalty = Math.min(0.35, extra * 0.05);
  const containment =
    titleNormalized.includes(queryNormalized) ||
    queryNormalized.includes(titleNormalized)
      ? 0.15
      : 0;
  const queryYear = findYear(queryTokens);
  const titleYear = findYear(titleTokens);
  const yearAdjustment =
    queryYear !== null && titleYear !== null
      ? queryYear === titleYear
        ? 0.08
        : -0.12
      : 0;
  const allExactBonus =
    fullyMatched === required.length &&
    new Set(titleWords).size === required.length
      ? 0.1
      : 0;

  // Acronyms: "GTA" ↔ "Grand Theft Auto", "COD" ↔ "Call of Duty", including
  // the sequel form ("GTA V" ↔ "Grand Theft Auto V"). Only a short leading
  // token can be an acronym, which avoids matching ordinary words.
  if (required[0].length >= 2 && required[0].length <= 6) {
    const wanted = required[0];
    const rawWords = acronymWords(candidate);
    const matchPool = [...titleTokens, ...rawWords];
    const restMatched = required
      .slice(1)
      .every((token) => matchPool.some((candidateToken) => sameTokenValue(token, candidateToken)));
    if (restMatched) {
      const variants = [titleWords, rawWords];
      for (const words of variants) {
        const max = Math.min(6, words.length);
        for (let length = 3; length <= max; length += 1) {
          if (acronymOf(words, length) === wanted) return 0.9;
        }
      }
    }
  }

  const base = Math.max(
    0,
    Math.min(
      1,
      Math.max(0, recall - noisePenalty) * 0.85 +
        containment +
        yearAdjustment +
        allExactBonus,
    ),
  );

  // Sequel-number conflict. "Doom 3" must not rank above "Doom 2" for a
  // "Doom 2" query. Only compare when both sides carry a number, so an
  // unnumbered listing is not punished for omitting the numeral.
  const queryNumbers = queryTokens
    .map(tokenNumber)
    .filter((value): value is number => value !== null);
  const titleNumbers = titleTokens
    .map(tokenNumber)
    .filter((value): value is number => value !== null);
  if (
    queryNumbers.length > 0 &&
    titleNumbers.length > 0 &&
    !queryNumbers.some((value) => titleNumbers.includes(value))
  ) {
    return base * 0.35;
  }

  return base;
}

/** Best score over the query and its alternative names. */
export function bestTitleSimilarity(
  query: string,
  aliases: readonly string[],
  title: string,
): number {
  let best = titleSimilarity(query, title);
  for (const alias of aliases) {
    if (!alias || alias === query) continue;
    const score = titleSimilarity(alias, title);
    if (score > best) best = score;
  }
  return best;
}

/** Year bonus/penalty for a title that carries its own 4-digit year. */
export function applyReleaseYearAdjustment(
  score: number,
  title: string,
  releaseYear: number | null | undefined,
): number {
  if (!releaseYear || !Number.isFinite(releaseYear)) return score;
  // Read the raw title first: normalizeTitle strips a bracketed year, which is
  // exactly the common "Game (2016)" listing this adjustment is for.
  const rawYear = String(title ?? "").match(/\b(19|20)\d{2}\b/);
  const year = rawYear
    ? Number.parseInt(rawYear[0], 10)
    : findYear(tokenize(title));
  if (year === null) return score;
  const adjusted = year === Math.abs(Math.trunc(releaseYear)) ? score + 0.08 : score - 0.12;
  return Math.max(0, Math.min(1, adjusted));
}

/**
 * Cleaner fallback query for a verbose game title ("ELDEN RING™ (2022)
 * Deluxe v3" → "ELDEN RING"). `null` when cleaning changes nothing.
 */
export function cleanSearchQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const primary = splitPrimary(trimmed).replace(TRADEMARKS, "");
  const flattened = primary.replace(/[()[\]{}]/g, " ");
  const kept = flattened
    .split(/\s+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean)
    .filter((token) => !(/^\d{4}$/.test(token) && Number(token) >= 1900))
    .filter((token) => !NOISE_TOKENS.has(token.toLowerCase()))
    .filter((token) => !/^v\d/i.test(token));
  const joined = kept.join(" ");
  const cleaned =
    joined.length >= 3
      ? joined
      : primary.length >= 3
        ? primary
        : trimmed;
  return cleaned.trim() === trimmed.trim() ? null : cleaned.trim();
}
