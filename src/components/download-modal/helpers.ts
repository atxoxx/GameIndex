import type { MatchedDownload } from "../../types/source";

/**
 * Single source of truth for "which URI does the user actually want to
 * download". The Rust match can carry explicit `uris` (mirrors) and an
 * optional convenience `magnet`. The user's selected mirror index wins
 * when it points at a real URI; otherwise we fall back to the magnet,
 * then to the first URI. Returning `null` is a hard signal that this
 * match has nothing downloadable (shouldn't happen for results the Rust
 * side vetted, but we guard anyway).
 */
export function resolveSourceUri(
  match: MatchedDownload | undefined,
  mirrorIdx: number,
): string | null {
  if (!match) return null;
  if (mirrorIdx >= 0 && mirrorIdx < match.uris.length) {
    return match.uris[mirrorIdx];
  }
  return match.magnet ?? match.uris[0] ?? null;
}

/** Classify a resolved URI into the three engine paths we support. */
export function classifyUri(uri: string | null): {
  isMagnet: boolean;
  isTorrentFile: boolean;
  isDirect: boolean;
} {
  const isMagnet = !!uri && uri.startsWith("magnet:");
  const isTorrentFile =
    !!uri && (uri.endsWith(".torrent") || uri.includes(".torrent?"));
  const isDirect =
    !!uri &&
    !isMagnet &&
    !isTorrentFile &&
    (uri.startsWith("http://") || uri.startsWith("https://"));
  return { isMagnet, isTorrentFile, isDirect };
}

/** Derive a friendly host label from a mirror URI for the chip picker. */
export function hostLabelForUri(uri: string, fallbackIndex: number): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return `Mirror ${fallbackIndex + 1}`;
  }
}

/** Numeric value used to order results by upload date (newest first).
 *  Missing / unparseable dates sink to the bottom. */
function dateValue(date: string | null | undefined): number {
  if (!date) return 0;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Render a source's raw upload date in the user's locale. Sources hand
 * us the string verbatim (usually an ISO timestamp like
 * "2026-01-05T09:52:00.000Z"), which is unfriendly to read — so we
 * format it as e.g. "Jan 5, 2026". Anything we can't parse is shown
 * as-is, and a missing date becomes an em dash.
 */
export function formatUploadDate(
  raw: string | null | undefined,
  language: string,
): string {
  if (raw == null || raw === "") return "—";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(parsed);
  } catch {
    // Unknown/unusual locale code — fall back to the raw string rather
    // than crashing the modal.
    return raw;
  }
}

/** Return a re-sorted copy of the matches for display. The canonical
 *  `matches` array stays score-ordered; this only affects presentation
 *  and the selection mapping (which is id-based, so reordering is safe). */
export function sortMatches<T extends { sourceName: string; matchScore: number; uploadDate?: string | null }>(
  list: T[],
  sortBy: "date" | "source" | "relevance",
): T[] {
  const copy = [...list];
  if (sortBy === "source") {
    copy.sort(
      (a, b) =>
        a.sourceName.localeCompare(b.sourceName) || b.matchScore - a.matchScore,
    );
  } else if (sortBy === "relevance") {
    copy.sort((a, b) => b.matchScore - a.matchScore);
  } else {
    // date — newest first; entries without a parseable date go last.
    copy.sort((a, b) => dateValue(b.uploadDate) - dateValue(a.uploadDate));
  }
  return copy;
}
