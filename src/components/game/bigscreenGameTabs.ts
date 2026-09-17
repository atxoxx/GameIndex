// Pure helpers for the Big Screen Game Hub's tab navigation.
//
// The tab spine is the page's whole navigation model, so its two rules
// live here where they can be tested without mounting the page:
//   • `cycleTabId` — what LB/RB does to the active tab.
//   • `focusTabLanding` — where focus goes when the user commits to a
//     tab (A / click). Content first; if the tab body has nothing
//     focusable, focus stays on the tab button so the user is never
//     dropped onto an invisible or unrelated element.

/** Where committing to a tab sent focus. */
export type TabLanding = "content" | "tab" | "none";

/**
 * Next tab id for a bumper press. Wraps at both ends. An unknown active
 * id falls back to the first tab rather than trapping the user.
 */
export function cycleTabId<T extends string>(
  ids: readonly T[],
  active: T,
  direction: "forward" | "back",
): T {
  if (ids.length === 0) {
    throw new Error("cycleTabId requires at least one tab id");
  }
  const index = ids.indexOf(active);
  if (index < 0) return ids[0];
  const next =
    direction === "forward"
      ? (index + 1) % ids.length
      : (index - 1 + ids.length) % ids.length;
  return ids[next];
}

export interface FocusTabLandingOptions {
  /** The game page root, or null while it isn't mounted yet. */
  root: HTMLElement | null;
  /** Tab id to land inside. */
  tabId: string;
  /**
   * The engine's registry-scoped focus helper. Only ever picks elements
   * that were registered with the focus engine, so D-pad keeps working.
   */
  focusFirst: (scope: HTMLElement) => boolean;
}

/**
 * Move focus into a tab's body, falling back to the tab button when the
 * body has nothing focusable (a read-only tab like Specs is a legitimate
 * dead end — the tab strip stays the anchor).
 */
export function focusTabLanding({
  root,
  tabId,
  focusFirst,
}: FocusTabLandingOptions): TabLanding {
  if (!root) return "none";

  const panel = root.querySelector<HTMLElement>(
    `[role="tabpanel"][data-tab-id="${tabId}"][data-active="true"]`,
  );
  if (panel && focusFirst(panel)) return "content";

  const tab = root.querySelector<HTMLElement>(`#bigscreen-tab-${tabId}`);
  if (tab) {
    tab.focus({ preventScroll: true });
    return "tab";
  }
  return "none";
}
