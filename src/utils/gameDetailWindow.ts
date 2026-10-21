/**
 * Opening a game's detail page in the reusable `game-detail` window.
 *
 * Middle-click and the "Open in New Window" menu entries all funnel through
 * `openGameDetailWindow`. Cards opt in by tagging their root element with
 * `data-game-detail-route` / `data-game-detail-title`; `GamePopoutBridge`
 * reads those tags for the middle-click gesture and `AppContextMenu` reads
 * them for surfaces without their own right-click menu.
 */

import { invoke } from "@tauri-apps/api/core";

/** Route of the detail page to open, e.g. `/library/<id>` or `/store/<slug>`. */
export const GAME_DETAIL_ROUTE_ATTR = "data-game-detail-route";
/** Human-readable name used for the native window title. */
export const GAME_DETAIL_TITLE_ATTR = "data-game-detail-title";

export interface GameDetailTarget {
  route: string;
  title?: string;
}

/** True inside a Tauri webview (the backend command exists there). */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Focus the existing detail window on `route`, or create it. Outside Tauri
 * (`npm run dev` in a browser) fall back to a browser tab so the gesture is
 * still testable.
 */
export function openGameDetailWindow(route: string, title?: string): void {
  if (!isTauriRuntime()) {
    const url = `${window.location.origin}${window.location.pathname}#${route}`;
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  void invoke("open_game_detail_window", { route, title }).catch((err) => {
    // Surfacing this as a toast needs a provider this util may run outside
    // of; a console error is enough for a failed window creation.
    console.error("[game-detail] failed to open window:", err);
  });
}

/** Resolve the nearest tagged game item element for an event. */
export function findGameDetailElement(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const element = target.closest(`[${GAME_DETAIL_ROUTE_ATTR}]`);
  return element instanceof HTMLElement ? element : null;
}

/** Resolve the nearest tagged game item for an event, if there is one. */
export function findGameDetailTarget(event: Event): GameDetailTarget | null {
  const element = findGameDetailElement(event);
  if (!element) return null;
  const route = element.getAttribute(GAME_DETAIL_ROUTE_ATTR)?.trim();
  if (!route) return null;
  const title = element.getAttribute(GAME_DETAIL_TITLE_ATTR)?.trim() || undefined;
  return { route, title };
}
