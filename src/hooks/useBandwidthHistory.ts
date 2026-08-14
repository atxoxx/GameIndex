import { useState, useEffect, useRef } from "react";
import { useDownloads } from "../context/DownloadContext";

export interface BandwidthPoint {
  time: string;
  down: number;
  up: number;
}

export function useBandwidthHistory(maxSamples = 300): BandwidthPoint[] {
  const { activeDownloads } = useDownloads();
  const [history, setHistory] = useState<BandwidthPoint[]>([]);

  // Compute live speeds from active downloads
  const liveDown = activeDownloads.reduce((acc, d) => acc + (d.downloadSpeed || 0), 0);
  const liveUp = activeDownloads.reduce((acc, d) => acc + (d.uploadSpeed || 0), 0);

  const speedRef = useRef({ down: liveDown, up: liveUp });
  useEffect(() => {
    speedRef.current = { down: liveDown, up: liveUp };
  }, [liveDown, liveUp]);

  useEffect(() => {
    // Collect sample every 1 second
    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      setHistory((prev) => {
        const next = [
          ...prev,
          {
            time: timeStr,
            down: speedRef.current.down,
            up: speedRef.current.up,
          },
        ];
        if (next.length > maxSamples) {
          return next.slice(next.length - maxSamples);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [maxSamples]);

  return history;
}
