import { useEffect } from "react";
import {
  findGameDetailElement,
  findGameDetailTarget,
  openGameDetailWindow,
} from "../utils/gameDetailWindow";

/**
 * GamePopoutBridge
 *
 * Owns the middle-click half of the "open the game page in a new window"
 * gesture for every game item in the desktop shell. Items opt in with a
 * `data-game-detail-route` attribute (see `src/utils/gameDetailWindow.ts`),
 * so a surface never has to wire its own mouse handler - and new lists get
 * the gesture for free by tagging their card root.
 *
 * Capture phase, because the items have their own click handlers and a
 * middle click must never reach them. `mousedown` is intercepted too: on
 * Windows the WebView starts autoscroll on button 1 before `auxclick` fires.
 */

/** Controls nested inside a card keep their own middle-click behaviour. */
const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, [contenteditable='true'], [contenteditable='']";

/** True when the pointer sits on a control that lives inside the item. */
function onNestedControl(event: MouseEvent, item: HTMLElement): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const control = target.closest(INTERACTIVE_SELECTOR);
  return !!control && control !== item && item.contains(control);
}

export default function GamePopoutBridge() {
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      const item = findGameDetailElement(event);
      if (!item || onNestedControl(event, item)) return;
      // Stop the WebView autoscroll cursor; `auxclick` opens the window.
      event.preventDefault();
    };

    const handleAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      const item = findGameDetailElement(event);
      if (!item || onNestedControl(event, item)) return;
      const game = findGameDetailTarget(event);
      if (!game) return;
      event.preventDefault();
      event.stopPropagation();
      openGameDetailWindow(game.route, game.title);
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("auxclick", handleAuxClick, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("auxclick", handleAuxClick, true);
    };
  }, []);

  return null;
}
