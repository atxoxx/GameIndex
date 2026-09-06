// Version helpers for the installed-game "update available" check.
//
// The check compares the file version read from a game's executable
// against the newest version parsed out of download-source titles
// (e.g. `Game_v1.2.3_[FitGirl]`). These functions are pure so the
// parsing heuristics are unit-testable in isolation.

/** Matches a version token with an explicit `v`/`ver`/`version` prefix
 *  (e.g. `v1.2.3`, `ver 1.2`, `version 1.2.3.4`). At least one dotted
 *  component is required, so a bare 4-digit year never matches. */
const PREFIXED_VERSION_RE =
  /(?:^|[\s_.\-\[\(\{])(?:v|ver\.?|version)\s*(\d+(?:\.\d+){1,3})(?![\d.])/i;

/** Matches a version token wrapped in parens/brackets/braces (e.g.
 *  `(1.2)`, `[1.2.3]`). Requiring the wrapper avoids treating a bare
 *  number inside a game name as a version. */
const WRAPPED_VERSION_RE = /[\(\[\{]\s*(\d+(?:\.\d+){1,3})\s*[\)\]\}]/;

/**
 * Extract a version string from a download result title.
 *
 * Accepts both `v`-prefixed tokens anywhere in the title and
 * parenthesis/bracket-wrapped dotted numbers. Returns `null` when the
 * title carries no recognizable version.
 */
export function parseVersionFromTitle(title: string): string | null {
  if (!title) return null;

  const prefixed = PREFIXED_VERSION_RE.exec(title);
  if (prefixed) return prefixed[1];

  const wrapped = WRAPPED_VERSION_RE.exec(title);
  if (wrapped) return wrapped[1];

  return null;
}

/**
 * Numeric, component-wise version comparison ("1.9" < "1.10",
 * "1.2" < "1.2.3", "1.2.0.0" == "1.2"). Returns -1, 0 or 1.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
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