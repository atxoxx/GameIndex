export type DownloadStep =
  | "checking"
  | "results"
  | "starting"
  | "error"
  | "fetching_metadata"
  | "file_selection";

/** Result of a debrid cache probe for the selected magnet. */
export type CacheCheckStatus =
  | "idle"
  | "checking"
  | "cached"
  | "uncached"
  | "error";

/** How the results list is ordered. */
export type SortKey =
  | "date"
  | "source"
  | "relevance"
  | "size_desc"
  | "size_asc"
  | "seeds";

/** Broad platform class filter for the results list. */
export type PlatformFilter = "all" | "pc" | "console";

/** Download method filter for the results list. */
export type DownloadTypeFilter = "all" | "torrent" | "magnet" | "direct";

import type { DownloadSearchResult } from "../../types/plugins";

/** A search match (source or plugin) plus a stable id (assigned per
 *  search) so selection survives re-sorting of the list. Plugin items
 *  extend the shape with `provider: "plugin"` + their extra fields. */
export type DisplayMatch = DownloadSearchResult & { id: string };

/** Option item for the download source selection / filter controls. */
export interface SourceFilterOption {
  id: string;
  label: string;
  count: number;
  provider?: "source" | "plugin" | "all";
}

/** Intelligently extracted scene, group, version, and edition metadata from a release title. */
export interface ParsedReleaseMeta {
  cleanTitle: string;
  group?: string;
  version?: string;
  edition?: string;
  languages?: string[];
  isMultiPart?: boolean;
  partCount?: number;
}

/** Mirror option representation for multi-hoster releases. */
export interface MirrorOption {
  index: number;
  uri: string;
  label: string;
  hostName: string;
  isMagnet: boolean;
  isTorrentFile: boolean;
  isDirect: boolean;
  needsBrowser: boolean;
}

/** Category filter for selective file download tree. */
export type FileCategoryFilter =
  | "all"
  | "executable"
  | "archive"
  | "disc"
  | "media"
  | "data";

