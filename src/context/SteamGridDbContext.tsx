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
import type { SgdbAssets } from "../types/steamgriddb";

/**
 * SteamGridDbContext batches per-card SteamGridDB artwork lookups into a
 * single backend round-trip.
 *
 * Rather than a global context version bump (which would force all cards
 * on screen to re-render whenever any batch completes), this provider uses
 * fine-grained per-AppID subscriptions with React 19 `useSyncExternalStore`.
 * When a batch for AppIDs [A, B] completes, ONLY cards subscribing to A or B
 * re-render; other cards are completely untouched.
 */
interface SteamGridDbContextValue {
  /** Register an AppID for lookup; schedules a batched fetch if uncached. */
  request: (appId: number) => void;
  /** Read the resolved artwork for an AppID (undefined = not yet resolved). */
  get: (appId: number) => SgdbAssets | null | undefined;
  /** Subscribe a callback to updates for a specific AppID. */
  subscribe: (appId: number, onStoreChange: () => void) => () => void;
}

// Persist the React context instance across Vite HMR module re-evaluations
// so lazy-loaded page chunks never lose their Provider instance (same trick
// as CrackWatchContext).
const globalSteamGridDbObj = globalThis as unknown as {
  __gamelib_steamgriddb_context__?: React.Context<SteamGridDbContextValue | null>;
};
const SteamGridDbContext =
  globalSteamGridDbObj.__gamelib_steamgriddb_context__ ??
  (globalSteamGridDbObj.__gamelib_steamgriddb_context__ =
    createContext<SteamGridDbContextValue | null>(null));

/** Coalesce window: registrations within this window share one batch call. */
const BATCH_DEBOUNCE_MS = 150;

export function SteamGridDbProvider({ children }: { children: ReactNode }) {
  // Resolved cache: AppID -> assets | null (null = looked up, no art).
  const cacheRef = useRef<Map<number, SgdbAssets | null>>(new Map());
  // AppIDs awaiting the next batch flush.
  const pendingRef = useRef<Set<number>>(new Set());
  // AppIDs currently in flight (avoid re-requesting mid-batch).
  const inflightRef = useRef<Set<number>>(new Set());
  // Per-AppID listener callbacks for surgical, fine-grained re-renders.
  const listenersRef = useRef<Map<number, Set<() => void>>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((appId: number) => {
    const set = listenersRef.current.get(appId);
    if (set) {
      set.forEach((cb) => cb());
    }
  }, []);

  const flush = useCallback(() => {
    timerRef.current = null;
    const appIds = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (appIds.length === 0) return;
    appIds.forEach((id) => inflightRef.current.add(id));

    invoke<Record<string, SgdbAssets>>("sgdb_get_assets_batch", {
      steamAppIds: appIds,
    })
      .then((result) => {
        for (const id of appIds) {
          cacheRef.current.set(id, result[String(id)] ?? null);
          inflightRef.current.delete(id);
          notify(id);
        }
      })
      .catch(() => {
        // On failure, mark as resolved-null so we don't re-request on every
        // render (the backend caches negatives too, so this is cheap).
        for (const id of appIds) {
          if (!cacheRef.current.has(id)) cacheRef.current.set(id, null);
          inflightRef.current.delete(id);
          notify(id);
        }
      });
  }, [notify]);

  const request = useCallback(
    (appId: number) => {
      if (!appId || appId <= 0) return;
      if (cacheRef.current.has(appId)) return;
      if (inflightRef.current.has(appId)) return;
      if (pendingRef.current.has(appId)) return;
      pendingRef.current.add(appId);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, BATCH_DEBOUNCE_MS);
    },
    [flush]
  );

  const get = useCallback((appId: number) => cacheRef.current.get(appId), []);

  const subscribe = useCallback((appId: number, onStoreChange: () => void) => {
    let set = listenersRef.current.get(appId);
    if (!set) {
      set = new Set();
      listenersRef.current.set(appId, set);
    }
    set.add(onStoreChange);
    return () => {
      set?.delete(onStoreChange);
      if (set?.size === 0) {
        listenersRef.current.delete(appId);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const value = useMemo<SteamGridDbContextValue>(
    () => ({ request, get, subscribe }),
    [request, get, subscribe]
  );

  return (
    <SteamGridDbContext.Provider value={value}>
      {children}
    </SteamGridDbContext.Provider>
  );
}

/**
 * useSteamGridArt: subscribe a single surface (library card, store card,
 * hero) to the batched SteamGridDB lookup for a Steam AppID.
 *
 * Uses useSyncExternalStore with per-AppID subscriptions so only the specific
 * card for that AppID re-renders when data resolves.
 */
export function useSteamGridArt(
  appId: number | null | undefined
): SgdbAssets | null {
  const ctx = useContext(SteamGridDbContext);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!ctx || appId == null || appId <= 0) return () => {};
      return ctx.subscribe(appId, onStoreChange);
    },
    [ctx, appId]
  );

  const getSnapshot = useCallback(() => {
    if (!ctx || appId == null || appId <= 0) return null;
    return ctx.get(appId) ?? null;
  }, [ctx, appId]);

  useEffect(() => {
    if (ctx && appId != null && appId > 0) {
      ctx.request(appId);
    }
  }, [appId, ctx]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const prefetchCache = new Set<string>();
const prefetchQueue: string[] = [];
let prefetchActive = 0;
const MAX_CONCURRENT_PREFETCH = 1;
const MAX_PREFETCH_CACHE = 12;

function processPrefetchQueue() {
  while (prefetchActive < MAX_CONCURRENT_PREFETCH && prefetchQueue.length > 0) {
    const url = prefetchQueue.shift()!;
    if (prefetchCache.has(url)) continue;
    prefetchCache.add(url);
    prefetchActive++;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    const finish = (success: boolean) => {
      if (!success) prefetchCache.delete(url);
      img.onload = null;
      img.onerror = null;
      prefetchActive--;
      processPrefetchQueue();
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
  }
}

function schedulePrefetch(url: string) {
  if (prefetchCache.has(url) || prefetchQueue.includes(url)) return;
  if (prefetchCache.size >= MAX_PREFETCH_CACHE) {
    prefetchCache.clear();
  }
  prefetchQueue.push(url);
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => processPrefetchQueue(), { timeout: 3000 });
  } else {
    setTimeout(processPrefetchQueue, 200);
  }
}

/**
 * Warm a small number of animated assets during idle time. The animated image
 * is still mounted by the card only while hovered, keeping decoded frame
 * buffers out of memory for the rest of the grid.
 */
export function usePrefetchImage(url: string | null | undefined): void {
  useEffect(() => {
    if (!url) return;
    schedulePrefetch(url);
  }, [url]);
}

export { SteamGridDbContext };
