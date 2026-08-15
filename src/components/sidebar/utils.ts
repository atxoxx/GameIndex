/**
 * How many of the most-recently-played games the sidebar's
 * "Recently Played" section shows at the top of the scroll list.
 */
export const RECENTLY_PLAYED_COUNT = 5;

const PINNED_IDS_STORAGE_KEY = "gamelib.sidebar.pinned_ids:v1";
const COLLAPSED_SECTIONS_STORAGE_KEY = "gamelib.sidebar.collapsed_sections:v1";

/**
 * Read the persisted pinned-id set from localStorage. Wrapped in
 * try/catch because private-browsing / sandboxed contexts can throw
 * on access — returning an empty Set keeps the sidebar renderable.
 * Per-entry type filtering defends against a corrupt payload (e.g.
 * a future schema migration that wrote numbers instead of strings):
 * one bad entry cannot poison the whole set.
 */
export function loadPinnedIds(): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(PINNED_IDS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/**
 * Persist pinned game IDs to localStorage safely.
 */
export function savePinnedIds(pinnedIds: Set<string>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      PINNED_IDS_STORAGE_KEY,
      JSON.stringify(Array.from(pinnedIds))
    );
  } catch {
    /* quota / sandboxed contexts / private browsing — ignore */
  }
}

/**
 * Read the persisted collapsed sections map from localStorage.
 */
export function loadCollapsedSections(): Record<string, boolean> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist collapsed sections map to localStorage safely.
 */
export function saveCollapsedSections(collapsed: Record<string, boolean>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify(collapsed)
    );
  } catch {
    /* quota / sandboxed contexts / private browsing — ignore */
  }
}

/**
 * Builds a CSS selector safe for querying the sidebar game row element.
 */
export function buildSidebarAnchorSelector(gameId: string | null): string {
  if (!gameId) return "";
  try {
    return `[data-sidebar-game-id="${CSS.escape(gameId)}"]`;
  } catch {
    return `[data-sidebar-game-id="${gameId.replace(/["\\]/g, "\\$&")}"]`;
  }
}
