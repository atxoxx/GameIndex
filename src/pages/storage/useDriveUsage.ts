import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import { driveOf } from "./utils";
import { publishMounts, type MountUsage } from "./mounts";

/** A single drive's capacity + availability, keyed by the same drive
 *  label the breakdown card uses (`C:`, `/run/media/u/disk`, …). */
export interface DriveUsage {
  total: number;
  free: number;
  available: number;
}

/** Per-drive capacity for the "By drive" breakdown card.
 *
 *  Strategy:
 *    1. Collect every distinct `sizeRootPath` from the games.
 *    2. Resolve them in one `resolve_mounts` call, which reports the real
 *       mount point and its capacity — so two disks under the same
 *       parent (`/run/media/seth/diskA` / `diskB`) stay distinct.
 *    3. Publish the mount table so `driveOf()` labels match the usage
 *       keys exactly, then key usage by mount point.
 *
 *  Failures are isolated: when the command fails the map is left empty
 *  and the card still shows game bytes. */
export function useDriveUsage(games: Game[]): Map<string, DriveUsage> {
  const [usage, setUsage] = useState<Map<string, DriveUsage>>(
    () => new Map()
  );

  // Distinct sample paths to resolve — one per measured game root.
  const targets = useMemo(() => {
    const seen = new Set<string>();
    for (const g of games) {
      const path = g.sizeRootPath;
      if (path) seen.add(path);
    }
    return Array.from(seen);
  }, [games]);

  useEffect(() => {
    if (targets.length === 0) {
      publishMounts([]);
      setUsage(new Map());
      return;
    }
    let cancelled = false;
    invoke<MountUsage[]>("resolve_mounts", { paths: targets })
      .then((rows) => {
        if (cancelled) return;
        publishMounts(rows);
        const next = new Map<string, DriveUsage>();
        for (const row of rows) {
          const label = row.mountPoint || driveOf(row.path);
          if (next.has(label)) continue;
          next.set(label, {
            total: row.total,
            free: row.free,
            available: row.available,
          });
        }
        setUsage(next);
      })
      .catch(() => {
        if (!cancelled) setUsage(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [targets]);

  return usage;
}
