// useFocusedGame — resolve the game card the controller is on against
// the CURRENT list, so a spotlight / detail pane never pins a stale
// object.
//
// The bug it fixes: pages used to read `focusedElement`'s
// `data-game-id` and then look the id up once, or hold the resolved
// `Game` object in state. When the list changed underneath the focus
// (Continue Playing shrinks after a launch, a filter chip removes the
// focused game, a shelf re-sorts), focus landed on the removed card's
// neighbour — or nowhere, since the card unmounted — and the spotlight
// kept rendering the old object. Here the id is remembered, but it is
// re-resolved on every render and falls back to the list's first item
// when it disappears.
//
// Non-card chrome (section nav, filter chips, header buttons) is
// ignored: the remembered card stays on screen while the user crosses
// the page, instead of the spotlight blanking mid-journey.

import { useRef } from "react";
import { useGamepad } from "../../../hooks/GamepadProvider";

export interface FocusedGameResult<T> {
  /** Resolved against the current list — never a stale object. */
  item: T | null;
  /** The remembered game id, or null when nothing card-like was seen. */
  focusedId: string | null;
  /** Owning `[data-rail-id]`, when the card lives in a rail. */
  railId: string | null;
}

export function useFocusedGame<T>(opts: {
  items: readonly T[];
  getId: (item: T) => string;
}): FocusedGameResult<T> {
  const { items, getId } = opts;
  const { focusedElement } = useGamepad();

  // Refs, not state: the value is derived from the current `items` on
  // every render, so writing here cannot cause an extra render.
  const rememberedIdRef = useRef<string | null>(null);
  const rememberedRailRef = useRef<string | null>(null);

  if (focusedElement) {
    const card = focusedElement.closest<HTMLElement>("[data-game-id]");
    const id = card?.dataset.gameId;
    // Only cards that still exist in this list may take over; chrome and
    // cards from another rail are ignored so the last card sticks.
    if (id && items.some((item) => getId(item) === id)) {
      rememberedIdRef.current = id;
      rememberedRailRef.current =
        card?.closest<HTMLElement>("[data-rail-id]")?.dataset.railId ?? null;
    }
  }

  // Resolve on every render rather than memoising: the remembered id can
  // change without `items` or `getId` changing (a focus move), and a memo
  // keyed on the list alone would keep serving the previous card.
  const remembered = rememberedIdRef.current;
  const match = remembered
    ? items.find((entry) => getId(entry) === remembered)
    : undefined;
  // A vanished remembered id falls back to the head of the list so a
  // spotlight never blanks while a shelf reloads.
  const item = match ?? items[0] ?? null;

  if (items.length === 0) {
    return { item: null, focusedId: null, railId: null };
  }

  return {
    item,
    focusedId: item ? getId(item) : null,
    // A fallback card is not the remembered card, so don't attach the
    // remembered rail to it.
    railId: match ? rememberedRailRef.current : null,
  };
}
