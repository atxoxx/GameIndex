/**
 * Catalog sync: run every site adapter, cache each source's normalized rows,
 * then merge them into one list.
 *
 * Streaming policy: the renderer gets the last merged catalog instantly and a
 * background refresh runs when it is old. Each source snapshot is reused for 12
 * hours, so a refresh only hits the sites that are actually stale. A refresh
 * starts all five sources at once (the merge priority is independent of fetch
 * order) and streams `ports:sync` events while it works:
 *
 * - `start` when the run begins;
 * - `progress` at most every ~500 ms, only when a counter changed;
 * - `source-done` after every source, carrying a catalog merged from all rows
 *   available so far, so the page can paint rows instead of waiting for the
 *   slowest site. The merged cache is written on each one, so a crash keeps the
 *   progress it already showed;
 * - `done` when every source finished.
 *
 * Every event carries an increasing `version` so the renderer can ignore ones
 * that arrive out of order. If a source fails, its last snapshot is reused and
 * the catalog is flagged `stale`; the run continues.
 */
import fs from "node:fs";
import path from "node:path";

import { cachePath } from "../../lib/paths";
import { emit } from "../../ipc";
import {
  PORT_SOURCES,
  PORT_SOURCE_PRIORITY,
  type PortSourceId,
  type PortSourceProgress,
  type PortSourceProject,
  type PortSourceSummary,
  type PortsCatalog,
  type PortsSyncEvent,
  type PortsSyncProgress,
} from "../../../../src/types/port";
import { mergePortSources } from "./merge/merge";
import { fetchPcgamingwikiProjects } from "./sources/pcgamingwiki";
import { fetchRecompfyiProjects } from "./sources/recompfyi";
import { fetchUnbakedProjects } from "./sources/unbaked";
import { fetchDecompsProjects } from "./sources/decomps";
import { fetchGameportProjects } from "./sources/gameport";

const SNAPSHOT_VERSION = 2;
/** Separate from the source snapshots so a merge change can rebuild without re-crawling. */
const MERGE_VERSION = 3;
const SOURCE_TTL_MS = 12 * 60 * 60_000;
/** A freshly merged catalog is not rebuilt again for this long. */
const MIN_REFRESH_MS = 60 * 60_000;
/** Minimum gap between `progress` events; source-done/done are never throttled. */
const PROGRESS_THROTTLE_MS = 500;

interface SourceSnapshot {
  version: number;
  fetchedAt: number;
  projects: PortSourceProject[];
}

interface MergedCache extends PortsCatalog {
  version: number;
}

/** Mutable state of one sync run; `progress` is also the module-level snapshot. */
interface RunState {
  progress: PortsSyncProgress;
  /** Rows available so far, per source. */
  rows: Map<PortSourceId, PortSourceProject[]>;
  summaries: Map<PortSourceId, PortSourceSummary>;
  stale: boolean;
  /** Last time any event carried the progress counters. */
  lastProgressAt: number;
  /** A counter changed since the last event. */
  dirty: boolean;
  /** Catalog produced by the last `source-done`, reused by `done`. */
  catalog: PortsCatalog | null;
}

const EMPTY_CATALOG: PortsCatalog = {
  source: "Merged catalog",
  fetchedAt: 0,
  stale: false,
  projects: [],
  sources: PORT_SOURCE_PRIORITY.map((id) => ({
    id,
    name: PORT_SOURCES[id].name,
    url: PORT_SOURCES[id].url,
    count: 0,
    ok: false,
    fetchedAt: 0,
  })),
};

function createProgress(startedAt: number | null): PortsSyncProgress {
  return {
    active: startedAt !== null,
    startedAt,
    merged: 0,
    sources: PORT_SOURCE_PRIORITY.map((id) => ({
      id,
      done: 0,
      total: 0,
      finished: false,
      ok: true,
    })),
  };
}

let memory: PortsCatalog | null = null;
let inFlight: Promise<PortsCatalog> | null = null;
let progress: PortsSyncProgress = createProgress(null);
/** Grows with every `ports:sync` event so the renderer can drop stale ones. */
let eventVersion = 0;

function sourceFile(id: PortSourceId): string {
  return cachePath("ports", "sources", `${id}.json`);
}

function catalogFile(): string {
  return cachePath("ports", "catalog-v2.json");
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    console.warn(`[ports] could not persist ${path.basename(file)}:`, error);
  }
}

function readSnapshot(id: PortSourceId): SourceSnapshot | null {
  const snapshot = readJson<SourceSnapshot>(sourceFile(id));
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return null;
  if (!Array.isArray(snapshot.projects)) return null;
  return snapshot;
}

function readMerged(): PortsCatalog | null {
  const cached = readJson<MergedCache>(catalogFile());
  if (!cached || cached.version !== MERGE_VERSION) return null;
  if (!Array.isArray(cached.projects) || !Array.isArray(cached.sources)) return null;
  return {
    source: cached.source,
    fetchedAt: cached.fetchedAt,
    stale: Boolean(cached.stale),
    projects: cached.projects,
    sources: cached.sources,
  };
}

function writeMerged(catalog: PortsCatalog): void {
  writeJson(catalogFile(), { ...catalog, version: MERGE_VERSION } satisfies MergedCache);
}

function cloneProgress(value: PortsSyncProgress): PortsSyncProgress {
  return { ...value, sources: value.sources.map((source) => ({ ...source })) };
}

/**
 * Push one `ports:sync` event. Electron is absent in tests and headless
 * scripts, so a failed emit must never abort a running sync.
 */
function publish(
  phase: PortsSyncEvent["phase"],
  syncing: boolean,
  catalog?: PortsCatalog,
): void {
  eventVersion += 1;
  const payload: PortsSyncEvent = {
    phase,
    version: eventVersion,
    syncing,
    progress: cloneProgress(progress),
  };
  if (catalog) payload.catalog = catalog;
  try {
    emit("ports:sync", payload);
  } catch (error) {
    console.warn("[ports] could not emit ports:sync:", error);
  }
}

function progressEntry(state: RunState, id: PortSourceId): PortSourceProgress {
  return state.progress.sources[PORT_SOURCE_PRIORITY.indexOf(id)];
}

function setSourceProgress(
  state: RunState,
  id: PortSourceId,
  patch: Partial<PortSourceProgress>,
): void {
  Object.assign(progressEntry(state, id), patch);
  state.dirty = true;
}

/** Emit a progress event if a counter changed and the throttle allows it. */
function maybePublishProgress(state: RunState): void {
  if (!state.dirty) return;
  const now = Date.now();
  if (now - state.lastProgressAt < PROGRESS_THROTTLE_MS) return;
  state.dirty = false;
  state.lastProgressAt = now;
  publish("progress", true);
}

/**
 * Merge every row collected so far, refresh the in-memory catalog and persist
 * the merged cache. Used for each live `source-done` snapshot.
 */
function currentCatalog(state: RunState): PortsCatalog {
  const rows: PortSourceProject[] = [];
  for (const id of PORT_SOURCE_PRIORITY) {
    const projects = state.rows.get(id);
    if (projects?.length) rows.push(...projects);
  }

  const projects = mergePortSources(rows);
  const sources = PORT_SOURCE_PRIORITY.map((id) => ({ ...state.summaries.get(id)! }));
  const catalog: PortsCatalog = {
    source: `Merged from ${sources.map((summary) => summary.name).join(", ")}`,
    fetchedAt: Date.now(),
    stale: state.stale,
    projects,
    sources,
  };

  state.progress.merged = projects.length;
  state.catalog = catalog;
  memory = catalog;
  writeMerged(catalog);
  return catalog;
}

/** A source finished (or fell back): stream the rows that are available now. */
function publishSourceDone(state: RunState): void {
  state.dirty = false;
  state.lastProgressAt = Date.now();
  // The run is still going, so the live catalog says so too.
  publish("source-done", true, { ...currentCatalog(state), syncing: true });
}

async function fetchSource(
  id: PortSourceId,
  onProgress: (done: number, total: number) => void,
): Promise<PortSourceProject[]> {
  switch (id) {
    case "gameport":
      return fetchGameportProjects({ onProgress: (value) => onProgress(value.done, value.total) });
    case "recompfyi":
      return fetchRecompfyiProjects();
    case "unbaked":
      return fetchUnbakedProjects({ onProgress: (value) => onProgress(value.done, value.total) });
    case "decomps":
      return fetchDecompsProjects({ onProgress: (value) => onProgress(value.done, value.total) });
    case "pcgamingwiki":
      return fetchPcgamingwikiProjects();
    default:
      return [];
  }
}

function createRunState(startedAt: number): RunState {
  const summaries = new Map<PortSourceId, PortSourceSummary>();
  for (const id of PORT_SOURCE_PRIORITY) {
    const meta = PORT_SOURCES[id];
    summaries.set(id, {
      id,
      name: meta.name,
      url: meta.url,
      count: 0,
      ok: true,
      fetchedAt: 0,
    });
  }

  const state: RunState = {
    progress: createProgress(startedAt),
    rows: new Map(),
    summaries,
    stale: false,
    lastProgressAt: startedAt,
    dirty: false,
    catalog: null,
  };
  // Start from the catalog the UI is already showing, not from zero rows.
  state.progress.merged = memory?.projects.length ?? 0;
  return state;
}

async function runSource(
  state: RunState,
  id: PortSourceId,
  cached: SourceSnapshot | null,
): Promise<void> {
  const meta = PORT_SOURCES[id];

  try {
    const projects = await fetchSource(id, (done, total) => {
      setSourceProgress(state, id, { done, total });
      maybePublishProgress(state);
    });
    const fetchedAt = Date.now();
    writeJson(sourceFile(id), {
      version: SNAPSHOT_VERSION,
      fetchedAt,
      projects,
    } satisfies SourceSnapshot);
    state.rows.set(id, projects);
    state.summaries.set(id, {
      id,
      name: meta.name,
      url: meta.url,
      count: projects.length,
      ok: true,
      fetchedAt,
    });
    setSourceProgress(state, id, {
      done: projects.length,
      total: projects.length,
      finished: true,
      ok: true,
    });
  } catch (error) {
    state.stale = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ports] ${id} failed:`, message);
    const fallback = cached?.projects ?? [];
    state.rows.set(id, fallback);
    state.summaries.set(id, {
      id,
      name: meta.name,
      url: meta.url,
      count: fallback.length,
      ok: false,
      error: message,
      fetchedAt: cached?.fetchedAt ?? 0,
    });
    setSourceProgress(state, id, {
      done: fallback.length,
      total: fallback.length,
      finished: true,
      ok: false,
      error: message,
    });
  }

  publishSourceDone(state);
}

async function runSync(force: boolean): Promise<PortsCatalog> {
  const startedAt = Date.now();
  const state = createRunState(startedAt);
  progress = state.progress;

  const pending: Array<{ id: PortSourceId; cached: SourceSnapshot | null }> = [];

  for (const id of PORT_SOURCE_PRIORITY) {
    const cached = readSnapshot(id);
    const fresh = Boolean(cached && startedAt - cached.fetchedAt < SOURCE_TTL_MS);

    if (!force && fresh && cached) {
      // A fresh snapshot is already done: no request, and its rows join the
      // first merge that runs.
      state.rows.set(id, cached.projects);
      state.summaries.set(id, {
        id,
        name: PORT_SOURCES[id].name,
        url: PORT_SOURCES[id].url,
        count: cached.projects.length,
        ok: true,
        fetchedAt: cached.fetchedAt,
      });
      setSourceProgress(state, id, {
        done: cached.projects.length,
        total: cached.projects.length,
        finished: true,
        ok: true,
      });
      continue;
    }

    pending.push({ id, cached });
  }

  publish("start", true);

  // All sources run at once; each one merges and emits on its own completion.
  await Promise.all(pending.map(({ id, cached }) => runSource(state, id, cached)));

  // The last source-done already merged every row, so it is the final catalog.
  const catalog = state.catalog ?? currentCatalog(state);
  state.progress.active = false;
  progress = state.progress;
  publish("done", false, { ...catalog, syncing: false });
  return catalog;
}

/** Last merged catalog, without touching the network. */
export function getPortsCatalog(): PortsCatalog {
  if (!memory) memory = readMerged() ?? EMPTY_CATALOG;
  return { ...memory, syncing: inFlight !== null };
}

export function getPortsSyncProgress(): PortsSyncProgress {
  const active = inFlight !== null || progress.active;
  return { ...cloneProgress(progress), active };
}

/**
 * Refresh stale sources and rebuild the merge. Concurrent calls share one run.
 * `force` bypasses both the per-source TTL and the rebuild throttle.
 */
export async function refreshPortsCatalog(force = false): Promise<PortsCatalog> {
  if (inFlight) return inFlight;

  if (!force) {
    const cached = memory ?? readMerged();
    if (cached && Date.now() - cached.fetchedAt < MIN_REFRESH_MS) {
      memory = cached;
      return cached;
    }
  }

  inFlight = runSync(force).finally(() => {
    inFlight = null;
    progress = { ...progress, active: false };
  });
  return inFlight;
}
