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
 * One user-configurable field declared by a plugin's manifest
 * (`manifest.config`). Mirrors the Rust `PluginConfigField`. `secret`
 * values are stored in the OS keychain and are never read back to the
 * UI — only whether a value is stored (`plugins_config_status`).
 */
export interface PluginConfigField {
  /** Stable machine key used to store/read the value. */
  key: string;
  /** Human-readable label shown above the input. */
  label: string;
  /** True when the value is a secret and must go to the keychain. */
  secret?: boolean;
  /** True when the field must be filled before the plugin can run. */
  required?: boolean;
  /** Optional input placeholder text. */
  placeholder?: string;
  /** Optional helper text rendered under the input. */
  description?: string;
}

/**
 * A plugin's parsed descriptor, evaluated from its `definePlugin(...)`
 * call. Unknown keys are preserved so newer manifests don't break older
 * clients.
 */
export interface PluginManifest {
  /** User-configurable settings declared by the plugin. */
  config?: PluginConfigField[];
  /** Optional icon URL / data URI shown in the plugins UI. */
  icon?: string;
  /** Optional project homepage shown in the plugins UI. */
  homepage?: string;
  /** Free-form capability tags a plugin advertises (e.g. "search"). */
  capabilities?: string[];
  /** Host allowlist; empty means the plugin may reach any host. */
  allowedHosts?: string[];
  /** Minimum spacing between requests to the same host (ms). */
  rateLimitMs?: number;
  /** How long this plugin's raw results stay cached (seconds). */
  cacheTtlSecs?: number;
  [k: string]: unknown;
}

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
  /** The evaluated manifest, so the UI can render metadata + config. */
  manifest?: PluginManifest;
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

/** Result of `plugins_set_all_enabled`: how many plugins changed state
 *  plus the ids (with reasons) that failed to load when enabling. */
export interface PluginBulkToggleResult {
  changed: number;
  failed: string[];
}

/**
 * One raw torrent result returned by a plugin's `search()` — the payload
 * of `plugins_test_search`. Mirrors the Rust `PluginRawResult`; every
 * field is optional because plugins are third-party and tolerant
 * deserialization is the contract. `size` may be a human-readable string
 * ("1.5 GB") or a raw number string.
 */
export interface PluginRawResult {
  id?: string;
  title?: string;
  size?: string;
  sizeBytes?: number;
  infohash?: string;
  magnet?: string;
  torrentUrl?: string;
  seeds?: number;
  peers?: number;
  uploadDate?: number;
  uploadDateIso?: string;
  verified?: boolean;
  url?: string;
  category?: string;
  /** Platform / console the release targets (e.g. "Nintendo Switch"). */
  platform?: string;
  directUrls?: string[];
  /** Upstream site a meta-search hit was cached from. */
  provenance?: string;
  referer?: string;
  matchTitle?: string;
  fileList?: { name: string; size: number }[];
  checksums?: { algo: string; value: string }[];
  version?: string;
  region?: string;
  coverUrl?: string;
  description?: string;
  releaseGroup?: string;
  /** Plugin's own recommendation flag. */
  recommended?: boolean;
}

/**
 * One combined search hit from `search_downloads`: either a classic
 * source match (as today) or a plugin-provided result. The backend
 * returns source items first (score-sorted) followed by plugin items
 * pre-sorted newest-first. That is the default order; the download
 * modal re-sorts both blocks — plugins keep their trailing position —
 * when the user picks an explicit sort.
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
  /** Clean, human-readable release name a plugin supplies when the raw
   *  `title` is a scene/technical filename. Display-only: `title` is
   *  still used for copy actions and library matching. */
  matchTitle?: string;
  /** Files contained in the release, as reported by the plugin. */
  fileList?: { name: string; size: number }[];
  /** Checksums the plugin computed for the release (e.g. sha256/md5). */
  checksums?: { algo: string; value: string }[];
  /** Explicit release version, preferred over heuristics from `title`. */
  version?: string;
  /** Target region / language release (e.g. "EUR", "USA", "JP"). */
  region?: string;
  /** Cover art URL shown in the detail inspector spotlight. */
  coverUrl?: string;
  /** Free-form release description supplied by the plugin. */
  description?: string;
  /** Scene / repack group that produced the release. */
  releaseGroup?: string;
  /** True when the plugin recommends this result. */
  recommended?: boolean;
}

export interface SearchProgressEvent {
  searchId: string;
  sourceName: string;
  completedSources: number;
  totalSources: number;
  newResults: DownloadSearchResult[];
  isDone: boolean;
}

