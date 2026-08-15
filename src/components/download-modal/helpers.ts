import type { MatchedDownload } from "../../types/source";
import type { DownloadSearchResult } from "../../types/plugins";
import type {
  DisplayMatch,
  SourceFilterOption,
  PlatformFilter,
  DownloadTypeFilter,
} from "./types";

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

/**
 * Classify a resolved URI into the three engine paths we support.
 *
 * `knownTorrentUrl` lets callers tell us a URI is a `.torrent` link even
 * when its shape doesn't say so — some sources serve the torrent through
 * a script endpoint (`index.php?do=download&id=…`) that has no `.torrent`
 * suffix. Plugin results carry that link in their dedicated `torrentUrl`
 * field, which is authoritative, so pass `match.torrentUrl` here.
 */
export function classifyUri(
  uri: string | null,
  knownTorrentUrl?: string | null,
): {
  isMagnet: boolean;
  isTorrentFile: boolean;
  isDirect: boolean;
} {
  const isMagnet = !!uri && uri.startsWith("magnet:");
  const isTorrentFile =
    !!uri &&
    (uri.endsWith(".torrent") ||
      uri.includes(".torrent?") ||
      (!!knownTorrentUrl && uri === knownTorrentUrl));
  const isDirect =
    !!uri &&
    !isMagnet &&
    !isTorrentFile &&
    (uri.startsWith("http://") || uri.startsWith("https://"));
  return { isMagnet, isTorrentFile, isDirect };
}

/**
 * Return the detail-page URL for a result that has no downloadable
 * URI (no magnet / .torrent / direct link) — i.e. a "web link only"
 * plugin hit. The modal offers an "Open in browser" action for these
 * instead of a download. Returns null when the match is downloadable
 * or has no detail URL.
 */
export function webUrlFor(
  match: DownloadSearchResult | undefined,
): string | null {
  if (!match) return null;
  if (resolveSourceUri(match, 0) != null) return null;
  const url = match.detailUrl;
  return url && url.trim() ? url : null;
}

/**
 * Whether a direct-link hoster can only be unlocked in a real browser
 * (gofile, filecrypt, and the captcha-gated vikingfile / datanodes pages).
 * Mirrors `hosters::hoster_strategy` on the Rust side so the modal can
 * emphasise the resolver CTA without a backend round-trip.
 */
export function hosterNeedsBrowser(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    const urlObj = new URL(uri);
    const host = urlObj.hostname.toLowerCase();
    if (host.includes("gofile.io") || host.includes("gofilecdn")) return true;
    if (host.includes("filecrypt.cc") || host.includes("filecrypt.co")) return true;
    if (host.includes("datanodes.to")) return true;
    if (host.includes("vikingfile")) return urlObj.pathname.startsWith("/f/");
    return false;
  } catch {
    return false;
  }
}

/** Derive a friendly host label from a mirror URI for the chip picker. */
export function hostLabelForUri(uri: string, fallbackIndex: number): string {
  if (!uri) return `Mirror ${fallbackIndex + 1}`;
  if (uri.startsWith("magnet:")) return "Magnet Link";
  try {
    const urlObj = new URL(uri);
    const host = urlObj.hostname.replace(/^www\./, "");
    if (host.includes("arweave.net")) return "Arweave Direct";
    if (host.includes("vimm.net")) return "Vimm Vault Direct";
    if (host.includes("buzzheavier.com")) return "Buzzheavier";
    if (host.includes("gofile.io")) return "Gofile";
    if (host.includes("1fichier.com")) return "1fichier";
    if (host.includes("mega.nz")) return "MEGA";
    if (host.includes("mediafire.com")) return "MediaFire";
    if (host.includes("pixeldrain.com")) return "Pixeldrain";
    if (host.includes("qiwi.gg")) return "Qiwi";
    if (urlObj.pathname.endsWith(".torrent")) return `${host} (.torrent)`;
    return host || `Mirror ${fallbackIndex + 1}`;
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

/**
 * Extract unique source filter options from the search matches,
 * including counts for "all", categories ("sources", "plugins"),
 * and individual sources.
 */
export function extractSourceFilters(
  matches: DisplayMatch[],
  t: (key: string, params?: Record<string, unknown>) => string,
): SourceFilterOption[] {
  if (matches.length === 0) return [];

  const sourceCountMap = new Map<string, { label: string; count: number; provider: "source" | "plugin" }>();
  let builtinCount = 0;
  let pluginCount = 0;

  for (const m of matches) {
    const isPlugin = m.provider === "plugin";
    if (isPlugin) pluginCount++;
    else builtinCount++;

    const key = m.sourceId || m.sourceName;
    const existing = sourceCountMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      sourceCountMap.set(key, {
        label: m.sourceName || key,
        count: 1,
        provider: isPlugin ? "plugin" : "source",
      });
    }
  }

  const options: SourceFilterOption[] = [
    {
      id: "all",
      label: t("downloadModal.allSources"),
      count: matches.length,
      provider: "all",
    },
  ];

  // If results contain both built-in sources and plugins, include category filters
  if (builtinCount > 0 && pluginCount > 0) {
    options.push({
      id: "source",
      label: t("downloadModal.builtInSources"),
      count: builtinCount,
      provider: "source",
    });
    options.push({
      id: "plugin",
      label: t("downloadModal.pluginSources"),
      count: pluginCount,
      provider: "plugin",
    });
  }

  // Append individual sources sorted by result count descending, then name ascending
  const sourceEntries = Array.from(sourceCountMap.entries()).sort(
    ([, a], [, b]) => b.count - a.count || a.label.localeCompare(b.label),
  );

  for (const [id, info] of sourceEntries) {
    options.push({
      id,
      label: info.label,
      count: info.count,
      provider: info.provider,
    });
  }

  return options;
}

/**
 * Broad platform class of a match. Built-in sources are PC repacks;
 * plugin hits inherit the category their plugin manifest declared
 * (unknown values fall back to "pc").
 */
export function platformCategoryOf(
  match: DownloadSearchResult,
): "pc" | "console" | "hybrid" {
  if (match.provider === "plugin") {
    const c = (match.platformCategory ?? "").toLowerCase();
    if (c === "console" || c === "hybrid") return c;
    return "pc";
  }
  return "pc";
}

/**
 * Which download methods a match actually offers, derived from its
 * magnet, torrent URL and mirror URIs. A result offering several
 * methods appears under each of them.
 */
export function matchDownloadTypes(
  match: DownloadSearchResult,
): Set<"torrent" | "magnet" | "direct"> {
  const types = new Set<"torrent" | "magnet" | "direct">();
  if (match.magnet && match.magnet.trim()) types.add("magnet");
  if (match.torrentUrl && match.torrentUrl.trim()) types.add("torrent");
  for (const uri of match.uris ?? []) {
    if (!uri) continue;
    const { isMagnet, isTorrentFile, isDirect } = classifyUri(
      uri,
      match.torrentUrl ?? null,
    );
    if (isMagnet) types.add("magnet");
    else if (isTorrentFile) types.add("torrent");
    else if (isDirect) types.add("direct");
  }
  return types;
}

/**
 * Filter a list of matches by active source filter, platform class,
 * download type and search text.
 */
export function filterMatches(
  matches: DisplayMatch[],
  sourceFilter: string,
  searchQuery?: string,
  platformFilter: PlatformFilter = "all",
  typeFilter: DownloadTypeFilter = "all",
): DisplayMatch[] {
  let list = matches;

  if (sourceFilter && sourceFilter !== "all") {
    if (sourceFilter === "source" || sourceFilter === "sources") {
      list = list.filter((m) => m.provider !== "plugin");
    } else if (sourceFilter === "plugin" || sourceFilter === "plugins") {
      list = list.filter((m) => m.provider === "plugin");
    } else {
      list = list.filter(
        (m) =>
          m.sourceId === sourceFilter ||
          m.pluginId === sourceFilter ||
          m.sourceName.toLowerCase() === sourceFilter.toLowerCase(),
      );
    }
  }

  if (platformFilter && platformFilter !== "all") {
    list = list.filter((m) => {
      const cat = platformCategoryOf(m);
      if (platformFilter === "pc") return cat !== "console";
      return cat !== "pc"; // console: keep console + hybrid hits
    });
  }

  if (typeFilter && typeFilter !== "all") {
    list = list.filter((m) => matchDownloadTypes(m).has(typeFilter));
  }

  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter((m) => {
      return (
        m.title.toLowerCase().includes(q) ||
        (m.platform && m.platform.toLowerCase().includes(q)) ||
        (m.sourceName && m.sourceName.toLowerCase().includes(q)) ||
        (m.provenance && m.provenance.toLowerCase().includes(q))
      );
    });
  }

  return list;
}

/** Return a re-sorted copy of the matches for display. The canonical
 *  `matches` array stays score-ordered; this only affects presentation
 *  and the selection mapping (which is id-based, so reordering is safe).
 *
 *  Plugin results are a distinct block: the backend pre-sorts them
 *  newest-first, so user sorting applies to the source block only and
 *  plugin rows always stay grouped at the bottom in their returned
 *  order when viewing all sources. When filtering by a single source/plugin,
 *  all results in that group sort according to the selected sort key. */
export function sortMatches<T extends { sourceName: string; matchScore: number; uploadDate?: string | null; provider?: string }>(
  list: T[],
  sortBy: "date" | "source" | "relevance",
  isFiltered = false,
): T[] {
  if (isFiltered) {
    const copy = [...list];
    if (sortBy === "source") {
      copy.sort(
        (a, b) =>
          a.sourceName.localeCompare(b.sourceName) || b.matchScore - a.matchScore,
      );
    } else if (sortBy === "relevance") {
      copy.sort((a, b) => b.matchScore - a.matchScore);
    } else {
      copy.sort((a, b) => dateValue(b.uploadDate) - dateValue(a.uploadDate));
    }
    return copy;
  }

  const sources: T[] = [];
  const plugins: T[] = [];
  for (const item of list) {
    if (item.provider === "plugin") plugins.push(item);
    else sources.push(item);
  }
  if (sortBy === "source") {
    sources.sort(
      (a, b) =>
        a.sourceName.localeCompare(b.sourceName) || b.matchScore - a.matchScore,
    );
  } else if (sortBy === "relevance") {
    sources.sort((a, b) => b.matchScore - a.matchScore);
  } else {
    // date — newest first; entries without a parseable date go last.
    sources.sort((a, b) => dateValue(b.uploadDate) - dateValue(a.uploadDate));
  }
  return [...sources, ...plugins];
}
