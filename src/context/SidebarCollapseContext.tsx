import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 520;

export interface SidebarCollapseContextValue {
  /** True when the sidebar is collapsed to a narrow icon-only rail. */
  isIconRail: boolean;
  /** Flip between full and icon-rail. */
  toggle: () => void;
  /** Force a specific value (used by tests + visual Settings UI). */
  setIconRail: (next: boolean) => void;
  /** User-customized width of the expanded sidebar in pixels (220 - 520). */
  sidebarWidth: number;
  /** Set custom width with automatic bounds clamping. */
  setSidebarWidth: (width: number) => void;
  /** Reset width to standard default (280px). */
  resetSidebarWidth: () => void;
  /** True while the user is actively dragging the resize handle. */
  isResizing: boolean;
  /** Toggle resizing indicator. */
  setIsResizing: (resizing: boolean) => void;
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
const LS_SIDEBAR_WIDTH_KEY = "gamelib.sidebar.width:v1";

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

function readPersistedWidth(): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LS_SIDEBAR_WIDTH_KEY);
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
        return parsed;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writePersistedWidth(width: number) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS_SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    /* ignore quota / sandbox errors */
  }
}

function clearPersistedWidth() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(LS_SIDEBAR_WIDTH_KEY);
  } catch {
    /* ignore quota / sandbox errors */
  }
}

function readIsNarrow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(`(max-width: ${NARROW_BREAKPOINT_PX}px)`).matches;
}

export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  const [userPref, setUserPrefState] = useState<boolean>(() => readPersisted() ?? false);

  const [isNarrow, setIsNarrow] = useState<boolean>(() => readIsNarrow());

  const [sidebarWidth, setSidebarWidthState] = useState<number>(
    () => readPersistedWidth() ?? DEFAULT_SIDEBAR_WIDTH
  );

  const [hasCustomWidth, setHasCustomWidth] = useState<boolean>(
    () => readPersistedWidth() !== null
  );

  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth
  );

  const [isResizing, setIsResizing] = useState(false);

  const userPrefRef = useRef(userPref);
  userPrefRef.current = userPref;

  // Track the narrow breakpoint live so resizing the window down forces the
  // icon rail and widening restores the user's explicit preference.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT_PX}px)`);
    const onChange = () => setIsNarrow(mql.matches);
    setIsNarrow(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Sync width CSS variable to document root so CSS layout tracks the custom
  // width — clamped so the main column always keeps a usable minimum.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!hasCustomWidth) {
      root.style.removeProperty("--sidebar-width");
      return;
    }
    const maxAllowed = Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - 640);
    const effective = Math.min(sidebarWidth, maxAllowed);
    root.style.setProperty("--sidebar-width", `${effective}px`);
  }, [sidebarWidth, hasCustomWidth, viewportWidth]);

  useEffect(() => {
    if (hasCustomWidth) writePersistedWidth(sidebarWidth);
  }, [sidebarWidth, hasCustomWidth]);

  const setUserPrefPersistent = useCallback((next: boolean) => {
    writePersisted(next);
    setUserPrefState(next);
  }, []);

  // Cross-window sync: when another instance flips the value, update state.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === LS_SIDEBAR_ICON_RAIL_KEY && e.newValue !== null) {
        setUserPrefState(e.newValue === "true");
      }
      if (e.key === LS_SIDEBAR_WIDTH_KEY) {
        if (e.newValue === null) {
          setHasCustomWidth(false);
          setSidebarWidthState(DEFAULT_SIDEBAR_WIDTH);
          return;
        }
        const val = parseInt(e.newValue, 10);
        if (Number.isFinite(val) && val >= MIN_SIDEBAR_WIDTH && val <= MAX_SIDEBAR_WIDTH) {
          setHasCustomWidth(true);
          setSidebarWidthState(val);
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(
    () => setUserPrefPersistent(!userPrefRef.current),
    [setUserPrefPersistent]
  );
  const setIconRail = useCallback(
    (next: boolean) => setUserPrefPersistent(next),
    [setUserPrefPersistent]
  );

  const setSidebarWidth = useCallback((next: number) => {
    const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(next)));
    setHasCustomWidth(true);
    setSidebarWidthState(clamped);
  }, []);

  const resetSidebarWidth = useCallback(() => {
    clearPersistedWidth();
    setHasCustomWidth(false);
    setSidebarWidthState(DEFAULT_SIDEBAR_WIDTH);
  }, []);

  const isIconRail = isNarrow || userPref;

  const value = useMemo<SidebarCollapseContextValue>(
    () => ({
      isIconRail,
      toggle,
      setIconRail,
      sidebarWidth,
      setSidebarWidth,
      resetSidebarWidth,
      isResizing,
      setIsResizing,
    }),
    [isIconRail, toggle, setIconRail, sidebarWidth, setSidebarWidth, resetSidebarWidth, isResizing]
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
