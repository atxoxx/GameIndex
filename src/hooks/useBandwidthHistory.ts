import { useEffect, useSyncExternalStore } from "react";
import {
  getBandwidthSamples,
  startBandwidthSampling,
  subscribeBandwidthSamples,
  type BandwidthPoint,
} from "../utils/bandwidthHistoryStore";

export type { BandwidthPoint } from "../utils/bandwidthHistoryStore";

/**
 * Subscribe to the shared bandwidth window. Sampling is owned by
 * `BandwidthRecorder` (mounted once under the downloads provider) so the
 * series survives page changes and reloads instead of restarting on mount.
 */
export function useBandwidthHistory(maxSamples = 300): BandwidthPoint[] {
  useEffect(() => {
    startBandwidthSampling();
  }, []);
  const samples = useSyncExternalStore(
    subscribeBandwidthSamples,
    getBandwidthSamples,
    getBandwidthSamples,
  );
  return maxSamples < samples.length ? samples.slice(samples.length - maxSamples) : samples;
}
