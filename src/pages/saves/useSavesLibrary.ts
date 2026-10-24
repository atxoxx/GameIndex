import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SaveBackup, SaveLocation, SaveLocationHealth } from "../../types/saves";

interface SavesLibraryState {
  locations: SaveLocation[] | null;
  backups: SaveBackup[] | null;
  health: SaveLocationHealth[];
}

/**
 * Loads the three library-wide lists the Saves hub joins together.
 *
 * Health probing is separate from the lists on the backend, so it is allowed
 * to fail on its own: a stale shell without `saves_location_health` must still
 * render the roster instead of blanking the page.
 */
export function useSavesLibrary(enabled: boolean) {
  const [state, setState] = useState<SavesLibraryState>({
    locations: null,
    backups: null,
    health: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const [locations, backups, health] = await Promise.all([
        invoke<SaveLocation[]>("saves_list_all_locations"),
        invoke<SaveBackup[]>("saves_list_backups", { gameId: null }),
        invoke<SaveLocationHealth[]>("saves_location_health", { gameId: null }).catch(
          () => [] as SaveLocationHealth[],
        ),
      ]);
      if (!mountedRef.current) return;
      setState({ locations, backups, health });
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setState({ locations: [], backups: [], health: [] });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  /** Re-probe paths without touching the snapshot list. */
  const refreshHealth = useCallback(async () => {
    try {
      const health = await invoke<SaveLocationHealth[]>("saves_location_health", {
        gameId: null,
      });
      if (mountedRef.current) setState((prev) => ({ ...prev, health }));
    } catch {
      /* health is advisory — keep the last known values */
    }
  }, []);

  return {
    locations: state.locations,
    backups: state.backups,
    health: state.health,
    loading: state.locations === null || state.backups === null,
    refreshing,
    error,
    reload,
    refreshHealth,
  };
}
