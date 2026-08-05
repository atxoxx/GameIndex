import { useSyncExternalStore } from "react";

/**
 * Tiny external store for the live Store search query.
 *
 * The Store page owns search state in `useStoreCatalogue`, and the game
 * grid/cards can't reach it without threading new props through
 * `StorePage`. `StoreSearchBar` publishes the raw input value here on every
 * change (typing, clear button, Escape, recent/popular chips — all flow
 * through the `value` prop), and `StoreGameGrid` subscribes with
 * `useSyncExternalStore` so card titles can highlight the active search
 * term. The bar and the grid only mount together on the desktop Store
 * page, so there's no cross-page leakage.
 */

let currentQuery = "";
const listeners = new Set<() => void>();

export function publishSearchQuery(query: string): void {
  if (query === currentQuery) return;
  currentQuery = query;
  for (const listener of listeners) listener();
}

function getSnapshot(): string {
  return currentQuery;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Returns the current Store search query; re-renders on every change. */
export function useStoreSearchQuery(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}
