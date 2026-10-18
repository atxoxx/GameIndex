import { useEffect } from "react";
import { useDownloads } from "../../context/DownloadContext";
import {
  setBandwidthSpeeds,
  startBandwidthSampling,
} from "../../utils/bandwidthHistoryStore";

/**
 * Headless bridge that keeps the shared bandwidth window fed while the
 * user is anywhere in the app, not just on the Downloads page.
 */
export default function BandwidthRecorder() {
  const { activeDownloads } = useDownloads();
  const down = activeDownloads.reduce((acc, d) => acc + (d.downloadSpeed || 0), 0);
  const up = activeDownloads.reduce((acc, d) => acc + (d.uploadSpeed || 0), 0);

  useEffect(() => {
    setBandwidthSpeeds(down, up);
  }, [down, up]);

  useEffect(() => {
    startBandwidthSampling();
  }, []);

  return null;
}
