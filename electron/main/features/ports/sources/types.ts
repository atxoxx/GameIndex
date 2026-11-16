import type { PortSourceId, PortSourceProject } from "../../../../../src/types/port";

export interface SourceProgress {
  /** Entries fetched so far. */
  done: number;
  /** Expected entries, 0 while unknown. */
  total: number;
}

export interface SourceFetchOptions {
  onProgress?: (progress: SourceProgress) => void;
}

/** One site adapter. It fetches and normalizes; merging happens elsewhere. */
export interface PortSourceAdapter {
  id: PortSourceId;
  fetchProjects(options?: SourceFetchOptions): Promise<PortSourceProject[]>;
}
