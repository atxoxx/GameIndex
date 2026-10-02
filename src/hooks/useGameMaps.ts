import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MapSourceResult } from "../types/game";

export interface GameMapsLookup {
  /** "loading" while providers are being resolved; "ready" otherwise. */
  status: "loading" | "ready";
  /** Every provider that has a map for this game. Empty = no Map tab. */
  sources: MapSourceResult[];
}

/**
 * Resolve the external map providers that host a map for a game. The
 * backend caches each provider's catalog, so repeated mounts are cheap.
 * A failed lookup is reported as an empty `ready` result rather than
 * thrown, so callers can simply gate the Map tab on `sources.length`.
 */
export function useGameMaps(gameName: string | undefined): GameMapsLookup {
  const [lookup, setLookup] = useState<GameMapsLookup>({
    status: "loading",
    sources: [],
  });

  const name = gameName?.trim() ?? "";

  useEffect(() => {
    if (!name) {
      setLookup({ status: "ready", sources: [] });
      return;
    }

    let cancelled = false;
    setLookup({ status: "loading", sources: [] });

    invoke<MapSourceResult[]>("fetch_game_maps", { gameName: name })
      .then((result) => {
        if (cancelled) return;
        setLookup({ status: "ready", sources: result ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLookup({ status: "ready", sources: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [name]);

  return lookup;
}
