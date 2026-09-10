// focusMemory — remembers which focusable the controller was on for
// each Big Screen route so returning to a page resumes where the user
// left off (console behavior) instead of snapping to the first button.
//
// Keys are derived from `data-focus-key` when present, otherwise from
// `data-game-id` (`game:<id>`), which every game card carries. The
// shell writes on `focusin` and reads on route change.
//
// Purely in-memory: a reload starts fresh, which matches the mode's
// session-scoped nature.

const memory = new Map<string, string>();

/** Resolve a stable focus key for an element, or null when untracked. */
export function focusKeyFor(element: Element | null | undefined): string | null {
  if (!(element instanceof Element)) return null;
  const marked = element.closest<HTMLElement>("[data-focus-key]");
  const markedKey = marked?.dataset.focusKey;
  if (markedKey) return markedKey;
  const card = element.closest<HTMLElement>("[data-game-id]");
  const gameId = card?.dataset.gameId;
  if (gameId) {
    // Cards can appear in more than one rail (Continue Playing +
    // Recently Added), so the owning rail is part of the key and the
    // restore only lands in the rail the user actually left.
    const railId = card.closest<HTMLElement>("[data-rail-id]")?.dataset.railId;
    return railId ? `game:${gameId}@${railId}` : `game:${gameId}`;
  }
  return null;
}

export interface ParsedFocusGameKey {
  gameId: string;
  railId: string | null;
}

/** Parse a `game:<id>` / `game:<id>@<rail>` key. */
export function parseFocusGameKey(
  key: string | null | undefined,
): ParsedFocusGameKey | null {
  if (!key || !key.startsWith("game:")) return null;
  const rest = key.slice("game:".length);
  const at = rest.indexOf("@");
  if (at < 0) return { gameId: rest, railId: null };
  return { gameId: rest.slice(0, at), railId: rest.slice(at + 1) || null };
}

/** Remember the focused element for a route path. */
export function rememberFocus(
  path: string | null | undefined,
  element: Element | null | undefined,
): void {
  if (!path) return;
  const key = focusKeyFor(element);
  if (key) memory.set(path, key);
}

/** Recall the remembered focus key for a route path. */
export function recallFocus(path: string | null | undefined): string | null {
  if (!path) return null;
  return memory.get(path) ?? null;
}

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

/** CSS selector matching the element remembered under `key`. */
export function focusSelectorForKey(key: string): string {
  const parsed = parseFocusGameKey(key);
  if (parsed) {
    const id = escapeSelectorValue(parsed.gameId);
    return `[data-focus-key="${escapeSelectorValue(key)}"], [data-game-id="${id}"]`;
  }
  return `[data-focus-key="${escapeSelectorValue(key)}"]`;
}

/** Test helper: wipe the route-to-focus map. */
export function clearFocusMemory(): void {
  memory.clear();
}
