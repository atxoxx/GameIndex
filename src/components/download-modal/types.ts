export type DownloadStep =
  | "checking"
  | "results"
  | "starting"
  | "error"
  | "fetching_metadata"
  | "file_selection";

/** How the results list is ordered. */
export type SortKey = "date" | "source" | "relevance";

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
