import { createContext, useContext, useState, type ReactNode } from "react";

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

const PresenceContext = createContext<PresenceContextValue | null>(null);

export function PresenceProvider({ children }: { children: ReactNode }) {
  const [storePlatforms, setStorePlatforms] = useState<string[]>([]);
  const [modsGameName, setModsGameName] = useState<string | null>(null);

  return (
    <PresenceContext.Provider
      value={{ storePlatforms, setStorePlatforms, modsGameName, setModsGameName }}
    >
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
