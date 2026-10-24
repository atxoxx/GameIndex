import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  EMPTY_HISTORY,
  needsSnapshot,
  type ReclaimEvent,
  type ReclaimKind,
  type StorageHistory,
} from "./reclaim";

interface Options {
  /** Current footprint of everything the page tracks. */
  totalBytes: number;
  /** Current number of installed games. */
  gameCount: number;
}

/**
 * Loads the durable maintenance history and keeps the weekly footprint sample
 * up to date.
 *
 * The sample is written at most once every seven days (`needsSnapshot`), and
 * only once the page knows a real footprint — a first launch with an unmeasured
 * library must not record a zero.
 */
export function useStorageHistory({ totalBytes, gameCount }: Options) {
  const [history, setHistory] = useState<StorageHistory>(EMPTY_HISTORY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotting = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<StorageHistory>("storage_history_load");
      setHistory(next ?? EMPTY_HISTORY);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ready || snapshotting.current) return;
    if (totalBytes <= 0 || gameCount <= 0) return;
    if (!needsSnapshot(history)) return;

    snapshotting.current = true;
    invoke<StorageHistory>("storage_history_snapshot", {
      snapshot: {
        at: new Date().toISOString(),
        bytes: totalBytes,
        games: gameCount,
      },
    })
      .then((next) => setHistory(next ?? EMPTY_HISTORY))
      .catch((err) => setError(String(err)))
      .finally(() => {
        snapshotting.current = false;
      });
  }, [ready, history, totalBytes, gameCount]);

  const record = useCallback(
    async (input: {
      kind: ReclaimKind;
      bytes: number;
      count?: number;
      label?: string | null;
    }) => {
      const event: ReclaimEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        kind: input.kind,
        bytes: Math.max(0, Math.round(input.bytes)),
        count: Math.max(1, input.count ?? 1),
        label: input.label ?? null,
      };
      try {
        const next = await invoke<StorageHistory>("storage_history_record", { event });
        setHistory(next ?? EMPTY_HISTORY);
      } catch (err) {
        // History is an insight, not a source of truth — a failed write must
        // never break the removal the user actually asked for.
        setError(String(err));
      }
    },
    [],
  );

  const clear = useCallback(async () => {
    try {
      const next = await invoke<StorageHistory>("storage_history_clear");
      setHistory(next ?? EMPTY_HISTORY);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  return { history, ready, error, record, clear, refresh };
}
