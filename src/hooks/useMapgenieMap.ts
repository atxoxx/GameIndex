import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MapgenieGame } from "../types/game";

export interface MapgenieLookup {
  /** "loading" while the catalog round-trip is in flight; "found" when
   *  MapGenie has a confident match; "missing" when it does not (or the
   *  call failed — the game pages treat both as "hide the Map tab"). */
  status: "loading" | "found" | "missing";
  data: MapgenieGame | null;
}

/**
 * Resolve a game name to its MapGenie maps. The backend caches the
 * catalog, so repeated mounts are cheap. A failed or empty lookup is
 * reported as `missing` rather than thrown so callers can simply gate
 * the Map tab on `status === "found"`.
 */
export function useMapgenieMap(gameName: string | undefined): MapgenieLookup {
  const [lookup, setLookup] = useState<MapgenieLookup>({
    status: "loading",
    data: null,
  });

  const name = gameName?.trim() ?? "";

  useEffect(() => {
    if (!name) {
      setLookup({ status: "missing", data: null });
      return;
    }

    let cancelled = false;
    setLookup({ status: "loading", data: null });

    invoke<MapgenieGame | null>("fetch_mapgenie_map", { gameName: name })
      .then((result) => {
        if (cancelled) return;
        setLookup(
          result
            ? { status: "found", data: result }
            : { status: "missing", data: null },
        );
      })
      .catch(() => {
        if (!cancelled) setLookup({ status: "missing", data: null });
      });

    return () => {
      cancelled = true;
    };
  }, [name]);

  return lookup;
}
