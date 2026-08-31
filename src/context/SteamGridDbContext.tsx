import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SgdbAssets } from "../types/steamgriddb";

/**
 * SteamGridDbContext batches per-card SteamGridDB artwork lookups into a
 * single backend round-trip.
 *
 * A library or store grid can render hundreds of cards; letting each card
 * fire its own `sgdb_get_assets` invoke would mean hundreds of IPC calls
 * (and, worse, hundreds of backend KV reads). Cards register their Steam
 * AppID here; the provider coalesces registrations within a short window
 * and calls `sgdb_get_assets_batch` once, then publishes results back —
 * the same coalescing pattern as CrackWatchContext / PriceContext.
 *
 * The backend additionally caches per-AppID results (7-day TTL), so repeat
 * visits resolve from SQLite without touching the SteamGridDB API.
 */
interface SteamGridDbContextValue {
  /** Register an AppID for lookup; schedules a batched fetch if uncached. */
  request: (appId: number) => void;
  /** Read the resolved artwork for an AppID (undefined = not yet resolved). */
  get: (appId: number) => SgdbAssets | null | undefined;
  /** Bump on every batch completion so consumers re-read `get`. */
  version: number;
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);

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
        }
        setVersion((v) => v + 1);
      })
      .catch(() => {
        // On failure, mark as resolved-null so we don't re-request on every
        // render (the backend caches negatives too, so this is cheap).
        for (const id of appIds) {
          if (!cacheRef.current.has(id)) cacheRef.current.set(id, null);
          inflightRef.current.delete(id);
        }
        setVersion((v) => v + 1);
      });
  }, []);

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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <SteamGridDbContext.Provider value={{ request, get, version }}>
      {children}
    </SteamGridDbContext.Provider>
  );
}

/**
 * useSteamGridArt: subscribe a single surface (library card, store card,
 * hero) to the batched SteamGridDB lookup for a Steam AppID.
 *
 * Returns the resolved artwork, or `null` when there's no AppID, no
 * provider, or the game has no community art. Safe to call without a
 * provider — it simply returns null and does nothing.
 */
export function useSteamGridArt(
  appId: number | null | undefined
): SgdbAssets | null {
  const ctx = useContext(SteamGridDbContext);

  useEffect(() => {
    if (ctx && appId != null) ctx.request(appId);
    // Re-request only when the AppID changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, ctx?.request]);

  if (!ctx || appId == null) return null;
  // Reading ctx.version in render ties this component to batch completions.
  void ctx.version;
  return ctx.get(appId) ?? null;
}

const prefetchCache = new Set<string>();

/**
 * usePrefetchImage: eagerly fetch an image so it's warm in the browser cache
 * before the user needs it.
 *
 * The store/library pages resolve SteamGridDB metadata automatically on
 * mount (batched IPC + backend KV cache). This hook warms the animated
 * WebP/APNG buffers for the games that are actually rendered, so swapping to
 * the animated version on hover (or in the hero) is instant instead of
 * triggering a network fetch at hover time.
 */
export function usePrefetchImage(url: string | null | undefined): void {
  useEffect(() => {
    if (!url || prefetchCache.has(url)) return;
    prefetchCache.add(url);
    const img = new Image();
    img.onload = () => {};
    img.onerror = () => {
      prefetchCache.delete(url);
    };
    img.src = url;
  }, [url]);
}

export { SteamGridDbContext };
