import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface IgdbPlatform {
  id: number;
  name: string;
}

/**
 * The full IGDB platform list, cached at module level so revisiting the
 * Store page doesn't re-hit IGDB. The list is stable, so a single fetch
 * per session is plenty; on failure we fall back to an empty list (the
 * store catalog is unusable if IGDB is unreachable anyway).
 */
let cache: Promise<IgdbPlatform[]> | null = null;

/**
 * Load the complete IGDB platform list for the Store filter sidebar.
 * Returns `[]` until the first fetch resolves.
 */
export function useIgdbPlatforms(): IgdbPlatform[] {
  const [platforms, setPlatforms] = useState<IgdbPlatform[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!cache) {
      cache = invoke<IgdbPlatform[]>("get_igdb_platforms").catch((err) => {
        console.error("Failed to load IGDB platforms", err);
        return [];
      });
    }
    cache.then((list) => {
      if (!cancelled) setPlatforms(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return platforms;
}
