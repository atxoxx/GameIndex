// Per-game mod management state. Wraps the `mods_*` backend commands
// with optimistic updates so toggling/reordering feels instant while
// the plugins.txt / rename write-back happens behind the scenes.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Game } from "../types/game";
import type { GameMod, GameModsPayload, ModConflict } from "../types/mods";

export function useGameMods(game: Game | null) {
  const [payload, setPayload] = useState<GameModsPayload | null>(null);
  const [conflicts, setConflicts] = useState<ModConflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState({ phase: "", filesExamined: 0, modsFound: 0, complete: false });
  const gameIdRef = useRef<string | null>(null);
  gameIdRef.current = game?.id ?? null;

  const refreshConflicts = useCallback(async (gameId: string) => {
    try {
      const list = await invoke<ModConflict[]>("mods_conflicts", { gameId });
      if (gameIdRef.current === gameId) setConflicts(list);
    } catch {
      // Conflict detection is best-effort decoration; never surface
      // a scan-blocking error for it.
    }
  }, []);

  // Load cached rows on mount / game switch, then kick a background
  // scan so the list reflects the current on-disk state.
  useEffect(() => {
    if (!game) {
      setPayload(null);
      setConflicts([]);
      return;
    }
    const gameId = game.id;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<{ gameId: string; phase: string; filesExamined: number; modsFound: number; complete: boolean }>("mods-scan-progress", (event) => {
      if (event.payload.gameId === gameId && !cancelled) setScanProgress(event.payload);
    }).then((dispose) => { unlisten = dispose; });
    setLoading(true);
    setError(null);
    setConflicts([]);
    invoke<GameModsPayload>("mods_list", { gameId })
      .then((p) => {
        if (!cancelled) {
          setPayload(p);
          // Refresh conflict detection right after the initial load so
          // the Conflicts tab/stat/badges aren't empty until the user
          // happens to rescan. Best-effort, swallowed on failure.
          void refreshConflicts(gameId);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = useCallback(async () => {
    if (!game?.path) return;
    const gameId = game.id;
    setScanning(true);
    setError(null);
    try {
      const p = await invoke<GameModsPayload>("mods_scan_game", {
        gameId,
        gamePath: game.path,
        steamAppId: game.steamAppId ?? null,
      });
      if (gameIdRef.current === gameId) {
        setPayload(p);
        void refreshConflicts(gameId);
      }
      return p;
    } catch (e) {
      if (gameIdRef.current === gameId) setError(String(e));
      throw e;
    } finally {
      if (gameIdRef.current === gameId) setScanning(false);
    }
  }, [game?.id, game?.path, game?.steamAppId, refreshConflicts]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEnabled = useCallback(async (modId: string, enabled: boolean) => {
    // Optimistic flip; reconcile with the authoritative row after.
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            mods: prev.mods.map((m) => (m.id === modId ? { ...m, enabled } : m)),
          }
        : prev
    );
    try {
      const updated = await invoke<GameMod>("mods_set_enabled", { modId, enabled });
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              mods: prev.mods.map((m) => (m.id === modId ? updated : m)),
            }
          : prev
      );
      // A disabled mod no longer overwrites files, so its conflicts may
      // have changed — re-check best-effort after a successful toggle.
      const gameId = gameIdRef.current;
      if (gameId) void refreshConflicts(gameId);
    } catch (e) {
      // Roll back on failure.
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              mods: prev.mods.map((m) =>
                m.id === modId ? { ...m, enabled: !enabled } : m
              ),
            }
          : prev
      );
      throw e;
    }
  }, [refreshConflicts]);

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      if (!game) return;
      const gameId = game.id;
      // Optimistic re-sort.
      setPayload((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.mods.map((m) => [m.id, m]));
        const mods = orderedIds
          .map((id, i) => {
            const m = byId.get(id);
            return m ? { ...m, loadOrder: i } : null;
          })
          .filter((m): m is GameMod => m !== null);
        return { ...prev, mods };
      });
      const p = await invoke<GameModsPayload>("mods_reorder", {
        gameId,
        orderedIds,
      });
      if (gameIdRef.current === gameId) setPayload(p);
    },
    [game?.id] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const remove = useCallback(async (modId: string) => {
    await invoke("mods_delete", { modId });
    setPayload((prev) =>
      prev
        ? { ...prev, mods: prev.mods.filter((m) => m.id !== modId) }
        : prev
    );
    setConflicts((prev) =>
      prev
        .map((c) => ({ ...c, modIds: c.modIds.filter((id) => id !== modId) }))
        .filter((c) => c.modIds.length > 1)
    );
  }, []);

  const checkUpdates = useCallback(async () => {
    if (!game) return;
    const gameId = game.id;
    setCheckingUpdates(true);
    try {
      const p = await invoke<GameModsPayload>("nexus_check_updates", { gameId });
      if (gameIdRef.current === gameId) setPayload(p);
      return p;
    } finally {
      if (gameIdRef.current === gameId) setCheckingUpdates(false);
    }
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCustomRoot = useCallback(
    async (path: string | null) => {
      if (!game) return;
      await invoke("mods_set_custom_root", { gameId: game.id, path });
    },
    [game?.id] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const setNexusDomain = useCallback(
    async (domain: string) => {
      if (!game) return;
      await invoke("mods_set_nexus_domain", {
        gameId: game.id,
        domain: domain.trim() || null,
      });
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              settings: prev.settings
                ? { ...prev.settings, nexusDomain: domain.trim() || undefined }
                : {
                    gameId: game.id,
                    nexusDomain: domain.trim() || undefined,
                    updatedAt: Date.now() / 1000,
                  },
            }
          : prev
      );
    },
    [game?.id] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const undoLast = useCallback(async () => {
    await invoke("mods_undo_last");
    if (game?.id) {
      const p = await invoke<GameModsPayload>("mods_list", { gameId: game.id });
      setPayload(p);
      void refreshConflicts(game.id);
    }
  }, [game?.id, refreshConflicts]);

  const cancelScan = useCallback(async () => {
    if (game?.id) await invoke("mods_cancel_scan", { gameId: game.id });
  }, [game?.id]);

  return {
    payload,
    conflicts,
    loading,
    scanning,
    checkingUpdates,
    error,
    scanProgress,
    scan,
    cancelScan,
    undoLast,
    setEnabled,
    reorder,
    remove,
    checkUpdates,
    setCustomRoot,
    setNexusDomain,
    refreshConflicts,
  };
}
