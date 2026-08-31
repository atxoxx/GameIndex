import type { MatchedDownload } from "../../types/source";
import type { DownloadSearchResult } from "../../types/plugins";
import type {
  DisplayMatch,
  SourceFilterOption,
  PlatformFilter,
  DownloadTypeFilter,
  ParsedReleaseMeta,
  MirrorOption,
  SortKey,
} from "./types";

/**
 * Single source of truth for "which URI does the user actually want to
 * download". The Rust match can carry explicit `uris` (mirrors) and an
 * optional convenience `magnet`. The user's selected mirror index wins
 * when it points at a real URI; otherwise we fall back to the magnet,
 * then to the first URI. Returning `null` is a hard signal that this
 * match has nothing downloadable.
 */
export function resolveSourceUri(
  match: MatchedDownload | undefined,
  mirrorIdx = 0,
): string | null {
  if (!match) return null;
  if (mirrorIdx >= 0 && mirrorIdx < match.uris.length) {
    return match.uris[mirrorIdx];
  }
  return match.magnet ?? match.uris[0] ?? null;
}

/**
 * Classify a resolved URI into the three engine paths we support.
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
 * plugin hit.
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
 * Whether a direct-link hoster / protector can or should be unlocked in a real browser.
 */
export function hosterNeedsBrowser(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    const urlObj = new URL(uri);
    const host = urlObj.hostname.toLowerCase();
    const path = urlObj.pathname.toLowerCase();

    // Link crypt / interstitial / paste containers (always require user interaction)
    if (host.includes("filecrypt.cc") || host.includes("filecrypt.co")) return true;
    if (host.includes("ouo.io") || host.includes("ouo.press")) return true;
    if (
      host.includes("pastebin.com") ||
      host.includes("rentry.co") ||
      host.includes("rentry.org") ||
      host.includes("controlc.com") ||
      host.includes("justpaste.it")
    ) {
      return true;
    }

    // Gofile folders (require webview solver or token derivation)
    if ((host.includes("gofile.io") || host.includes("gofilecdn")) && !path.includes("/download/")) return true;

    // Known captcha-gated or browser-challenge hosters
    if (
      host.includes("rapidgator.net") ||
      host.includes("ddownload.com") ||
      host.includes("katfile.com") ||
      host.includes("nitroflare.com") ||
      host.includes("turbobit.net") ||
      host.includes("send.cm") ||
      host.includes("uploadhaven.com") ||
      host.includes("hexupload.net") ||
      host.includes("rosefile.net") ||
      host.includes("mexashare.com") ||
      host.includes("bowfile.com") ||
      host.includes("modsfire.com") ||
      host.includes("qiwi.gg") ||
      (host.includes("vikingfile") && path.startsWith("/f/")) ||
      (host.includes("datanodes.to") && !path.startsWith("/d/"))
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/** Derive a friendly host label from a mirror URI for the chip picker. */
export function hostLabelForUri(uri: string, fallbackIndex = 0): string {
  if (!uri) return `Mirror ${fallbackIndex + 1}`;
  if (uri.startsWith("magnet:")) return "Magnet Link";
  try {
    const urlObj = new URL(uri);
    const host = urlObj.hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("filecrypt.cc") || host.includes("filecrypt.co")) return "Filecrypt Container";
    if (host.includes("ouo.io") || host.includes("ouo.press")) return "OuO Link";
    if (host.includes("rentry.co") || host.includes("rentry.org")) return "Rentry Mirror";
    if (host.includes("pastebin.com")) return "Pastebin Mirror";
    if (host.includes("arweave.net")) return "Arweave Direct";
    if (host.includes("vimm.net")) return "Vimm Vault Direct";
    if (host.includes("buzzheavier.com")) return "Buzzheavier";
    if (host.includes("gofile.io") || host.includes("gofilecdn")) return "Gofile";
    if (host.includes("datanodes.to")) return "Datanodes";
    if (host.includes("1fichier.com")) return "1fichier";
    if (host.includes("krakenfiles.com")) return "KrakenFiles";
    if (host.includes("qiwi.gg") || host.includes("qiwi.to")) return "Qiwi";
    if (host.includes("megaup.net")) return "MegaUp";
    if (host.includes("fuckingfast.co")) return "FuckingFast";
    if (host.includes("rootz.so")) return "Rootz";
    if (host.includes("vikingfile.com") || host.includes("vik1ngfile.site")) return "VikingFile";
    if (host.includes("mega.nz")) return "MEGA";
    if (host.includes("mediafire.com")) return "MediaFire";
    if (host.includes("pixeldrain.com")) return "Pixeldrain";
    if (host.includes("rapidgator.net")) return "Rapidgator";
    if (host.includes("ddownload.com")) return "DDownload";
    if (host.includes("katfile.com")) return "Katfile";
    if (host.includes("nitroflare.com")) return "Nitroflare";
    if (host.includes("turbobit.net")) return "Turbobit";
    if (host.includes("send.cm")) return "Send.cm";
    if (host.includes("uploadhaven.com")) return "UploadHaven";
    if (host.includes("hexupload.net")) return "HexUpload";
    if (host.includes("bowfile.com")) return "Bowfile";
    if (host.includes("modsfire.com")) return "ModsFire";
    if (host.includes("multiup.io") || host.includes("multiup.org")) return "MultiUp";
    if (host.includes("archive.org")) return "Internet Archive";
    if (urlObj.pathname.endsWith(".torrent")) return `${host} (.torrent)`;
    return urlObj.hostname.replace(/^www\./, "") || `Mirror ${fallbackIndex + 1}`;
  } catch {
    return `Mirror ${fallbackIndex + 1}`;
  }
}

/** Parse human-readable byte sizes into numeric bytes (e.g. "62.4 GB" -> 67001489817). */
export function parseByteSize(sizeStr: string | number | null | undefined): number {
  if (typeof sizeStr === "number") return sizeStr;
  if (!sizeStr || typeof sizeStr !== "string") return 0;
  const match = sizeStr.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (Number.isNaN(val)) return 0;
  const unit = (match[2] || "B").toUpperCase();
  switch (unit) {
    case "TB":
    case "TIB":
      return val * 1024 * 1024 * 1024 * 1024;
    case "GB":
    case "GIB":
      return val * 1024 * 1024 * 1024;
    case "MB":
    case "MIB":
      return val * 1024 * 1024;
    case "KB":
    case "KIB":
      return val * 1024;
    case "B":
    default:
      return val;
  }
}

const KNOWN_SCENE_GROUPS = [
  "FitGirl",
  "DODI",
  "ElAmigos",
  "TENOKE",
  "RUNE",
  "CODEX",
  "FLT",
  "EMPRESS",
  "Razor1911",
  "GOG",
  "SteamRip",
  "KaOs",
  "SKIDROW",
  "Reloaded",
  "CPY",
  "Plaza",
  "TiNYiSO",
  "TinyRepacks",
  "Chimecho",
  "KaOsKrew",
  "VACE",
  "DEVIANCE",
  "HOODLUM",
  "Fairlight",
  "Unleashed",
  "PROPHET",
  "Repack",
];

const KNOWN_EDITIONS = [
  "Digital Deluxe Edition",
  "Deluxe Edition",
  "Game of the Year Edition",
  "GOTY Edition",
  "GOTY",
  "Ultimate Edition",
  "Complete Edition",
  "Definitive Edition",
  "Director's Cut",
  "Enhanced Edition",
  "Remastered",
  "Anniversary Edition",
  "Collector's Edition",
  "Gold Edition",
  "Special Edition",
  "Standard Edition",
];

/** Extract intelligent release metadata (scene group, version, edition, multi-part, etc.). */
export function parseReleaseMetadata(rawTitle: string): ParsedReleaseMeta {
  if (!rawTitle) return { cleanTitle: "" };

  const clean = rawTitle.trim();
  let detectedGroup: string | undefined;
  let detectedVersion: string | undefined;
  let detectedEdition: string | undefined;
  const detectedLanguages: string[] = [];
  let isMultiPart = false;
  let partCount: number | undefined;

  // 1. Detect Scene/Repack group
  for (const group of KNOWN_SCENE_GROUPS) {
    const regex = new RegExp(`(?:[\\[\\(\\-~ ._]|^)${group}(?:[\\]\\)\\-~ ._]|$)`, "i");
    if (regex.test(clean)) {
      detectedGroup = group;
      break;
    }
  }

  // 2. Detect Edition
  for (const edition of KNOWN_EDITIONS) {
    const regex = new RegExp(`(?:[\\[\\(\\-~ ._]|^)${edition}(?:[\\]\\)\\-~ ._]|$)`, "i");
    if (regex.test(clean)) {
      detectedEdition = edition;
      break;
    }
  }

  // 3. Detect Version (e.g. v1.0.4, Build 14820, Update 3, v20240812)
  const verMatch = clean.match(/(?:v|version|ver|build|update|patch)[ ._-]?([0-9]+(?:\.[0-9a-zA-Z]+)*)/i);
  if (verMatch) {
    detectedVersion = verMatch[0];
  }

  // 4. Detect Multi-language / Multi-part
  const multiLangMatch = clean.match(/MULTi\d+|ENG(?:\/FRA|\/GER|\/ESP|\/RUS|\/JPN|\/ITA|\/KOR|\/ZHO)*/i);
  if (multiLangMatch) {
    detectedLanguages.push(multiLangMatch[0]);
  }

  const multiPartMatch = clean.match(/(?:part|pt)[ ._-]?([0-9]+)(?:[ ._-]?(?:of|\/)[ ._-]?([0-9]+))?/i);
  if (multiPartMatch) {
    isMultiPart = true;
    if (multiPartMatch[2]) {
      partCount = parseInt(multiPartMatch[2], 10);
    }
  }

  return {
    cleanTitle: clean,
    group: detectedGroup,
    version: detectedVersion,
    edition: detectedEdition,
    languages: detectedLanguages.length > 0 ? detectedLanguages : undefined,
    isMultiPart,
    partCount,
  };
}

/** Extract unique scene/repack groups present across a list of matches. */
export function extractReleaseGroups(matches: DisplayMatch[]): string[] {
  const groups = new Set<string>();
  for (const m of matches) {
    const meta = parseReleaseMetadata(m.title);
    if (meta.group) {
      groups.add(meta.group);
    }
  }
  return Array.from(groups).sort((a, b) => a.localeCompare(b));
}

/** Extract structured mirror options from a display match. */
export function extractMirrors(match: DisplayMatch | null | undefined): MirrorOption[] {
  if (!match) return [];
  const mirrors: MirrorOption[] = [];
  const seenUris = new Set<string>();

  if (match.uris && match.uris.length > 0) {
    match.uris.forEach((uri, idx) => {
      if (!uri || seenUris.has(uri)) return;
      seenUris.add(uri);
      const { isMagnet, isTorrentFile, isDirect } = classifyUri(uri, match.torrentUrl);
      const label = hostLabelForUri(uri, idx);
      mirrors.push({
        index: idx,
        uri,
        label,
        hostName: label,
        isMagnet,
        isTorrentFile,
        isDirect,
        needsBrowser: hosterNeedsBrowser(uri),
      });
    });
  }

  // If explicit magnet is present and wasn't in uris, include it
  if (match.magnet && !seenUris.has(match.magnet)) {
    seenUris.add(match.magnet);
    mirrors.push({
      index: mirrors.length,
      uri: match.magnet,
      label: "Magnet Link",
      hostName: "Magnet",
      isMagnet: true,
      isTorrentFile: false,
      isDirect: false,
      needsBrowser: false,
    });
  }

  // If explicit .torrent URL is present and wasn't in uris, include it
  if (match.torrentUrl && !seenUris.has(match.torrentUrl)) {
    seenUris.add(match.torrentUrl);
    mirrors.push({
      index: mirrors.length,
      uri: match.torrentUrl,
      label: `${match.sourceName} (.torrent)`,
      hostName: "Torrent File",
      isMagnet: false,
      isTorrentFile: true,
      isDirect: false,
      needsBrowser: false,
    });
  }

  return mirrors;
}

/** Numeric value used to order results by upload date (newest first). */
function dateValue(date: string | null | undefined): number {
  if (!date) return 0;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Render a source's raw upload date in the user's locale. */
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
    return raw;
  }
}

/**
 * Extract unique source filter options from the search matches.
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

/** Broad platform class of a match. */
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

/** Which download methods a match actually offers. */
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

/** Filter a list of matches by active source filter, platform class, download type, group filter, and search text. */
export function filterMatches(
  matches: DisplayMatch[],
  sourceFilter: string,
  searchQuery?: string,
  platformFilter: PlatformFilter = "all",
  typeFilter: DownloadTypeFilter = "all",
  groupFilter = "all",
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
      return cat !== "pc";
    });
  }

  if (typeFilter && typeFilter !== "all") {
    list = list.filter((m) => matchDownloadTypes(m).has(typeFilter));
  }

  if (groupFilter && groupFilter !== "all") {
    list = list.filter((m) => {
      const meta = parseReleaseMetadata(m.title);
      return meta.group?.toLowerCase() === groupFilter.toLowerCase();
    });
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

/** Return a re-sorted copy of the matches for display. */
export function sortMatches<T extends { sourceName: string; matchScore: number; uploadDate?: string | null; fileSize?: string | null; seeds?: number | null; provider?: string }>(
  list: T[],
  sortBy: SortKey,
  isFiltered = false,
): T[] {
  const comparator = (a: T, b: T): number => {
    switch (sortBy) {
      case "source":
        return a.sourceName.localeCompare(b.sourceName) || b.matchScore - a.matchScore;
      case "relevance":
        return b.matchScore - a.matchScore;
      case "size_desc":
        return parseByteSize(b.fileSize) - parseByteSize(a.fileSize) || b.matchScore - a.matchScore;
      case "size_asc":
        return parseByteSize(a.fileSize) - parseByteSize(b.fileSize) || b.matchScore - a.matchScore;
      case "seeds":
        return (b.seeds ?? 0) - (a.seeds ?? 0) || b.matchScore - a.matchScore;
      case "date":
      default:
        return dateValue(b.uploadDate) - dateValue(a.uploadDate) || b.matchScore - a.matchScore;
    }
  };

  if (isFiltered) {
    const copy = [...list];
    copy.sort(comparator);
    return copy;
  }

  const sources: T[] = [];
  const plugins: T[] = [];
  for (const item of list) {
    if (item.provider === "plugin") plugins.push(item);
    else sources.push(item);
  }

  sources.sort(comparator);
  return [...sources, ...plugins];
}

/** Categorize a file by its extension for selective download file browser icons. */
export function getFileCategory(filename: string): "executable" | "archive" | "disc" | "media" | "data" | "document" {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["exe", "bat", "cmd", "msi", "dll"].includes(ext)) return "executable";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) return "archive";
  if (["iso", "bin", "cue", "img", "nrg", "mdf", "vhd"].includes(ext)) return "disc";
  if (["mp4", "mkv", "avi", "webm", "mp3", "flac", "wav", "ogg"].includes(ext)) return "media";
  if (["pak", "dat", "vpk", "bundle", "rpf", "asset", "assets", "arc", "cpk"].includes(ext)) return "data";
  return "document";
}
