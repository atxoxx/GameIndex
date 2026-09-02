import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * PresenceContext
 * ──────────────────────
 * Page-local hints for the Discord Rich Presence "browsing" state.
 * Pages (Store, Mods) publish their current context here via the
 * setters; the `useDiscordPresence` hook (mounted in AppShell) reads
 * them to build the browsing activity payload. A dedicated context
 * keeps deep page state observable from the route root without
 * drilling props through every intermediate component.
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

  const handleSetStorePlatforms = useCallback((platforms: string[]) => {
    setStorePlatforms(platforms);
  }, []);

  const handleSetModsGameName = useCallback((name: string | null) => {
    setModsGameName(name);
  }, []);

  const contextValue = useMemo(() => ({
    storePlatforms,
    setStorePlatforms: handleSetStorePlatforms,
    modsGameName,
    setModsGameName: handleSetModsGameName,
  }), [storePlatforms, handleSetStorePlatforms, modsGameName, handleSetModsGameName]);

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
