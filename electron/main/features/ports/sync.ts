/**
 * Catalog sync: run every site adapter, cache each source's normalized rows,
 * then merge them into one list.
 *
 * Policy: the renderer gets the last merged catalog instantly and a background
 * refresh runs when it is old. Each source snapshot is reused for 12 hours, so
 * a refresh only hits the sites that are actually stale. If a source fails, its
 * last snapshot is reused and the catalog is flagged `stale`.
 */
import fs from "node:fs";
import path from "node:path";

import { cachePath } from "../../lib/paths";
import {
  PORT_SOURCES,
  PORT_SOURCE_PRIORITY,
  type PortSourceId,
  type PortSourceProject,
  type PortSourceSummary,
  type PortsCatalog,
  type PortsSyncProgress,
} from "../../../../src/types/port";
import { mergePortSources } from "./merge/merge";
import { fetchPcgamingwikiProjects } from "./sources/pcgamingwiki";
import { fetchRecompfyiProjects } from "./sources/recompfyi";
import { fetchUnbakedProjects } from "./sources/unbaked";
import { fetchDecompsProjects } from "./sources/decomps";
import { fetchGameportProjects } from "./sources/gameport";

const SNAPSHOT_VERSION = 2;
const SOURCE_TTL_MS = 12 * 60 * 60_000;
/** A freshly merged catalog is not rebuilt again for this long. */
const MIN_REFRESH_MS = 60 * 60_000;

interface SourceSnapshot {
  version: number;
  fetchedAt: number;
  projects: PortSourceProject[];
}

interface MergedCache extends PortsCatalog {
  version: number;
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

let memory: PortsCatalog | null = null;
let inFlight: Promise<PortsCatalog> | null = null;
let progress: PortsSyncProgress = {
  active: false,
  current: null,
  done: 0,
  total: 0,
  merged: 0,
  startedAt: null,
};

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
  if (!cached || cached.version !== SNAPSHOT_VERSION) return null;
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
  writeJson(catalogFile(), { ...catalog, version: SNAPSHOT_VERSION } satisfies MergedCache);
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

async function runSync(force: boolean): Promise<PortsCatalog> {
  progress = {
    active: true,
    current: null,
    done: 0,
    total: 0,
    merged: 0,
    startedAt: Date.now(),
  };

  const rows: PortSourceProject[] = [];
  const summaries: PortSourceSummary[] = [];
  let stale = false;

  for (const id of PORT_SOURCE_PRIORITY) {
    const meta = PORT_SOURCES[id];
    const cached = readSnapshot(id);
    const fresh = cached && Date.now() - cached.fetchedAt < SOURCE_TTL_MS;

    if (!force && fresh) {
      rows.push(...cached.projects);
      summaries.push({
        id,
        name: meta.name,
        url: meta.url,
        count: cached.projects.length,
        ok: true,
        fetchedAt: cached.fetchedAt,
      });
      continue;
    }

    progress.current = id;
    progress.done = 0;
    progress.total = 0;
    try {
      const projects = await fetchSource(id, (done, total) => {
        progress.done = done;
        progress.total = total;
      });
      const fetchedAt = Date.now();
      writeJson(sourceFile(id), {
        version: SNAPSHOT_VERSION,
        fetchedAt,
        projects,
      } satisfies SourceSnapshot);
      rows.push(...projects);
      summaries.push({
        id,
        name: meta.name,
        url: meta.url,
        count: projects.length,
        ok: true,
        fetchedAt,
      });
    } catch (error) {
      stale = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ports] ${id} failed:`, message);
      if (cached) rows.push(...cached.projects);
      summaries.push({
        id,
        name: meta.name,
        url: meta.url,
        count: cached?.projects.length ?? 0,
        ok: false,
        error: message,
        fetchedAt: cached?.fetchedAt ?? 0,
      });
    }
  }

  progress.current = null;
  const projects = mergePortSources(rows);
  const catalog: PortsCatalog = {
    source: `Merged from ${summaries.map((summary) => summary.name).join(", ")}`,
    fetchedAt: Date.now(),
    stale,
    projects,
    sources: summaries,
  };
  progress.merged = projects.length;
  memory = catalog;
  writeMerged(catalog);
  return catalog;
}

/** Last merged catalog, without touching the network. */
export function getPortsCatalog(): PortsCatalog {
  if (!memory) memory = readMerged() ?? EMPTY_CATALOG;
  return { ...memory, syncing: inFlight !== null };
}

export function getPortsSyncProgress(): PortsSyncProgress {
  return { ...progress, active: inFlight !== null || progress.active };
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
    progress = { ...progress, active: false, current: null };
  });
  return inFlight;
}
