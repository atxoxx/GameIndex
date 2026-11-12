/**
 * Data shapes for the plugin runtime.
 *
 * These mirror the renderer contract in `src/types/plugins.ts` (which in turn
 * mirrors the retired Rust DTOs in `src-tauri/src/plugins/mod.rs`). The
 * renderer is the source of truth for field names: every object returned from
 * a `plugins_*` command must carry exactly these camelCase keys.
 */
import type { PluginManifest } from "./manifest";

/** One result row from a plugin's `search()`; every field is optional. */
export interface PluginRawResult {
  id: string;
  title: string;
  size: string;
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
  platform?: string;
  directUrls?: string[];
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
  recommended?: boolean;
}

/** A validated plugin file that has not been installed yet. */
export interface PluginCandidate {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  sourceUrl: string;
  /** sha256 of the file contents, re-verified at install time. */
  fileHash: string;
  filePath: string;
  manifest: PluginManifest;
}

/** An installed plugin plus its runtime state. */
export interface PluginInfo extends PluginCandidate {
  enabled: boolean;
  /** Unix seconds. */
  importedAt: number;
  /** Last load/search error, or null. Cleared by a successful search. */
  lastError: string | null;
  platformCategory: string;
}

/** Result of `plugins_set_all_enabled`. */
export interface PluginBulkToggleResult {
  changed: number;
  failed: string[];
}

/** One plugin's answer to `plugins_check_availability`. */
export interface PluginAvailabilityHit {
  pluginId: string;
  name: string;
  platformCategory: string;
  matches: number;
  error: string | null;
}

/**
 * A plugin hit converted into the merged download-search shape
 * (`DownloadSearchResult` in `src/types/plugins.ts`). Exposed for the sources
 * workstream so its `SourceContext` search can append plugin rows without
 * importing the runtime internals.
 */
export interface PluginDownloadResult {
  id: string;
  sourceName: string;
  sourceId: string;
  title: string;
  fileSize: string;
  uris: string[];
  magnet: string | null;
  uploadDate: string | null;
  matchScore: number;
  isNew: boolean;
  provider: "plugin";
  pluginId: string;
  infohash: string | null;
  seeds: number | null;
  peers: number | null;
  torrentUrl: string | null;
  verified: boolean | null;
  detailUrl: string | null;
  platform: string | null;
  provenance: string | null;
  referer: string | null;
  platformCategory: string;
  matchTitle: string | null;
  fileList: { name: string; size: number }[] | null;
  checksums: { algo: string; value: string }[] | null;
  version: string | null;
  region: string | null;
  coverUrl: string | null;
  description: string | null;
  releaseGroup: string | null;
  recommended: boolean | null;
}

/** Persisted record in `plugins.json` (one per installed plugin). */
export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  sourceUrl: string;
  platformCategory: string;
  fileHash: string;
  enabled: boolean;
  importedAt: number;
  lastError: string | null;
  manifest: PluginManifest;
}

/** Shape of `userData/plugins.json`. */
export interface PluginDocument {
  version: 1;
  plugins: PluginRecord[];
  updatedAt?: string;
}

/** A source descriptor accepted by `searchWithPlugins`. */
export interface PluginSearchSource {
  /** Id of the installed plugin that backs this source. */
  pluginId?: string;
  /** Fallback id, for a `SourceLink`-shaped row. */
  id?: string;
  /** `plugin:<id>` links (plugin-backed entries in `sources_list`). */
  url?: string;
  /** Display name override; defaults to the manifest name. */
  name?: string;
  platformCategory?: string;
}

export interface PluginSearchOptions {
  /** Alternative titles used to score matches (IGDB/local aliases). */
  aliases?: string[];
  /** Game release year, used for the year adjustment. */
  releaseYear?: number | null;
  /** Minimum similarity score a hit must reach (default 0.2). */
  matchFloor?: number;
}
