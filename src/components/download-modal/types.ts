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
export type SortKey = "date" | "source" | "relevance";

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
