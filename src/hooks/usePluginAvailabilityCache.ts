import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../types/game";
import type { PluginAvailabilityHit, PluginInfo } from "../types/plugins";

/**
 * Each game's probe fans out to every enabled plugin on the Rust side, and
 * the sandbox's per-host rate limiter paces the actual requests. Two games
 * in flight keeps a filter toggle from opening dozens of requests at once.
 */
const MAX_CONCURRENT = 2;

/** FIFO cap so a long browsing session cannot grow the map unbounded. */
const MAX_AVAILABILITY_ENTRIES = 500;

/**
 * Persisted probes age out faster than the source cache: plugin indexes gain
 * releases constantly, so a week-old "no match" is mostly noise.
 */
const PLUGIN_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Per-plugin membership for a single game. */
export type PluginAvailability = Map<string, boolean>;
export type PluginAvailabilityMap = Map<string, PluginAvailability>;

interface StoredPluginCache {
  savedAt: number;
  games: Record<string, Record<string, boolean>>;
}

const EMPTY_AVAILABILITY: PluginAvailabilityMap = new Map();

const CATEGORY_ORDER: Record<string, number> = {
  pc: 0,
  hybrid: 1,
  console: 2,
};

function sortPlugins(list: PluginInfo[]): PluginInfo[] {
  return [...list].sort((a, b) => {
    const rank =
      (CATEGORY_ORDER[a.platformCategory ?? "pc"] ?? 0) -
      (CATEGORY_ORDER[b.platformCategory ?? "pc"] ?? 0);
    return rank !== 0 ? rank : a.name.localeCompare(b.name);
  });
}

function trimAvailability(prev: PluginAvailabilityMap): PluginAvailabilityMap {
  if (prev.size <= MAX_AVAILABILITY_ENTRIES) {
    return new Map(prev);
  }
  const next: PluginAvailabilityMap = new Map();
  let toSkip = prev.size - MAX_AVAILABILITY_ENTRIES;
  for (const [k, v] of prev) {
    if (toSkip > 0) {
      toSkip -= 1;
      continue;
    }
    next.set(k, v);
  }
  return next;
}

function serialize(map: PluginAvailabilityMap): string {
  const games: Record<string, Record<string, boolean>> = {};
  for (const [slug, inner] of map) {
    const entry: Record<string, boolean> = {};
    for (const [pid, val] of inner) entry[pid] = val;
    games[slug] = entry;
  }
  const payload: StoredPluginCache = { savedAt: Date.now(), games };
  return JSON.stringify(payload);
}

function deserialize(raw: string | null): PluginAvailabilityMap {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPluginCache>;
    if (!parsed.games || typeof parsed.savedAt !== "number") return new Map();
    if (Date.now() - parsed.savedAt > PLUGIN_CACHE_TTL_MS) return new Map();
    const map: PluginAvailabilityMap = new Map();
    for (const [slug, inner] of Object.entries(parsed.games)) {
      const entry = new Map<string, boolean>();
      for (const [pid, val] of Object.entries(inner)) {
        if (typeof val === "boolean") entry.set(pid, val);
      }
      map.set(slug, entry);
    }
    return map;
  } catch {
    return new Map();
  }
}

export interface UsePluginAvailabilityCacheResult {
  /** Enabled plugins, ordered PC → hybrid → console, then by name. */
  plugins: PluginInfo[];
  /** `games` narrowed to entries matching the selected plugins. */
  visibleGames: StoreGameSummary[];
  /** Number of game probes currently in flight. */
  pending: number;
  /** True when the user has selected at least one plugin to filter by. */
  isFilterActive: boolean;
  /** Per-plugin counts over the current `games` list (checked / available). */
  pluginCounts: Record<string, { checked: number; available: number }>;
  /** Plugin id → last probe error, for plugins that could not be checked. */
  pluginErrors: Record<string, string>;
  /** Enabled plugins currently reporting a probe error. */
  uncheckedPlugins: number;
  /** Set when the last probe call itself failed (not a per-plugin error). */
  probeError: string | null;
  /**
   * Games that at least one enabled plugin has a hit for, with the number
   * of matching plugins. Feeds the card badge while the filter is active.
   */
  availableSlugs: Map<string, number>;
}

/**
 * Deferred, disk-cached per-game plugin availability.
 *
 * Like `useSourceAvailabilityCache`, this does nothing during ordinary
 * browsing: probes start only when at least one plugin is selected, run
 * through a capped worker pool over the loaded games, and are persisted so
 * revisits are instant. Each probe is one `plugins_check_availability`
 * call per game — the Rust side runs every enabled plugin concurrently and
 * reports hits per plugin, including the plugins that found nothing.
 *
 * A game with no cached entry is excluded while the filter is active, so
 * results fill in progressively as probes land.
 */
export function usePluginAvailabilityCache(
  games: StoreGameSummary[],
  selectedPluginIds: string[],
  matchMode: "all" | "any" = "all"
): UsePluginAvailabilityCacheResult {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [availability, setAvailability] = useState<PluginAvailabilityMap>(
    EMPTY_AVAILABILITY
  );
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({});
  const [probeError, setProbeError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  const inFlightRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const availabilityRef = useRef<PluginAvailabilityMap>(availability);
  useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);

  // ── Enabled plugin inventory (drives the filter UI) ──────────────────
  useEffect(() => {
    let cancelled = false;
    invoke<PluginInfo[]>("plugins_list")
      .then((list) => {
        if (cancelled) return;
        setPlugins(sortPlugins(list.filter((p) => p.enabled)));
      })
      .catch(() => {
        /* Settings → Plugins surfaces the real error. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleSave = useRef((map: PluginAvailabilityMap) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      invoke("save_plugin_availability_cache", { data: serialize(map) }).catch(
        () => {
          /* best-effort persistence */
        }
      );
    }, 800);
  }).current;

  useEffect(() => {
    invoke<string>("load_plugin_availability_cache")
      .then((raw) => {
        const parsed = deserialize(raw);
        if (parsed.size === 0) return;
        // A probe that already landed is fresher than the disk copy: keep
        // it and only add the slugs this session has not resolved yet.
        setAvailability((prev) => {
          if (prev.size === 0) return parsed;
          const merged = new Map(prev);
          for (const [slug, entry] of parsed) {
            if (!merged.has(slug)) merged.set(slug, entry);
          }
          return merged;
        });
      })
      .catch(() => {
        /* no cache yet — start empty */
      });
  }, []);

  const gamesKey = useMemo(() => games.map((g) => g.slug).join("|"), [games]);
  const pluginIdsKey = useMemo(
    () => plugins.map((p) => p.id).join("|"),
    [plugins]
  );
  const selectedKey = useMemo(
    () => [...selectedPluginIds].sort().join("|"),
    [selectedPluginIds]
  );

  useEffect(() => {
    if (selectedPluginIds.length === 0) {
      setPending(0);
      setProbeError(null);
      return;
    }
    if (plugins.length === 0) {
      setPending(0);
      return;
    }

    const snapshotIds = plugins.map((p) => p.id);
    const idsKey = snapshotIds.join("|");

    type Task = {
      slug: string;
      name: string;
      releaseYear: number | undefined;
      aliases: string[];
      dedupeKey: string;
    };

    const tasks: Task[] = [];
    for (const game of games) {
      const dedupeKey = `${game.slug}|${idsKey}`;
      if (inFlightRef.current.has(dedupeKey)) continue;

      const gameCache = availability.get(game.slug);
      const allResolved =
        gameCache !== undefined &&
        snapshotIds.every((id) => gameCache.has(id));
      if (allResolved) continue;

      const parsedYear = game.firstReleaseDate
        ? new Date(game.firstReleaseDate).getFullYear()
        : Number.NaN;
      const releaseYear = Number.isFinite(parsedYear) ? parsedYear : undefined;

      tasks.push({
        slug: game.slug,
        name: game.name,
        releaseYear,
        aliases: game.alternativeNames ?? [],
        dedupeKey,
      });
    }

    if (tasks.length === 0) return;

    let cancelled = false;
    let cursor = 0;

    const persist = () => scheduleSave(availabilityRef.current);

    const applyHit = (slug: string, hits: PluginAvailabilityHit[]) => {
      const byId = new Map(hits.map((h) => [h.pluginId, h]));
      setAvailability((prev) => {
        const next = trimAvailability(prev);
        const entry = new Map(next.get(slug) ?? []);
        for (const id of snapshotIds) {
          const hit = byId.get(id);
          entry.set(id, hit ? hit.matches > 0 : false);
        }
        next.set(slug, entry);
        return next;
      });
      setPluginErrors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const hit of hits) {
          if (hit.error) {
            if (next[hit.pluginId] !== hit.error) {
              next[hit.pluginId] = hit.error;
              changed = true;
            }
          } else if (next[hit.pluginId] !== undefined) {
            delete next[hit.pluginId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setProbeError(null);
      persist();
    };

    const markUnavailable = (slug: string) => {
      setAvailability((prev) => {
        const next = trimAvailability(prev);
        const entry = new Map(next.get(slug) ?? []);
        for (const id of snapshotIds) entry.set(id, false);
        next.set(slug, entry);
        return next;
      });
      persist();
    };

    const worker = async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelled) return;
        if (cursor >= tasks.length) return;
        const task = tasks[cursor++];

        setPending((p) => p + 1);

        try {
          if (cancelled) return;
          const hits = await invoke<PluginAvailabilityHit[]>(
            "plugins_check_availability",
            {
              query: task.name,
              releaseYear: task.releaseYear ?? null,
              aliases: task.aliases,
            }
          );
          if (cancelled) return;
          applyHit(task.slug, hits);
        } catch (err) {
          if (cancelled) return;
          console.warn(
            `[usePluginAvailabilityCache] probe failed for ${task.slug}:`,
            err
          );
          markUnavailable(task.slug);
          setProbeError(typeof err === "string" ? err : String(err));
        } finally {
          inFlightRef.current.delete(task.dedupeKey);
          setPending((p) => Math.max(0, p - 1));
        }
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      workers.push(worker());
    }
    void Promise.allSettled(workers);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamesKey, selectedKey, pluginIdsKey]);

  const visibleGames = useMemo(() => {
    // With no plugin inventory (still loading, or `plugins_list` failed)
    // there is nothing to match against — show the catalogue rather than an
    // empty page caused by a restored selection.
    if (selectedPluginIds.length === 0 || plugins.length === 0) return games;

    return games.filter((game) => {
      const cache = availability.get(game.slug);
      if (!cache) return false;
      if (matchMode === "any") {
        return selectedPluginIds.some((id) => cache.get(id) === true);
      }
      return selectedPluginIds.every((id) => cache.get(id) === true);
    });
  }, [games, plugins, selectedPluginIds, matchMode, availability, gamesKey]);

  const pluginCounts = useMemo(() => {
    const counts: Record<string, { checked: number; available: number }> = {};
    for (const game of games) {
      const entry = availability.get(game.slug);
      if (!entry) continue;
      for (const [pid, val] of entry) {
        const rec = counts[pid] ?? { checked: 0, available: 0 };
        rec.checked += 1;
        if (val === true) rec.available += 1;
        counts[pid] = rec;
      }
    }
    return counts;
  }, [games, availability]);

  const availableSlugs = useMemo(() => {
    const out = new Map<string, number>();
    for (const game of games) {
      const entry = availability.get(game.slug);
      if (!entry) continue;
      let hits = 0;
      for (const val of entry.values()) if (val) hits += 1;
      if (hits > 0) out.set(game.slug, hits);
    }
    return out;
  }, [games, availability]);

  const uncheckedPlugins = useMemo(() => {
    let count = 0;
    for (const plugin of plugins) {
      if (pluginErrors[plugin.id]) count += 1;
    }
    return count;
  }, [plugins, pluginErrors]);

  return useMemo(
    () => ({
      plugins,
      visibleGames,
      pending,
      isFilterActive: selectedPluginIds.length > 0,
      pluginCounts,
      pluginErrors,
      uncheckedPlugins,
      probeError,
      availableSlugs,
    }),
    [
      plugins,
      visibleGames,
      pending,
      selectedPluginIds,
      pluginCounts,
      pluginErrors,
      uncheckedPlugins,
      probeError,
      availableSlugs,
    ]
  );
}
