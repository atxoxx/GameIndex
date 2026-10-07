import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MetacriticScore } from "../types/game";

/**
 * useMetacriticScore
 *
 *  Fetches the Metacritic critic/user score summary for a game title.
 *  Results are cached per normalized title for the app session, and
 *  concurrent callers for the same title share one in-flight request,
 *  so opening a game page (or several) never triggers duplicate scrapes.
 *
 *  A failed lookup is cached as `null`: the Ratings card then falls back
 *  to the IGDB rating rather than retrying on every render.
 */

export interface MetacriticScoreState {
  data: MetacriticScore | null;
  loading: boolean;
}

const cache = new Map<string, MetacriticScore | null>();
const inflight = new Map<string, Promise<MetacriticScore | null>>();

function cacheKey(gameName: string): string {
  return gameName.trim().toLowerCase();
}

function loadScore(gameName: string): Promise<MetacriticScore | null> {
  const key = cacheKey(gameName);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = invoke<MetacriticScore>("fetch_metacritic_score", {
    gameName,
  })
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .catch((err) => {
      console.warn("[useMetacriticScore] fetch failed:", err);
      cache.set(key, null);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

export function useMetacriticScore(gameName: string | undefined): MetacriticScoreState {
  const [state, setState] = useState<MetacriticScoreState>(() => {
    if (!gameName) return { data: null, loading: false };
    const key = cacheKey(gameName);
    return cache.has(key)
      ? { data: cache.get(key) ?? null, loading: false }
      : { data: null, loading: true };
  });

  useEffect(() => {
    if (!gameName) {
      setState({ data: null, loading: false });
      return;
    }

    const key = cacheKey(gameName);
    if (cache.has(key)) {
      setState({ data: cache.get(key) ?? null, loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ data: prev.data, loading: true }));
    void loadScore(gameName).then((result) => {
      if (cancelled) return;
      setState({ data: result, loading: false });
    });

    return () => {
      cancelled = true;
    };
  }, [gameName]);

  return state;
}
