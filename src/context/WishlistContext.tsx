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
import { useWishlist } from "../hooks/useWishlist";
import type { StoreGameSummary, WishlistEntry } from "../types/game";

/**
 * WishlistContext exposes the user's wishlist state plus toggle helpers
 * to any descendant component. Wraps `useWishlist` so deeply-nested cards
 * (in `StoreGameGrid`, `SnapRail`, `WishlistRail`) can read wishlisted
 * status and toggle entries without prop-drilling.
 *
 * The hook itself keeps React state as the source of truth and debounces
 * disk writes — the provider simply publishes the API.
 */
interface WishlistContextValue {
  /** All wishlisted entries, newest first (highest addedAt). */
  wishlist: WishlistEntry[];
  /** False until the on-disk cache has finished hydrating. */
  hydrated: boolean;
  /** O(1) membership check by IGDB slug. */
  isWishlisted: (slug: string) => boolean;
  /** Bidirectional: adds if absent, removes if present. */
  toggle: (game: StoreGameSummary) => void;
  /** Explicit remove — used by WishlistRail heart button. */
  remove: (slug: string) => void;
  /** Update or clear the free-text note on a wishlisted game. */
  setNote: (slug: string, note: string) => void;
  /** Bulk-remove every entry (used by the "Clear wishlist" action). */
  clear: () => void;
  /** Convenience: number of wishlisted games. */
  count: number;
}

/**
 * Narrow feature surface for memoised cards. The full `WishlistContext`
 * value changes on every toggle, which would re-render every mounted card
 * even though only one slug's membership moved. This surface is stable
 * (ref-forwarded) and fans out per-slug notifications instead, so a card
 * re-renders only when its own slug is added or removed.
 */
export interface WishlistStatusValue {
  isWishlisted: (slug: string) => boolean;
  toggle: (game: StoreGameSummary) => void;
  subscribe: (slug: string, cb: () => void) => () => void;
}

// Persist the React context instances across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalWishlistObj = globalThis as unknown as {
  __gamelib_wishlist_context__?: React.Context<WishlistContextValue | null>;
  __gamelib_wishlist_status_context__?: React.Context<WishlistStatusValue | null>;
};
const WishlistContext =
  globalWishlistObj.__gamelib_wishlist_context__ ??
  (globalWishlistObj.__gamelib_wishlist_context__ = createContext<WishlistContextValue | null>(null));

const WishlistStatusContext =
  globalWishlistObj.__gamelib_wishlist_status_context__ ??
  (globalWishlistObj.__gamelib_wishlist_status_context__ = createContext<WishlistStatusValue | null>(null));

/**
 * The underlying Context object. Exported so deeply-nested consumers
 * (e.g. `StoreGameCard`) can read it directly with `useContext` and
 * gracefully fall back to defaults when no provider is mounted —
 * instead of throwing via `useWishlistContext`.
 */
export { WishlistContext };

export function WishlistProvider({
  value: externalValue,
  children,
}: {
  /** Optional explicit value. When omitted the provider falls back to its
   *  own `useWishlist()` invocation — useful when `StorePage` already holds
   *  the canonical state and wants to share it with deeply-nested cards
   *  without spawning a second hook instance. */
  value?: WishlistContextValue;
  children: ReactNode;
}) {
  const fallback = useWishlist();
  const value = externalValue ?? fallback;

  // Latest value for the stable narrow callbacks below.
  const valueRef = useRef(value);
  valueRef.current = value;

  const statusListenersRef = useRef(new Map<string, Set<() => void>>());
  const prevSlugsRef = useRef(new Set<string>());

  // Diff membership against the previous render and notify only the slugs
  // whose wishlisted state actually flipped.
  useEffect(() => {
    const current = new Set(value.wishlist.map((entry) => entry.slug));
    const prev = prevSlugsRef.current;
    const changed = new Set<string>();
    for (const slug of current) if (!prev.has(slug)) changed.add(slug);
    for (const slug of prev) if (!current.has(slug)) changed.add(slug);
    prevSlugsRef.current = current;
    if (changed.size === 0) return;
    const listeners = statusListenersRef.current;
    for (const slug of changed) {
      const set = listeners.get(slug);
      if (set) for (const cb of set) cb();
    }
  }, [value.wishlist]);

  const subscribeStatus = useCallback((slug: string, cb: () => void) => {
    let set = statusListenersRef.current.get(slug);
    if (!set) {
      set = new Set();
      statusListenersRef.current.set(slug, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) statusListenersRef.current.delete(slug);
    };
  }, []);

  const isWishlistedBySlug = useCallback(
    (slug: string) => valueRef.current.isWishlisted(slug),
    [],
  );

  const toggleWishlist = useCallback(
    (game: StoreGameSummary) => valueRef.current.toggle(game),
    [],
  );

  const statusValue = useMemo<WishlistStatusValue>(
    () => ({
      subscribe: subscribeStatus,
      isWishlisted: isWishlistedBySlug,
      toggle: toggleWishlist,
    }),
    [subscribeStatus, isWishlistedBySlug, toggleWishlist],
  );

  return (
    <WishlistContext.Provider value={value}>
      <WishlistStatusContext.Provider value={statusValue}>
        {children}
      </WishlistStatusContext.Provider>
    </WishlistContext.Provider>
  );
}

export function useWishlistContext(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) {
    throw new Error("useWishlistContext must be used within a WishlistProvider");
  }
  return ctx;
}

/**
 * Stable narrow wishlist API for cards. Returns `null` outside a provider so
 * standalone card renders keep their current no-op behaviour.
 */
export function useWishlistStatus(): WishlistStatusValue | null {
  return useContext(WishlistStatusContext);
}

/**
 * Subscribe a single slug to wishlist membership. Re-renders only when THIS
 * slug is added or removed, not when any other entry changes.
 */
export function useIsWishlisted(slug: string): boolean {
  const status = useContext(WishlistStatusContext);

  const subscribe = useCallback(
    (cb: () => void) => (status ? status.subscribe(slug, cb) : () => {}),
    [status, slug],
  );
  const getSnapshot = useCallback(
    () => (status ? status.isWishlisted(slug) : false),
    [status, slug],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
