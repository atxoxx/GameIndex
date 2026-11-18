/**
 * Small, dependency-free prefetch primitives shared by routes and dialogs.
 *
 * The app splits pages and heavy modals into lazy chunks. Warming the chunk on
 * intent (hover / focus / pointer-down) turns the later click into a render
 * instead of a network + parse wait. Every loader is deduped by key and a
 * failed load is forgotten so a later attempt can try again.
 */
import { useCallback, useEffect, useRef } from "react";

type Loader = () => Promise<unknown>;

const started = new Map<string, Promise<unknown>>();

/** Start `load` once per key; concurrent/repeated calls share the promise. */
export function preloadOnce(key: string, load: Loader): void {
  if (started.has(key)) return;
  let promise: Promise<unknown>;
  try {
    promise = load();
  } catch {
    return;
  }
  started.set(key, promise);
  promise.catch(() => {
    // A stale chunk (app updated mid-session) or a transient read error must
    // not poison the key forever: forget it so the next intent retries.
    if (started.get(key) === promise) started.delete(key);
  });
}

/** Test helper: forget every warmed chunk. */
export function resetPreloadCache(): void {
  started.clear();
}

export interface IntentPrefetchHandlers {
  onPointerEnter: () => void;
  onPointerDown: () => void;
  onFocus: () => void;
  onTouchStart: () => void;
}

/**
 * Props that warm a chunk on the first real intent. Unlike an inline closure
 * this keeps a single "already fired" flag for the lifetime of the element.
 */
export function usePrefetchOnIntent(load: () => void): IntentPrefetchHandlers {
  const fired = useRef(false);
  const fire = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    load();
  }, [load]);

  return {
    onPointerEnter: fire,
    onPointerDown: fire,
    onFocus: fire,
    onTouchStart: fire,
  };
}

/**
 * Warm a chunk after `delayMs` if the component is still mounted. The delay is
 * real time (not an idle deadline): boot frames stay free for the library load.
 */
export function useIdlePrefetch(
  load: () => void,
  delayMs = 4_000,
  enabled = true,
): void {
  const saved = useRef(load);
  saved.current = load;

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => saved.current(), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, enabled]);
}

/** Fire each task sequentially, spacing them so no single frame does too much. */
export function scheduleIdlePrefetch(
  tasks: ReadonlyArray<() => void>,
  delayMs = 3_500,
  spacingMs = 350,
): () => void {
  let cancelled = false;
  const timers = new Set<number>();

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!cancelled) fn();
    }, ms);
    timers.add(id);
  };

  const run = (index: number) => {
    if (cancelled || index >= tasks.length) return;
    tasks[index]();
    later(() => run(index + 1), spacingMs);
  };

  later(() => run(0), delayMs);

  return () => {
    cancelled = true;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };
}
