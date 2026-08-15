// TypeScript mirrors of the Rust plugin DTOs (src-tauri plugin manager).
// Field names are camelCase because the backend uses
// `#[serde(rename_all = "camelCase")]` on these structs.
//
// A "plugin" is a user-supplied `.js` file that extends GameIndex's
// download search: it runs locally, receives a search query, and returns
// candidate downloads. Because plugins are third-party code with network
// access, the Settings → Plugins tab treats every import as a trust gate.

import type { MatchedDownload } from "./source";

/**
 * The validated metadata of a `.js` plugin file, returned by
 * `plugins_import_file`. Nothing is written to disk or executed until
 * the user confirms the trust gate and `plugins_install` runs.
 */
export interface PluginCandidate {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  sourceUrl: string;
  /** sha256 of the file contents, shown to the user to verify the file. */
  fileHash: string;
  filePath: string;
}

/** An installed plugin. Adds the runtime state the manager keeps per plugin. */
export interface PluginInfo extends PluginCandidate {
  enabled: boolean;
  /** Unix seconds when the plugin was installed. */
  importedAt: number;
  /** Non-null when the plugin failed at runtime (load/search error). */
  lastError: string | null;
  /**
   * Broad platform class the plugin searches: "pc", "console", or
   * "hybrid" (both). Declared by the plugin manifest and used by the
   * download modal's platform filter.
   */
  platformCategory?: string;
}

/**
 * One combined search hit from `search_downloads`: either a classic
 * source match (as today) or a plugin-provided result. The backend
 * returns source items first (score-sorted) followed by plugin items
 * pre-sorted newest-first — the frontend must not shuffle plugin items
 * when sorting or rendering.
 */
export interface DownloadSearchResult extends MatchedDownload {
  /** "source" = enabled source cache match, "plugin" = plugin result. */
  provider: "source" | "plugin";
  /** Set when `provider === "plugin"` — the plugin that produced this hit. */
  pluginId?: string;
  infohash?: string;
  seeds?: number;
  peers?: number;
  /** Direct link to a `.torrent` file, when the plugin provides one. */
  torrentUrl?: string;
  /** True when the plugin attests the result was checked/verified. */
  verified?: boolean;
  /** Optional page where the plugin found this result. */
  detailUrl?: string;
  /**
   * Platform / console the game targets (e.g. "Nintendo Switch",
   * "NES", "PlayStation 2"). Populated by ROM / repack plugins so the
   * download modal can show which system a hit belongs to.
   */
  platform?: string;
  /**
   * Upstream site a meta-search hit was cached from (e.g.
   * "RuTracker.org" for a knaben hit). Set when the plugin reports
   * where the torrent originally came from; absent otherwise.
   */
  provenance?: string;
  /**
   * Optional `Referer` header the downloader sends when fetching the
   * `.torrent` URL (anti-hotlink hosts reject the request without it).
   */
  referer?: string;
  /**
   * Broad platform class of the hit: "pc" | "console" | "hybrid".
   * Built-in sources are "pc"; plugin hits inherit their plugin's
   * declared category.
   */
  platformCategory?: string;
}

export interface SearchProgressEvent {
  searchId: string;
  sourceName: string;
  completedSources: number;
  totalSources: number;
  newResults: DownloadSearchResult[];
  isDone: boolean;
}

