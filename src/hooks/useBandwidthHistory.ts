import { useState, useEffect, useRef } from "react";
import { useDownloads } from "../context/DownloadContext";

export interface BandwidthPoint {
  /** Epoch milliseconds — lets the graph honor the real time window instead of
   *  assuming every retained sample is exactly one second apart. */
  ts: number;
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
      // A hidden window has nothing to draw: skip the tick so a minimized
      // app doesn't keep allocating a new history array and re-rendering.
      if (typeof document !== "undefined" && document.hidden) return;

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      // Sample every second even while idle: the chart's time window is a
      // promise, and sparse idle gaps would otherwise stretch old samples
      // across a window that no longer matches the clock.
      setHistory((prev) => {
        const { down, up } = speedRef.current;
        const next = [
          ...prev,
          {
            ts: now.getTime(),
            time: timeStr,
            down,
            up,
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
