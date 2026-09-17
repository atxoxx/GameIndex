// Bumper legend scope — tells the shell's bottom bar what LB/RB actually
// do on the mounted screen.
//
// The footer legend used to hardcode "LB/RB SECTIONS", which is only true
// on the shell's own strip. A page that takes over the bumpers (the tabbed
// Game Hub, the Friends hub, the Store detail page) must say so, or the
// only affordance a couch user has starts lying.
//
// The mechanism is deliberately tiny and out of React: a tab bar declares
// its scope while mounted and the shell subscribes. Nested declarations
// would be a stack, but no screen mounts two bumper scopes at once.

import { useEffect, useSyncExternalStore } from "react";

export type BumperScope = "sections" | "tabs";

/** Scope when nothing has declared one: the shell strip cycler. */
const DEFAULT_SCOPE: BumperScope = "sections";

let current: BumperScope = DEFAULT_SCOPE;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): BumperScope {
  return current;
}

/** Set the scope directly. Exposed for the mounted-scope hook. */
export function setBumperScope(scope: BumperScope): void {
  if (scope === current) return;
  current = scope;
  emit();
}

/** Read the scope without subscribing (non-React callers). */
export function getBumperScope(): BumperScope {
  return current;
}

/** Subscribe to scope changes from a component. */
export function useBumperScope(): BumperScope {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Declare the bumper scope for as long as the calling component is
 * mounted. On unmount the scope resets to the shell default, which is
 * correct because a route swap unmounts the old page before the new
 * page's declaration lands.
 */
export function useBumperScopeDeclaration(scope: BumperScope): void {
  useEffect(() => {
    setBumperScope(scope);
    return () => setBumperScope(DEFAULT_SCOPE);
  }, [scope]);
}
