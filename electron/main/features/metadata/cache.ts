/**
 * Metadata workstream cache.
 *
 * Providers are billed (IGDB, SteamGridDB, OpenCritic RapidAPI) or rate
 * limited (HLTB, CheapShark, MapGenie), so every read goes through this
 * two-tier cache:
 *
 *   memory  -> survives until the process exits, avoids disk I/O per call
 *   disk    -> `<userData>/cache/metadata/<namespace>.json`, survives restarts
 *
 * Values are stored with the wall-clock time they were written and are only
 * served while younger than their namespace TTL. A `null` value is a cached
 * negative ("provider says this game has no art"), which matters just as much
 * as a hit: without it a grid of unmatched cards would re-query on every
 * paint.
 */
import fs from "node:fs";
import path from "node:path";

import { cachePath } from "../../lib/paths";

interface Envelope {
  updatedAt: number;
  value: unknown;
}

const memory = new Map<string, Envelope>();
const MAX_DISK_ENTRIES = 4000;

function diskFile(namespace: string): string {
  return cachePath("metadata", `${namespace}.json`);
}

let loadedNamespace: string | null = null;
let disk: Record<string, Envelope> = {};

function loadNamespace(namespace: string): void {
  if (loadedNamespace === namespace) return;
  loadedNamespace = namespace;
  disk = {};
  try {
    const raw = fs.readFileSync(diskFile(namespace), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      disk = parsed as Record<string, Envelope>;
    }
  } catch {
    // Missing or corrupt cache: start empty. Never block a command on it.
  }
}

function persistNamespace(namespace: string): void {
  const file = diskFile(namespace);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(disk), "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    console.warn(`[metadata-cache] could not persist ${namespace}:`, error);
  }
}

function keyOf(namespace: string, key: string): string {
  return `${namespace}|${key}`;
}

/** Synchronous cache read (used where a command must answer instantly). */
export function cacheGet<T>(namespace: string, key: string, ttlMs: number): T | undefined {
  const fullKey = keyOf(namespace, key);
  const hit = memory.get(fullKey);
  if (hit) {
    if (Date.now() - hit.updatedAt < ttlMs) return hit.value as T;
    memory.delete(fullKey);
    return undefined;
  }
  loadNamespace(namespace);
  const diskHit = disk[key];
  if (!diskHit) return undefined;
  if (Date.now() - diskHit.updatedAt >= ttlMs) return undefined;
  memory.set(fullKey, diskHit);
  return diskHit.value as T;
}

export function cacheSet(namespace: string, key: string, value: unknown): void {
  const envelope: Envelope = { updatedAt: Date.now(), value };
  memory.set(keyOf(namespace, key), envelope);
  if (memory.size > 8000) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  loadNamespace(namespace);
  disk[key] = envelope;
  const keys = Object.keys(disk);
  if (keys.length > MAX_DISK_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - MAX_DISK_ENTRIES)) {
      delete disk[stale];
    }
  }
  persistNamespace(namespace);
}

/** Read-through cache. A provider miss (`null`) is cached like any value. */
export async function cached<T>(
  namespace: string,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(namespace, key, ttlMs);
  if (hit !== undefined) return hit;
  const value = await loader();
  cacheSet(namespace, key, value);
  return value;
}

/** Drop one entry (used when a user explicitly re-resolves artwork). */
export function cacheDelete(namespace: string, key: string): void {
  memory.delete(keyOf(namespace, key));
  loadNamespace(namespace);
  if (key in disk) {
    delete disk[key];
    persistNamespace(namespace);
  }
}

export const TTL = {
  /** Live Steam player counts. */
  playerCount: 60_000,
  /** Static Steam appdetails payloads. */
  steamDetails: 24 * 60 * 60_000,
  /** Steam review aggregates. */
  steamReviews: 60 * 60_000,
  /** Steam player history (steamcharts is one request per appid). */
  playerHistory: 6 * 60 * 60_000,
  /** Store catalogue pages and spotlight rails. */
  storePage: 6 * 60 * 60_000,
  /** IGDB game rows / searches. */
  igdb: 24 * 60 * 60_000,
  /** SteamGridDB artwork (community art rarely churns). */
  sgdb: 7 * 24 * 60 * 60_000,
  /** HowLongToBeat stats. */
  hltb: 12 * 60 * 60_000,
  /** Metacritic/OpenCritic score summaries. */
  scores: 24 * 60 * 60_000,
  /** CheapShark prices. */
  price: 6 * 60 * 60_000,
  /** ITAD deals / giveaways / Game Pass catalogue. */
  deals: 15 * 60_000,
  /** Map provider catalogues (into the on-disk index). */
  mapIndex: 24 * 60 * 60_000,
  /** Resolved map lookup for one title. */
  mapLookup: 24 * 60 * 60_000,
  /** LaunchBox media lists. */
  launchbox: 24 * 60 * 60_000,
  /** ProtonDB summaries. */
  protondb: 12 * 60 * 60_000,
} as const;
