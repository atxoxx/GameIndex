import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CrackWatchStatus } from "../types/game";

/**
 * CrackWatchContext batches per-card CrackWatch lookups into a single
 * backend round-trip.
 *
 * Uses fine-grained per-game subscriptions with React 19 `useSyncExternalStore`.
 * When a batch for [gameA, gameB] completes, ONLY cards for gameA or gameB
 * re-render; other cards are completely untouched.
 */
interface CrackWatchContextValue {
  /** Register a name for lookup; returns the resolved status (or null). */
  request: (name: string) => void;
  /** Read the resolved status for a name (undefined = not yet resolved). */
  get: (name: string) => CrackWatchStatus | null | undefined;
  /** Subscribe a callback to updates for a specific game name. */
  subscribe: (name: string, onStoreChange: () => void) => () => void;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalCrackWatchObj = globalThis as unknown as {
  __gamelib_crackwatch_context__?: React.Context<CrackWatchContextValue | null>;
};
const CrackWatchContext =
  globalCrackWatchObj.__gamelib_crackwatch_context__ ??
  (globalCrackWatchObj.__gamelib_crackwatch_context__ = createContext<CrackWatchContextValue | null>(null));

/** Coalesce window: registrations within this window share one batch call. */
const BATCH_DEBOUNCE_MS = 120;

export function CrackWatchProvider({ children }: { children: ReactNode }) {
  // Resolved cache: name -> status | null (null = looked up, no data).
  const cacheRef = useRef<Map<string, CrackWatchStatus | null>>(new Map());
  // Names awaiting the next batch flush.
  const pendingRef = useRef<Set<string>>(new Set());
  // Names currently in flight (avoid re-requesting mid-batch).
  const inflightRef = useRef<Set<string>>(new Set());
  // Per-name listener callbacks for fine-grained re-renders.
  const listenersRef = useRef<Map<string, Set<() => void>>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((name: string) => {
    const set = listenersRef.current.get(name);
    if (set) {
      set.forEach((cb) => cb());
    }
  }, []);

  const flush = useCallback(() => {
    timerRef.current = null;
    const names = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (names.length === 0) return;
    names.forEach((n) => inflightRef.current.add(n));

    invoke<Record<string, CrackWatchStatus>>("fetch_crackwatch_status_batch", {
      gameNames: names,
    })
      .then((result) => {
        for (const name of names) {
          cacheRef.current.set(name, result[name] ?? null);
          inflightRef.current.delete(name);
          notify(name);
        }
      })
      .catch(() => {
        // On failure, mark as resolved-null so we don't hammer the endpoint.
        for (const name of names) {
          if (!cacheRef.current.has(name)) cacheRef.current.set(name, null);
          inflightRef.current.delete(name);
          notify(name);
        }
      });
  }, [notify]);

  const request = useCallback(
    (name: string) => {
      if (!name) return;
      if (cacheRef.current.has(name)) return;
      if (inflightRef.current.has(name)) return;
      if (pendingRef.current.has(name)) return;
      pendingRef.current.add(name);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, BATCH_DEBOUNCE_MS);
    },
    [flush]
  );

  const get = useCallback(
    (name: string) => cacheRef.current.get(name),
    []
  );

  const subscribe = useCallback((name: string, onStoreChange: () => void) => {
    let set = listenersRef.current.get(name);
    if (!set) {
      set = new Set();
      listenersRef.current.set(name, set);
    }
    set.add(onStoreChange);
    return () => {
      set?.delete(onStoreChange);
      if (set?.size === 0) {
        listenersRef.current.delete(name);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const value = useMemo<CrackWatchContextValue>(
    () => ({ request, get, subscribe }),
    [request, get, subscribe]
  );

  return (
    <CrackWatchContext.Provider value={value}>
      {children}
    </CrackWatchContext.Provider>
  );
}

/**
 * useCrackWatch: subscribe a single card to the batched CrackWatch lookup.
 * Returns the resolved status (or null when there's no data). Safe to call
 * without a provider — it simply returns null and does nothing.
 */
export function useCrackWatch(name: string): CrackWatchStatus | null {
  const ctx = useContext(CrackWatchContext);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!ctx || !name) return () => {};
      return ctx.subscribe(name, onStoreChange);
    },
    [ctx, name]
  );

  const getSnapshot = useCallback(() => {
    if (!ctx || !name) return null;
    return ctx.get(name) ?? null;
  }, [ctx, name]);

  useEffect(() => {
    if (ctx && name) {
      ctx.request(name);
    }
  }, [name, ctx]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export { CrackWatchContext };

