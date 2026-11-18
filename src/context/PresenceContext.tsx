import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PresenceActivityHint } from "../types/presence";

/**
 * PresenceContext
 * ──────────────────────
 * Page-local hints for the Discord Rich Presence "browsing" state.
 * Pages (Store, Mods, news preview, itch.io detail) publish their current
 * context here via the setters; the `useDiscordPresence` hook (mounted in
 * AppShell) reads them to build the activity payload. A dedicated context
 * keeps deep page state observable from the route root without drilling
 * props through every intermediate component.
 *
 * `activity` is a transient hint (open article, itch.io page) that outranks
 * downloads and plain route browsing. It is owner-scoped so a component that
 * mounts with nothing to publish cannot clear a hint set elsewhere.
 *
 * Defaults represent "no page hint": the Store page with no platform
 * filter selected and no mods page open.
 */
export interface PresenceContextValue {
  /** Selected platform names on the Store page (empty array = none). */
  storePlatforms: string[];
  setStorePlatforms: (platforms: string[]) => void;
  /** Name of the game whose mods page is open, or null. */
  modsGameName: string | null;
  setModsGameName: (name: string | null) => void;
  /** Real title of the store detail page currently open, or null. Lets
   *  Discord presence show the proper name instead of the URL slug. */
  storeGameName: string | null;
  setStoreGameName: (name: string | null) => void;
  /** Public cover/logo URL of the store detail page currently open, or null.
   *  Discord fetches the image server-side, so only https sources are usable. */
  storeGameArt: string | null;
  setStoreGameArt: (art: string | null) => void;
  /** Transient activity published by an open article or itch.io page. */
  activity: PresenceActivityHint | null;
  /**
   * Publish or clear a transient activity. `owner` scopes the clear so a
   * component that mounts with no activity (a closed news preview on Home)
   * cannot wipe a hint another component just published.
   */
  setActivity: (owner: string, hint: PresenceActivityHint | null) => void;
}

/** Owned activity state; exported for tests of the owner-scoping rule. */
export interface PresenceActivityState {
  owner: string;
  hint: PresenceActivityHint;
}

/**
 * Apply a publish/clear request. A non-null hint always takes over; a null
 * hint only clears the activity when the same owner published it.
 */
export function resolveActivityState(
  current: PresenceActivityState | null,
  owner: string,
  hint: PresenceActivityHint | null,
): PresenceActivityState | null {
  if (hint) return { owner, hint };
  return current?.owner === owner ? null : current;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalPresenceObj = globalThis as unknown as {
  __gamelib_presence_context__?: React.Context<PresenceContextValue | null>;
};
const PresenceContext =
  globalPresenceObj.__gamelib_presence_context__ ??
  (globalPresenceObj.__gamelib_presence_context__ = createContext<PresenceContextValue | null>(null));

export function PresenceProvider({ children }: { children: ReactNode }) {
  const [storePlatforms, setStorePlatforms] = useState<string[]>([]);
  const [modsGameName, setModsGameName] = useState<string | null>(null);
  const [storeGameName, setStoreGameName] = useState<string | null>(null);
  const [storeGameArt, setStoreGameArt] = useState<string | null>(null);
  const [activityState, setActivityState] = useState<PresenceActivityState | null>(null);

  const handleSetStorePlatforms = useCallback((platforms: string[]) => {
    setStorePlatforms(platforms);
  }, []);

  const handleSetModsGameName = useCallback((name: string | null) => {
    setModsGameName(name);
  }, []);

  const handleSetStoreGameName = useCallback((name: string | null) => {
    setStoreGameName(name);
  }, []);

  const handleSetStoreGameArt = useCallback((art: string | null) => {
    setStoreGameArt(art);
  }, []);

  const setActivity = useCallback(
    (owner: string, hint: PresenceActivityHint | null) => {
      setActivityState((current) => resolveActivityState(current, owner, hint));
    },
    [],
  );

  const contextValue = useMemo(() => ({
    storePlatforms,
    setStorePlatforms: handleSetStorePlatforms,
    modsGameName,
    setModsGameName: handleSetModsGameName,
    storeGameName,
    setStoreGameName: handleSetStoreGameName,
    storeGameArt,
    setStoreGameArt: handleSetStoreGameArt,
    activity: activityState?.hint ?? null,
    setActivity,
  }), [storePlatforms, handleSetStorePlatforms, modsGameName, handleSetModsGameName, storeGameName, handleSetStoreGameName, storeGameArt, handleSetStoreGameArt, activityState, setActivity]);

  return (
    <PresenceContext.Provider value={contextValue}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) {
    throw new Error("usePresence must be used within a PresenceProvider");
  }
  return ctx;
}

/**
 * Publish a transient activity for as long as `hint` is non-null.
 *
 * Safe outside a PresenceProvider (component tests): the effect is skipped,
 * so no test has to wrap every news/itch surface in the provider.
 */
export function usePresenceActivity(
  owner: string,
  hint: PresenceActivityHint | null,
): void {
  const ctx = useContext(PresenceContext);
  const setActivity = ctx?.setActivity;
  const kind = hint?.kind;
  const title = hint?.title;
  const subtitle = hint?.subtitle;
  const url = hint?.url;
  const image = hint?.image;

  useEffect(() => {
    if (!setActivity) return;
    setActivity(
      owner,
      kind && title ? { kind, title, subtitle, url, image } : null,
    );
    return () => setActivity(owner, null);
  }, [setActivity, owner, kind, title, subtitle, url, image]);
}
