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
      // A hidden window has nothing to draw: skip the tick so a minimized
      // app doesn't keep allocating a new history array and re-rendering.
      if (typeof document !== "undefined" && document.hidden) return;

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      // A fully idle graph has nothing new to draw: when both speeds are
      // zero and the last point already flattened to zero, skip the tick
      // entirely instead of appending copies forever (no visual change,
      // no re-render, no array churn). Sampling resumes as soon as any
      // download traffic shows up.
      setHistory((prev) => {
        const { down, up } = speedRef.current;
        if (down === 0 && up === 0) {
          const last = prev[prev.length - 1];
          if (last && last.down === 0 && last.up === 0) return prev;
        }
        const next = [
          ...prev,
          {
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
