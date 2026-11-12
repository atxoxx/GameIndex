/**
 * Feature-local cache for store extras, CrackWatch and Playtester feeds.
 *
 * The Rust build kept these in the SQLite KV store. This wave uses a single
 * JSON document (allowed for feature-local caches) with the same freshness
 * model:
 *
 *  • fresh entries are served inside the caller's TTL,
 *  • stale entries survive and can be returned when an upstream outage makes
 *    a fresh read impossible (`staleOnError`),
 *  • explicit negative results (`null`) are cached just like data, so a title
 *    the provider does not know is not re-scraped on every render.
 *
 * File: `<userData>/extras-cache.json`.
 */
import { createJsonStore } from "../../state/jsonStore";

interface CacheEnvelope {
  at: number;
  value: unknown;
}

interface CacheDocument {
  version: number;
  entries: Record<string, CacheEnvelope>;
}

const MAX_ENTRIES = 800;

const store = createJsonStore<CacheDocument>(
  "extras-cache.json",
  () => ({ version: 1, entries: {} }),
  (value) => ({
    version: 1,
    entries:
      value.entries && typeof value.entries === "object" && !Array.isArray(value.entries)
        ? (value.entries as Record<string, CacheEnvelope>)
        : {},
  }),
);

export interface CacheHit<T> {
  value: T;
  at: number;
}

/** Any stored entry, fresh or stale. `undefined` means "never cached". */
export function cacheLookup<T>(key: string): CacheHit<T> | undefined {
  const entry = store.read().entries[key];
  if (!entry || typeof entry.at !== "number") return undefined;
  return { value: entry.value as T, at: entry.at };
}

export function cacheStore(key: string, value: unknown): void {
  const doc = store.read();
  doc.entries[key] = { at: Date.now(), value };
  const keys = Object.keys(doc.entries);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => (doc.entries[a]?.at ?? 0) - (doc.entries[b]?.at ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((stale) => delete doc.entries[stale]);
  }
  store.write(doc);
}

/**
 * Read-through cache. On a loader failure the most recent stale value is
 * returned when `staleOnError` is set; otherwise the loader error propagates
 * so the renderer can show a real failure instead of fabricated data.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  options: { staleOnError?: boolean } = {},
): Promise<T> {
  const hit = cacheLookup<T>(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const value = await loader();
    cacheStore(key, value);
    return value;
  } catch (error) {
    if (options.staleOnError && hit) return hit.value;
    throw error;
  }
}

export const EXTRA_TTL = {
  /** Steam store page features (rarely change after launch). */
  steamFeatures: 24 * 60 * 60_000,
  /** Steam pc_requirements. */
  steamRequirements: 24 * 60 * 60_000,
  /** Steam localized about copy + trailers. */
  steamAbout: 6 * 60 * 60_000,
  /** CrackWatch status, matching the Rust KV TTL. */
  crackwatch: 24 * 60 * 60_000,
  /** Playtester listing pages. */
  playtesterFeed: 15 * 60_000,
  /** Playtester detail pages. */
  playtesterDetail: 60 * 60_000,
  /** Playtester category sitemap. */
  playtesterCategories: 6 * 60 * 60_000,
  /** IGDB relation graphs (metered upstream). */
  igdbRelations: 6 * 60 * 60_000,
  /** IGDB collection members. */
  igdbCollection: 6 * 60 * 60_000,
} as const;
