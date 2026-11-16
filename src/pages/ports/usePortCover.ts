import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { PortCover } from "../../types/port";

/**
 * Lazy cover fetching for the ports grid.
 *
 * The catalog has ~1,000 rows but the wiki ships no images. Resolving art for
 * every row up front would mean a thousand provider calls, so each card asks
 * for its own cover only once it scrolls near the viewport, and a small queue
 * (4 in flight) keeps SteamGridDB's rate limit happy. Results - including
 * "no art" - live in a module map for the session; the main process caches
 * them on disk for a month across restarts.
 */
const EMPTY: PortCover = {
  url: null,
  thumbUrl: null,
  fallbackUrl: null,
  source: null,
};

const covers = new Map<string, PortCover>();
const inflight = new Map<string, Promise<PortCover>>();

interface Job {
  name: string;
  resolve: (cover: PortCover) => void;
}

const queue: Job[] = [];
let active = 0;
const MAX_CONCURRENT = 4;

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    active += 1;
    invoke<PortCover>("get_port_cover", { name: job.name })
      .then((cover) => cover ?? EMPTY)
      .catch(() => EMPTY)
      .then((cover) => {
        covers.set(job.name, cover);
        inflight.delete(job.name);
        job.resolve(cover);
      })
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

export function requestPortCover(name: string): Promise<PortCover> {
  const key = name.trim();
  if (!key) return Promise.resolve(EMPTY);
  const cached = covers.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = new Promise<PortCover>((resolve) => {
    queue.push({ name: key, resolve });
    pump();
  });
  inflight.set(key, promise);
  return promise;
}

/** Cached cover, for a modal that opens on an already-visible card. */
export function peekPortCover(name: string): PortCover | null {
  return covers.get(name) ?? null;
}

export function usePortCover(name: string | null, enabled = true): PortCover | null {
  const [cover, setCover] = useState<PortCover | null>(() =>
    name ? peekPortCover(name) : null,
  );

  useEffect(() => {
    if (!name) return;
    const cached = peekPortCover(name);
    if (cached) {
      setCover(cached);
      return;
    }
    if (!enabled) return;
    let mounted = true;
    void requestPortCover(name).then((next) => {
      if (mounted) setCover(next);
    });
    return () => {
      mounted = false;
    };
  }, [name, enabled]);

  return cover;
}

// -- Visibility -------------------------------------------------------------
// One IntersectionObserver for every card, mirroring the approach used by
// ArtworkImage: cards stop observing as soon as they have been revealed once.

const revealListeners = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;

function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          revealListeners.get(entry.target)?.();
        }
      },
      { rootMargin: "600px 0px", threshold: 0 },
    );
  }
  return observer;
}

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);

  const reveal = useCallback(() => setRevealed(true), []);

  useEffect(() => {
    if (revealed) return;
    const element = ref.current;
    const io = ensureObserver();
    if (!element || !io) {
      setRevealed(true);
      return;
    }
    revealListeners.set(element, reveal);
    io.observe(element);
    return () => {
      revealListeners.delete(element);
      io.unobserve(element);
    };
  }, [revealed, reveal]);

  return { ref, revealed };
}
