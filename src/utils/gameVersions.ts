// Version helpers for the installed-game "update available" check and download-modal release comparison.
//
// Compares installed game versions (from executable PE resources or store manifests)
// against versions parsed out of download-source titles (e.g. `Game_v1.2.3_[FitGirl]`,
// `Game.Update.v2.1-RUNE`, `Build 14820`, `Patch 1.05`).

/** Explicit Update / Patch / Hotfix / Build prefix. */
const UPDATE_PATCH_BUILD_RE =
  /(?:^|[\s_.\-\[\(\{])(?:update|patch|build|hotfix|b)\s*(?:#|v|ver\.?)?\s*([0-9]+(?:\.[0-9]+)*(?:[a-zA-Z])?)(?![\d.])/i;

/** Matches a version token with an explicit `v`/`ver`/`version` prefix
 *  (e.g. `v1.2.3`, `ver 1.2`, `version 1.2.3.4`, `v20240812`, `v1.04b`). */
const PREFIXED_VERSION_RE =
  /(?:^|[\s_.\-\[\(\{])(?:v|ver\.?|version)\s*([0-9]+(?:\.[0-9]+)*(?:[a-zA-Z])?)(?![\d.])/i;

/** Matches a version token wrapped in parens/brackets/braces (e.g.
 *  `(1.2)`, `[1.2.3]`, `[v2.4]`, `(1.04b)`). Requiring at least one dot,
 *  letter, or explicit v prefix prevents bare 4-digit release years like `(2009)` from matching. */
const WRAPPED_VERSION_RE =
  /[\(\[\{]\s*(?:v|ver\.?)?\s*([0-9]+(?:\.[0-9]+)+[a-zA-Z]?|[0-9]+[a-zA-Z]|v[0-9]+(?:\.[0-9]+)*)\s*[\)\]\}]/i;

/** Delimited standalone dotted version (e.g. `Game.1.0.5.Repack` or `Game - 1.2.3 - Repack`). */
const DELIMITED_VERSION_RE =
  /(?:^|[\s_.\-])([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z])?)(?:[\s_.\-]|$)/;

function cleanVersionToken(raw: string): string {
  let s = raw.trim().replace(/^v/i, "");
  // Remove surrounding brackets or trailing delimiters
  s = s.replace(/^[._\-]+|[._\-]+$/g, "");
  return s;
}

/**
 * Extract a version string from a download result title.
 *
 * Supports:
 * - Update / Patch / Hotfix / Build prefixes (e.g. `Update 3`, `Patch 1.05`, `Build 14820`)
 * - `v`-prefixed tokens (e.g. `v1.2.3`, `v20240812`, `v1.04b`)
 * - Bracketed/parenthesized versions (e.g. `(1.0.2)`, `[2.4]`)
 * - Standalone dotted versions (e.g. `Game.1.0.5.Repack`)
 *
 * Returns `null` when the title carries no recognizable version.
 */
export function parseVersionFromTitle(title: string): string | null {
  if (!title) return null;

  // 1. Explicit keyword: Update, Patch, Build, Hotfix
  const updateMatch = UPDATE_PATCH_BUILD_RE.exec(title);
  if (updateMatch && updateMatch[1]) {
    const cleaned = cleanVersionToken(updateMatch[1]);
    if (cleaned) return cleaned;
  }

  // 2. Explicit version prefix: v1.2.3, ver 1.2, version 1.0.4.1
  const prefixed = PREFIXED_VERSION_RE.exec(title);
  if (prefixed && prefixed[1]) {
    const cleaned = cleanVersionToken(prefixed[1]);
    if (cleaned) return cleaned;
  }

  // 3. Parentheses/bracket-wrapped dotted version: (1.0.2), [2.4], (1.04b)
  const wrapped = WRAPPED_VERSION_RE.exec(title);
  if (wrapped && wrapped[1]) {
    const cleaned = cleanVersionToken(wrapped[1]);
    if (cleaned) return cleaned;
  }

  // 4. Standalone delimited dotted version: Game.1.0.5.Repack
  const delimited = DELIMITED_VERSION_RE.exec(title);
  if (delimited && delimited[1]) {
    const cleaned = cleanVersionToken(delimited[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

interface VersionChunk {
  num: number;
  suffix: string;
}

function parseChunk(raw: string): VersionChunk {
  const match = raw.trim().match(/^(\d+)(.*)$/);
  if (!match) {
    return { num: 0, suffix: raw.trim().toLowerCase() };
  }
  const num = parseInt(match[1], 10);
  const suffix = match[2].trim().toLowerCase();
  return { num: isNaN(num) ? 0 : num, suffix };
}

function normalizeVersionInput(v: string): string[] {
  let s = v.trim();
  // Strip common leading tags
  s = s.replace(/^(?:version|release|ver\.?|patch|update|build|hotfix|v)\s*/i, "");
  // Convert commas to dots
  s = s.replace(/,/g, ".");
  // Split on dots, hyphens or underscores
  return s.split(/[._\-]/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Numeric and semantic component-wise version comparison.
 * Returns:
 *   -1 if a < b
 *    0 if a == b
 *    1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  if (a === b) return 0;

  const partsA = normalizeVersionInput(a);
  const partsB = normalizeVersionInput(b);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const chunkA = i < partsA.length ? parseChunk(partsA[i]) : { num: 0, suffix: "" };
    const chunkB = i < partsB.length ? parseChunk(partsB[i]) : { num: 0, suffix: "" };

    if (chunkA.num > chunkB.num) return 1;
    if (chunkA.num < chunkB.num) return -1;

    // Numbers are equal; compare suffixes
    if (chunkA.suffix !== chunkB.suffix) {
      // An empty suffix on a release is typically older than a post-release patch suffix (e.g. 1.04b > 1.04)
      // but newer than a pre-release suffix (e.g. 1.0.0 > 1.0.0-rc1)
      const isPreReleaseA = /^(?:rc|beta|alpha|pre|dev)/.test(chunkA.suffix);
      const isPreReleaseB = /^(?:rc|beta|alpha|pre|dev)/.test(chunkB.suffix);

      if (chunkA.suffix === "" && isPreReleaseB) return 1;
      if (chunkB.suffix === "" && isPreReleaseA) return -1;
      if (chunkA.suffix === "") return -1;
      if (chunkB.suffix === "") return 1;

      if (chunkA.suffix > chunkB.suffix) return 1;
      if (chunkA.suffix < chunkB.suffix) return -1;
    }
  }

  return 0;
}

/**
 * Return the newest version across a list of download titles, or
 * `null` when none of them carries a parseable version.
 */
export function findLatestVersion(titles: string[]): string | null {
  let latest: string | null = null;
  for (const title of titles) {
    const version = parseVersionFromTitle(title);
    if (version && (latest === null || compareVersions(version, latest) > 0)) {
      latest = version;
    }
  }
  return latest;
}

export type VersionComparisonResult = "newer" | "same" | "older" | "unknown";

/**
 * Compare a release title/version against an installed game's version.
 */
export function compareReleaseToInstalled(
  releaseVersion: string | null | undefined,
  installedVersion: string | null | undefined
): VersionComparisonResult {
  if (!releaseVersion || !installedVersion) return "unknown";
  try {
    const diff = compareVersions(releaseVersion, installedVersion);
    if (diff > 0) return "newer";
    if (diff === 0) return "same";
    return "older";
  } catch {
    return "unknown";
  }
}