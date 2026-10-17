import { useEffect, useRef, type RefObject } from "react";

/**
 * One IntersectionObserver per distinct rootMargin, shared by every card on
 * screen. A library full of no-cover cards used to create an individual
 * observer per card — with hundreds of cards mounted that is hundreds of
 * observers firing against the same scroll. The Map keeps the listener
 * per element; the WeakMap-style explicit removal in the cleanup keeps
 * unmounted elements from lingering.
 *
 * Visibility callbacks fire once per element (the observer stops tracking
 * the element after the first intersection) because both current call
 * sites — card cover-fetch and lazy sidebar art — are "first time seen"
 * triggers.
 */
const listeners = new Map<Element, (visible: boolean) => void>();
const observers = new Map<string, IntersectionObserver>();

function ensureObserver(rootMargin: string): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  let obs = observers.get(rootMargin);
  if (!obs) {
    obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const cb = listeners.get(entry.target);
          if (!cb) continue;
          listeners.delete(entry.target);
          obs?.unobserve(entry.target);
          cb(true);
        }
      },
      { rootMargin }
    );
    observers.set(rootMargin, obs);
  }
  return obs;
}

interface SharedViewportOptions {
  targetRef: RefObject<HTMLElement | null>;
  /** When false nothing is observed and `onVisible` never fires. */
  enabled?: boolean;
  onVisible: () => void;
  rootMargin?: string;
  /** Extra dep (e.g. `game.id`) guarding against a changed element node. */
  dep?: string;
}

export function useSharedViewportVisibility(
  options: SharedViewportOptions
): void {
  const { targetRef, enabled = true, onVisible, rootMargin = "300px", dep } = options;
  // The live callback stays in a ref so consumers can pass inline closures
  // without re-observing on every render.
  const cbRef = useRef(onVisible);
  cbRef.current = onVisible;

  useEffect(() => {
    if (!enabled) return;
    const node = targetRef.current;
    if (!node) return;
    const obs = ensureObserver(rootMargin);
    if (!obs) {
      // No observer support (tests/old webviews) — behave as visible.
      cbRef.current();
      return;
    }
    const handle = () => {
      listeners.delete(node);
      obs.unobserve(node);
      cbRef.current();
    };
    listeners.set(node, handle);
    obs.observe(node);
    return () => {
      if (listeners.has(node)) {
        listeners.delete(node);
        obs.unobserve(node);
      }
    };
  }, [targetRef, enabled, rootMargin, dep]);
}
