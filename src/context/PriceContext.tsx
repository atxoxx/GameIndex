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
import type { GamePrice } from "../types/game";

/**
 * PriceContext batches per-card CheapShark price lookups into a single
 * backend round-trip, mirroring `CrackWatchContext`. Cards register their
 * game name; the provider coalesces registrations and calls
 * `fetch_game_prices_batch` once, then publishes results back.
 *
 * Uses fine-grained per-game subscriptions with React 19 `useSyncExternalStore`.
 * When a batch completes, ONLY cards for those specific game names re-render.
 */
interface PriceContextValue {
  request: (name: string) => void;
  get: (name: string) => GamePrice | null | undefined;
  subscribe: (name: string, onStoreChange: () => void) => () => void;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalPriceObj = globalThis as unknown as {
  __gamelib_price_context__?: React.Context<PriceContextValue | null>;
};
const PriceContext =
  globalPriceObj.__gamelib_price_context__ ??
  (globalPriceObj.__gamelib_price_context__ = createContext<PriceContextValue | null>(null));

const BATCH_DEBOUNCE_MS = 150;

export function PriceProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<Map<string, GamePrice | null>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Set<string>>(new Set());
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

    invoke<Record<string, GamePrice>>("fetch_game_prices_batch", {
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

  const get = useCallback((name: string) => cacheRef.current.get(name), []);

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

  const value = useMemo<PriceContextValue>(
    () => ({ request, get, subscribe }),
    [request, get, subscribe]
  );

  return (
    <PriceContext.Provider value={value}>
      {children}
    </PriceContext.Provider>
  );
}

/**
 * usePrice: subscribe a single card to the batched price lookup. Returns
 * the resolved price (or null when there's no data). Safe without provider.
 */
export function usePrice(name: string): GamePrice | null {
  const ctx = useContext(PriceContext);

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

export { PriceContext };

