/**
 * GameIndex sandboxed plugin API — ambient TypeScript declarations.
 *
 * Drop a `/// <reference path="./api.d.ts" />` (or add this file to your
 * editor's `types`/`include`) next to your plugin and you get autocomplete for
 * every sandbox global, the manifest descriptor and the result shape.
 *
 * These declarations describe the *frozen* plugin API. They are authored for
 * tooling only — the runtime is QuickJS, not TypeScript, so nothing here is
 * emitted or type-checked at plugin load time.
 *
 * Runtime guarantees (see docs/plugins/README.md):
 *   - A fresh sandbox per search: no state survives between calls.
 *   - HTTP is GET-only by default; only http:// and https:// are allowed.
 *   - 20 s wall clock, 64 MiB memory and an instruction budget per search.
 *   - No setTimeout, fetch, filesystem, require or DOM.
 */

// ---------------------------------------------------------------------------
// Manifest / descriptor
// ---------------------------------------------------------------------------

/** Broad platform class a plugin searches. */
type PlatformCategory = "pc" | "console" | "hybrid";

/**
 * The object passed to `definePlugin`. `definePlugin` must be called exactly
 * once per plugin file.
 */
interface PluginDescriptor {
  /** Stable, URL-safe identifier. Must match `^[a-z0-9-]+$`. */
  id: string;
  /** Human-readable plugin name shown in the UI. */
  name: string;
  /** Semver string, e.g. "1.0.0". */
  version: string;
  /** Author / maintainer. */
  author: string;
  /** One-line description of what the plugin searches. */
  description: string;
  /** Canonical site the plugin queries. */
  sourceUrl: string;
  /** Broad platform class this plugin covers. */
  platformCategory: PlatformCategory;
  /**
   * Hosts the plugin is allowed to contact, when the host restricts egress.
   * Omit to allow any host reachable over http(s).
   */
  allowedHosts?: string[];
  /** Minimum delay between outbound requests, in milliseconds. */
  rateLimitMs?: number;
  /** How long search results may be cached, in seconds. */
  cacheTtlSecs?: number;
  /** Icon URL or built-in icon name for the source list. */
  icon?: string;
  /** Project / docs homepage. */
  homepage?: string;
  /** Optional capability flags declared by the plugin. */
  capabilities?: string[];
  /**
   * Optional user-configurable settings. Described as a JSON-Schema-like
   * object so the host can render a config form and pass the resolved values
   * to `search` as its second argument.
   */
  config?: Record<string, unknown>;
  /**
   * The search entry point. Called once per query inside a fresh sandbox.
   * Return an array of {@link PluginResult}; return `[]` when nothing matches.
   */
  search: (query: string, config?: Record<string, unknown>) => PluginResult[];
}

/** Register a plugin. Must be called exactly once. */
declare function definePlugin(descriptor: PluginDescriptor): void;

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/** One file inside a torrent, as reported by {@link httpGetTorrent}. */
interface PluginTorrentFile {
  path: string;
  size: number;
}

/** One file in a result's {@link PluginResult.fileList}. */
interface PluginFileEntry {
  name: string;
  size: number;
}

/** One checksum in a result's {@link PluginResult.checksums}. */
interface PluginChecksum {
  /** Algorithm name, e.g. "sha256", "md5". */
  algo: string;
  /** Hex-encoded digest. */
  value: string;
}

/** A single search hit returned from `search`. Every field except the ones
 *  you choose to populate is optional — the host tolerates partial results. */
interface PluginResult {
  /** Stable id for the hit (often the infohash or page URL). */
  id?: string;
  /** Display title. */
  title?: string;
  /** Human-readable size, e.g. "1.5 GB" (a raw number is also accepted). */
  size?: string | number;
  /** Exact size in bytes, for sorting/filtering. */
  sizeBytes?: number;
  /** BitTorrent v1 infohash (lowercase hex). */
  infohash?: string;
  /** `magnet:` URI. */
  magnet?: string;
  /** Direct `.torrent` URL when the plugin has one. */
  torrentUrl?: string;
  /** Seeders, when known. */
  seeds?: number;
  /** Leechers, when known. */
  peers?: number;
  /** Upload time as a Unix timestamp (seconds). */
  uploadDate?: number;
  /** Upload time as an ISO-8601 string. */
  uploadDateIso?: string;
  /** Whether the source vouches for the file (checksums, "verified" badge). */
  verified?: boolean;
  /** Page URL for the hit (open-in-browser fallback). */
  url?: string;
  /** Category label, e.g. "Repack", "ROM", "Games". */
  category?: string;
  /** Target platform / console, e.g. "Nintendo Switch", "PC". */
  platform?: string;
  /** Direct HTTP download URLs (non-torrent mirrors). */
  directUrls?: string[];
  /** Upstream site a meta-search hit was cached from. */
  provenance?: string;
  /** `Referer` header the downloader must send when fetching this hit. */
  referer?: string;
  /** The matched title, when the source exposes one separate from `title`. */
  matchTitle?: string;
  /** Files contained in the release, as reported by the plugin. */
  fileList?: PluginFileEntry[];
  /** Checksums the plugin computed for the release (e.g. sha256/md5). */
  checksums?: PluginChecksum[];
  /** Build / release version string. */
  version?: string;
  /** Region code, e.g. "USA", "EUR", "JPN". */
  region?: string;
  /** Cover-art URL. */
  coverUrl?: string;
  /** Long-form description. */
  description?: string;
  /** Release group / scene group. */
  releaseGroup?: string;
  /** Whether the host should recommend this hit. */
  recommended?: boolean;
}

// ---------------------------------------------------------------------------
// HTTP globals
// ---------------------------------------------------------------------------

/**
 * Blocking GET. Throws a JS error on failure (non-http(s) scheme, transport
 * error or non-2xx status). Transport errors and HTTP 5xx are retried twice.
 */
declare function httpGet(url: string, referer?: string): string;

/** `JSON.parse` of {@link httpGet}. Throws on invalid JSON. */
declare function httpGetJson<T = unknown>(url: string, referer?: string): T;

/**
 * GET + parse of an RSS 2.0 / Torznab feed into a plain object. JS cannot
 * parse XML in the sandbox, so the runtime owns the parser.
 */
declare function httpGetXml(url: string, referer?: string): XmlFeed;

/** Parallel GET of many URLs. Bodies are aligned with the input; failed
 *  fetches become empty strings. */
declare function httpGetAll(urlsOrRequests: string[], referers?: string[]): string[];

/** Options for {@link httpRequest}. */
interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Request body (GET-by-default; provide `body` to send one). */
  body?: string;
  referer?: string;
}

/** Lower-level request. Defaults to GET; returns the response body. */
declare function httpRequest(url: string, options?: HttpRequestOptions): string;

/** `JSON.parse` of {@link httpRequest}. */
declare function httpRequestJson<T = unknown>(
  url: string,
  options?: HttpRequestOptions
): T;

/** Response metadata for {@link httpHead}. */
interface HttpHeadResult {
  status: number;
  finalUrl: string;
  contentType: string | null;
  contentLength: number | null;
}

/** HEAD request (falls back to GET when the server rejects HEAD). */
declare function httpHead(url: string, referer?: string): HttpHeadResult;

/** GET a binary body and return it base64-encoded. */
declare function httpGetBytes(url: string, referer?: string): string;

/** Torrent metadata resolved from a `.torrent` URL or magnet. */
interface TorrentInfo {
  name: string;
  totalSize: number;
  infohash: string;
  files: PluginTorrentFile[];
}

/** Fetch and parse a `.torrent` (or resolve a magnet) into metadata. */
declare function httpGetTorrent(url: string, referer?: string): TorrentInfo;

// ---------------------------------------------------------------------------
// XML / HTML helpers
// ---------------------------------------------------------------------------

/** Fixed shape produced by {@link httpGetXml}. */
interface XmlFeed {
  title: string | null;
  link: string | null;
  description: string | null;
  items: XmlFeedItem[];
}

interface XmlFeedItem {
  title: string | null;
  link: string | null;
  guid: string | null;
  pubDate: string | null;
  description: string | null;
  size: string | null;
  enclosure: { url: string; length?: string; type?: string } | null;
  /** `torznab:attr` / bare `<attr>` values keyed by name. */
  attrs: Record<string, string> | null;
}

/** One element matched by {@link parseHtml}. */
interface ParsedElement {
  text: string;
  html: string;
  attrs: Record<string, string>;
}

/** Parse HTML and return the elements matching `selector` (CSS selector),
 *  up to `limit` matches. */
declare function parseHtml(
  html: string,
  selector: string,
  limit?: number
): ParsedElement[];

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Block the current search for `ms` milliseconds. */
declare function sleep(ms: number): void;
