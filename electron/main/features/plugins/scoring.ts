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
]);

const TRADEMARKS = /[\u00ae\u2122\u00a9]/g;

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

/** Drop a trailing 1900–2099 year token. */
function stripTrailingYear(input: string): string {
  const trimmed = input.trimEnd();
  const match = /(^|\s)(19\d{2}|20\d{2})$/.exec(trimmed);
  if (!match) return input;
  return trimmed.slice(0, trimmed.length - match[2].length).trimEnd();
}

/** Lowercase, accent-folded, primary-name, edition-noise-free title. */
export function normalizeTitle(input: string): string {
  const primary = splitPrimary(splitBoundaries(String(input ?? "")))
    .replace(TRADEMARKS, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const flattened = stripTrailingYear(primary)
    .replace(/[()[\]{}]/g, " ")
    .replace(/[.,!?/\\"'|+&=~*_]/g, " ");
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

  let weightedMatch = 0;
  let weightTotal = 0;
  let fullyMatched = 0;
  for (let index = 0; index < queryTokens.length; index += 1) {
    const token = queryTokens[index];
    const positionWeight =
      1 + Math.max(0, queryTokens.length - 1 - index) * 0.04;
    weightTotal += positionWeight;
    if (titleSet.has(token)) {
      weightedMatch += positionWeight;
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
  const extra = Math.max(0, titleSet.size - fullyMatched);
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
    fullyMatched === queryTokens.length && titleSet.size === queryTokens.length
      ? 0.1
      : 0;

  return Math.max(
    0,
    Math.min(
      1,
      Math.max(0, recall - noisePenalty) * 0.85 +
        containment +
        yearAdjustment +
        allExactBonus,
    ),
  );
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
  const tokens = tokenize(title);
  if (tokens.length === 0) return score;
  const year = findYear(tokens);
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
