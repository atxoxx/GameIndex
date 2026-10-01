import { useMemo } from "react";
import { useDownloads } from "../../context/DownloadContext";
import {
  computeSourceReliability,
  getSourceReliability,
  type SourceReliability,
} from "./reliability";

export interface SourceReliabilityIndex {
  bySource: Map<string, SourceReliability>;
  get: (sourceName: string) => SourceReliability | undefined;
}

/**
 * Derive per-source reliability from the persistent download ledger.
 * Recomputes only when the history array identity changes.
 */
export function useSourceReliability(): SourceReliabilityIndex {
  const { history } = useDownloads();
  const bySource = useMemo(
    () => computeSourceReliability(history ?? []),
    [history],
  );
  return useMemo(
    () => ({
      bySource,
      get: (sourceName: string) => getSourceReliability(bySource, sourceName),
    }),
    [bySource],
  );
}
