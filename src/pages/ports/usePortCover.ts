import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { PortCover } from "../../types/port";

/**
 * Lazy cover fetching for the ports grid.
 *
 * The catalog has ~1,000 rows but the wiki ships no images. Resolving art for
 * every row up front would mean a thousand provider calls, so each card asks
 * for its own cover only once it scrolls near the viewport, and a queue
 * (8 in flight) keeps SteamGridDB's rate limit happy. Sources that do ship an
 * image pass it as `initialUrl`, which skips this queue entirely.
 *
 * `prefetchPortCovers` warms a whole page of names through the batch command so
 * scrolling does not trickle through the per-name queue. Results - including
 * "no art" - live in a module map for the session; the main process caches them
 * on disk for a month across restarts.
 */
const EMPTY: PortCover = {
  url: null,
  thumbUrl: null,
  fallbackUrl: null,
  source: null,
};

const covers = new Map<string, PortCover>();
const inflight = new Map<string, Promise<PortCover>>();
/** Names already handed to a batch call, so a second prefetch skips them. */
const prefetching = new Set<string>();

interface Job {
  name: string;
  resolve: (cover: PortCover) => void;
}

const queue: Job[] = [];
let active = 0;
const MAX_CONCURRENT = 8;
const PREFETCH_CHUNK = 24;

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    active += 1;
    invoke<PortCover>("get_port_cover", { name: job.name })
      .then((cover) => cover ?? EMPTY)
      .catch(() => EMPTY)
      .then((cover) => {
        // A batch may have answered this name while the request was in flight;
        // keep that result instead of overwriting it with a slower duplicate.
        const settled = covers.get(job.name) ?? cover;
        if (!covers.has(job.name)) covers.set(job.name, cover);
        inflight.delete(job.name);
        job.resolve(settled);
      })
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

/**
 * Store a cover that arrived from the batch command and hand it to whoever is
 * already waiting for that name: queued jobs are answered and dropped so they
 * never reach the per-name command.
 */
function settleCover(name: string, cover: PortCover): void {
  covers.set(name, cover);
  inflight.delete(name);
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const job = queue[index];
    if (job.name !== name) continue;
    queue.splice(index, 1);
    job.resolve(cover);
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

/**
 * Warm the cache for a page of cards in one IPC round trip.
 *
 * Names already cached (or already in a batch) are dropped, the rest go through
 * `get_port_covers` in chunks of 24. Fire-and-forget: a failed chunk leaves the
 * cards to their own lazy request, and negative results are cached like hits.
 */
export function prefetchPortCovers(names: string[]): void {
  const cold: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (covers.has(name) || prefetching.has(name)) continue;
    cold.push(name);
  }

  for (let offset = 0; offset < cold.length; offset += PREFETCH_CHUNK) {
    const chunk = cold.slice(offset, offset + PREFETCH_CHUNK);
    for (const name of chunk) prefetching.add(name);
    void invoke<Record<string, PortCover>>("get_port_covers", { names: chunk })
      .then((result) => {
        if (!result) return;
        for (const [name, cover] of Object.entries(result)) {
          if (cover) settleCover(name.trim(), cover);
        }
      })
      .catch(() => {
        // Offline or provider down: the card's own request will retry later.
      })
      .finally(() => {
        for (const name of chunk) prefetching.delete(name);
      });
  }
}

/** Cached cover, for a modal that opens on an already-visible card. */
export function peekPortCover(name: string): PortCover | null {
  return covers.get(name.trim()) ?? null;
}

export interface UsePortCoverOptions {
  /** Defaults to true; cards pass their reveal state. */
  enabled?: boolean;
  /** Art supplied by the catalog source; skips the provider lookup. */
  initialUrl?: string | null;
}

export function usePortCover(
  name: string | null,
  options: UsePortCoverOptions = {},
): PortCover | null {
  const { enabled = true, initialUrl = null } = options;
  const direct = initialUrl?.trim() || null;

  // Source-supplied art needs no IPC: present it as a normal cover shape so
  // callers keep one type. No fallbackUrl - there is nothing to retry against.
  const synthetic = useMemo<PortCover | null>(
    () => (direct ? { url: direct, thumbUrl: direct, fallbackUrl: null, source: null } : null),
    [direct],
  );

  const [cover, setCover] = useState<PortCover | null>(() =>
    direct ? null : name ? peekPortCover(name) : null,
  );

  useEffect(() => {
    if (direct) return;
    const key = name?.trim() ?? "";
    if (!key) {
      setCover(null);
      return;
    }
    const cached = peekPortCover(key);
    if (cached) {
      setCover(cached);
      return;
    }
    if (!enabled) {
      setCover(null);
      return;
    }
    let mounted = true;
    void requestPortCover(key).then((next) => {
      if (mounted) setCover(next);
    });
    return () => {
      mounted = false;
    };
  }, [name, enabled, direct]);

  return direct ? synthetic : cover;
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
