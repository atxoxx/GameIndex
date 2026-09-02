import { useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "gamelib_active_game_artwork";

let activeArtworkUrl: string | null = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
})();

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): string | null {
  return activeArtworkUrl;
}

function getServerSnapshot(): string | null {
  return null;
}

/**
 * Get the currently active game artwork URL imperatively.
 */
export function getActiveGameArtwork(): string | null {
  return activeArtworkUrl;
}

/**
 * Update the active game artwork URL.
 *
 * Only updates when provided a valid, non-empty string different from the current URL.
 * Crucially, passing null/undefined is a no-op so that unmounting a game page does
 * NOT wipe out the active palette when navigating between pages.
 */
export function setActiveGameArtwork(url: string | null | undefined): void {
  const trimmed = url?.trim();
  if (!trimmed || trimmed === activeArtworkUrl) return;

  activeArtworkUrl = trimmed;
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    /* ignore storage quota / sandbox errors */
  }

  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore listener errors */
    }
  });
}

/**
 * React hook to reactively read the active game artwork URL across any component.
 */
export function useActiveGameArtwork(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * React hook called by game detail pages or heroes to publish their artwork URL.
 * Updates on mount or when the artwork URL changes.
 *
 * Intentionally does NOT clear on unmount so the theme and palette stay active
 * while browsing other pages.
 */
export function usePublishGameArtwork(url: string | null | undefined): void {
  useEffect(() => {
    if (url) {
      setActiveGameArtwork(url);
    }
  }, [url]);
}
