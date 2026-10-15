import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CacheCheckStatus, DisplayMatch } from "./types";
import {
  cacheCapableProvider,
  cacheKeyFor,
  cacheMagnetFor,
  getSessionCache,
  setSessionCache,
} from "./cacheCheck";

/** Debrid cache APIs are rate-limited; keep a small in-flight pool. */
const CACHE_CONCURRENCY = 3;

interface CacheJob {
  id: string;
  key: string;
  magnet: string;
}

/** Identical in-flight probes are shared so duplicate releases in the
 *  list cost one API call, not one per row. */
const inflight = new Map<string, Promise<boolean>>();

function probeCache(
  provider: string,
  apikey: string,
  key: string,
  magnet: string,
): Promise<boolean> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const task = invoke<{ cached: boolean }>("debrid_check_cache", {
    provider,
    apikey,
    magnet,
  })
    .then((res) => res.cached)
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, task);
  return task;
}

/**
 * Probes every result that carries a magnet (or a bare infohash) for
 * debrid instant availability, whenever a cache-capable provider is
 * configured. Returns a per-match status map; results without a
 * checkable URI are simply absent from it.
 */
export function useRowCacheChecks({
  matches,
  provider,
  apikey,
  enabled,
}: {
  matches: DisplayMatch[];
  provider: string;
  apikey: string;
  enabled: boolean;
}): Map<string, CacheCheckStatus> {
  const active = enabled && cacheCapableProvider(provider) && Boolean(apikey);

  const jobs = useMemo<CacheJob[]>(() => {
    if (!active) return [];
    const list: CacheJob[] = [];
    const seenIds = new Set<string>();
    for (const m of matches) {
      if (seenIds.has(m.id)) continue;
      const magnet = cacheMagnetFor(m);
      if (!magnet) continue;
      const key = cacheKeyFor(provider, m);
      if (!key) continue;
      seenIds.add(m.id);
      list.push({ id: m.id, key, magnet });
    }
    return list;
  }, [matches, provider, active]);

  // A signature keeps the probe effect from restarting on match objects
  // that changed identity without changing the work to be done.
  const signature = useMemo(
    () => jobs.map((j) => `${j.id}\u0000${j.key}`).join("\u0001"),
    [jobs],
  );
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const [statuses, setStatuses] = useState<Map<string, CacheCheckStatus>>(
    () => new Map(),
  );
  const generationRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setStatuses(new Map());
      return;
    }

    const generation = ++generationRef.current;
    const current = jobsRef.current;

    const seeded = new Map<string, CacheCheckStatus>();
    const pending: CacheJob[] = [];
    for (const job of current) {
      const cached = getSessionCache(job.key);
      if (cached === undefined) {
        seeded.set(job.id, "checking");
        pending.push(job);
      } else {
        seeded.set(job.id, cached ? "cached" : "uncached");
      }
    }
    setStatuses(seeded);
    if (pending.length === 0) return;

    let cancelled = false;
    const apply = (id: string, status: CacheCheckStatus) => {
      if (cancelled || generation !== generationRef.current) return;
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(id, status);
        return next;
      });
    };

    const runOne = async (job: CacheJob) => {
      const known = getSessionCache(job.key);
      if (known !== undefined) {
        apply(job.id, known ? "cached" : "uncached");
        return;
      }
      try {
        const cached = await probeCache(provider, apikey, job.key, job.magnet);
        setSessionCache(job.key, cached);
        apply(job.id, cached ? "cached" : "uncached");
      } catch (err) {
        console.debug("[useRowCacheChecks] cache check failed:", err);
        apply(job.id, "error");
      }
    };

    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < pending.length) {
        const job = pending[cursor++];
        await runOne(job);
      }
    };
    const pool = Array.from(
      { length: Math.min(CACHE_CONCURRENCY, pending.length) },
      () => worker(),
    );
    void Promise.all(pool);

    return () => {
      cancelled = true;
    };
  }, [signature, active, provider, apikey]);

  return statuses;
}
