import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * SidebarCollapseContext
 * ──────────────────────
 * Single source of truth for the left sidebar's full vs. icon-rail
 * mode. The App grid reads `isIconRail` to flip the CSS grid
 * column on `.app-layout.sidebar-icon-rail`, while the Sidebar
 * component reads the same value to render the toggle button and
 * the right compact-vs-full markup.
 *
 * Why a context (not just `useState` + a custom hook called by both
 * `App.tsx` and `Sidebar.tsx`):
 *  • `App.tsx` lives ABOVE the Sidebar in the component tree, but
 *    both need to re-render the moment the user clicks the
 *    collapse button in the sidebar. Two independent `useState`
 *    calls would either race (state desync between the two) or
 *    require a non-trivial shared `useEffect`/storage-event bridge
 *    to keep them in lockstep. A single shared state is cheaper.
 *  • Context also gives us a stable hook API for tests and any
 *    future consumer (e.g. a Visual Settings page that wants to
 *    toggle the rail from outside the sidebar).
 *
 * Persistence:
 *  Writes the boolean to localStorage on every change. Cross-tab
 *  sync via the `storage` event lets a second window pick up the
 *  toggle in real time. The `:v1` suffix on the key lets us bump
 *  the schema later without colliding with the legacy boolean.
 *
 * Narrow-window behavior:
 *  Below the breakpoint the icon rail is forced on (matchMedia) so
 *  content keeps breathing room on small windows. This is a visual
 *  override only — the persisted user preference is untouched and
 *  takes back over once the window widens again.
 *
 * Default: full sidebar (`userPref = false`). We default to the
 * roomy mode because:
 *  • the icon rail hides the search box + import controls. A first-
 *    visit user landing on an empty icon rail with no hint how to
 *    find games would be a poor onboarding experience.
 *  • the user can opt-in to the rail explicitly.
 */
export interface SidebarCollapseContextValue {
  /** True when the sidebar is collapsed to a narrow icon-only rail. */
  isIconRail: boolean;
  /** Flip between full and icon-rail. */
  toggle: () => void;
  /** Force a specific value (used by tests + visual Settings UI). */
  setIconRail: (next: boolean) => void;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalSidebarCollapseObj = globalThis as unknown as {
  __gamelib_sidebar_collapse_context__?: React.Context<SidebarCollapseContextValue | null>;
};
export const SidebarCollapseContext =
  globalSidebarCollapseObj.__gamelib_sidebar_collapse_context__ ??
  (globalSidebarCollapseObj.__gamelib_sidebar_collapse_context__ = createContext<SidebarCollapseContextValue | null>(null));

const LS_SIDEBAR_ICON_RAIL_KEY = "gamelib.sidebar.icon_rail:v1";

/** Window width below which the icon rail is forced on. */
const NARROW_BREAKPOINT_PX = 1100;

function readPersisted(): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LS_SIDEBAR_ICON_RAIL_KEY);
    if (raw !== null) return raw === "true";
    return null;
  } catch {
    return null;
  }
}

function writePersisted(next: boolean) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS_SIDEBAR_ICON_RAIL_KEY, String(next));
  } catch {
    /* ignore quota / sandbox errors */
  }
}

function readIsNarrow(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(max-width: ${NARROW_BREAKPOINT_PX}px)`).matches;
}

export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  // The user's explicit choice, persisted to localStorage so a
  // returning user lands on their last-chosen state without a flash
  // of full-sidebar-then-icon-rail on mount.
  const [userPref, setUserPref] = useState<boolean>(() => {
    return readPersisted() ?? readIsNarrow();
  });

  // Persist user preference on every change.
  useEffect(() => {
    writePersisted(userPref);
  }, [userPref]);

  // Cross-window sync: when another instance flips the value, update state.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== LS_SIDEBAR_ICON_RAIL_KEY || e.newValue === null) return;
      setUserPref(e.newValue === "true");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => setUserPref((c) => !c), []);
  const setIconRail = useCallback((next: boolean) => setUserPref(next), []);

  const isIconRail = userPref;

  const value = useMemo<SidebarCollapseContextValue>(
    () => ({ isIconRail, toggle, setIconRail }),
    [isIconRail, toggle, setIconRail]
  );

  return (
    <SidebarCollapseContext.Provider value={value}>
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse(): SidebarCollapseContextValue {
  const ctx = useContext(SidebarCollapseContext);
  if (!ctx) {
    throw new Error(
      "useSidebarCollapse must be used within a SidebarCollapseProvider"
    );
  }
  return ctx;
}
