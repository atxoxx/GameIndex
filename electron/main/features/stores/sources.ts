/**
 * Custom download sources.
 *
 * Port of `src-tauri/src/source_manager.rs` + `src-tauri/src/db/sources.rs`.
 * The Rust build persisted metadata to SQLite and indexed downloads in FTS5.
 * This wave keeps a single JSON document (`sources.json`) with the metadata and
 * each source's fetched catalogue, which is enough for CRUD, refresh, toggle
 * and offline search. The renderer's availability map keeps its own file
 * (`source_cache.json`) through `save_source_cache` / `load_source_cache`.
 *
 * Search is a pure local pass over the cached catalogues (the plugin runtime
 * is not wired into this build); when no catalogue has been fetched yet the
 * command returns `[]` and logs the reason, exactly like the "no plugin engine"
 * degradation contract.
 */
import { createJsonStore } from "../../state/jsonStore";
import { readUserDataText, writeUserDataText } from "../../state/jsonStore";
import { httpText } from "../../lib/http";
import type {
  BulkAddResult,
  GameSource,
  MatchedDownload,
  SourceDownload,
  SourceLink,
} from "../../../../src/types/source";
import { unixNow } from "./types";

const NEW_SOURCE_WINDOW_SECS = 7 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 15_000;
const SEARCH_SCORE_FLOOR = 0.2;

interface CachedSourceEntry {
  fetchedAt: number;
  data: GameSource;
}

interface SourcesDocument {
  version: number;
  sources: SourceLink[];
  cache: Record<string, CachedSourceEntry>;
}

const sourcesStore = createJsonStore<SourcesDocument>(
  "sources.json",
  () => ({ version: 1, sources: [], cache: {} }),
  (value) => ({
    version: 1,
    sources: Array.isArray(value.sources)
      ? value.sources.filter(
          (source): source is SourceLink =>
            !!source && typeof source.id === "string" && typeof source.url === "string",
        )
      : [],
    cache:
      value.cache && typeof value.cache === "object" ? value.cache : {},
  }),
);

let sourceCounter = 0;

function nextSourceId(): string {
  sourceCounter += 1;
  return `src_${Date.now()}_${sourceCounter}`;
}

/** `sources_list`: persisted metadata, name-ordered like the Rust DAO. */
export function listSources(): SourceLink[] {
  return [...sourcesStore.read().sources].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

function writeSources(
  mutate: (document: SourcesDocument) => SourcesDocument,
): void {
  sourcesStore.update(mutate);
}

function deriveNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "Source";
    const stem = last.replace(/\.json$/i, "").replace(/[-_]+/g, " ").trim();
    if (!stem) return "Source";
    return stem
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  } catch {
    return "Source";
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Tolerant parse of the source JSON (`fileSize`/`filesize`, `uploadDate`, …). */
export function parseGameSource(raw: string): GameSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Source JSON parse failed — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Source JSON must be an object with `name` and `downloads`.");
  }
  const document = parsed as Record<string, unknown>;
  const downloadsRaw = Array.isArray(document.downloads) ? document.downloads : [];
  const downloads: SourceDownload[] = [];
  for (const entry of downloadsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const title = asString(row.title).trim();
    if (!title) continue;
    const uris = Array.isArray(row.uris)
      ? row.uris.filter((uri): uri is string => typeof uri === "string" && uri.trim() !== "")
      : [];
    const uploadDateRaw =
      asString(row.uploadDate) || asString(row.uploaddate) || asString(row.upload_date);
    const magnet = asString(row.magnet).trim();
    downloads.push({
      title,
      fileSize:
        asString(row.fileSize) || asString(row.filesize) || asString(row.file_size),
      uris,
      uploadDate: uploadDateRaw || undefined,
      magnet: magnet || undefined,
    });
  }

  return {
    name: asString(document.name).trim() || "Source",
    downloads,
  };
}

async function fetchSource(url: string): Promise<GameSource> {
  const response = await httpText(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    retries: 1,
    headers: { accept: "application/json,text/plain,*/*" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from the source URL.`);
  }
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/html")) {
    throw new Error(
      "The source URL returned HTML (likely a Cloudflare challenge) instead of JSON.",
    );
  }
  return parseGameSource(response.text);
}

function cacheSource(id: string, data: GameSource, fetchedAt: number): void {
  writeSources((document) => ({
    ...document,
    cache: { ...document.cache, [id]: { fetchedAt, data } },
    sources: document.sources.map((source) =>
      source.id === id
        ? {
            ...source,
            lastFetched: fetchedAt,
            gameCount: data.downloads.length,
          }
        : source,
    ),
  }));
}

/** `sources_add`: validate, fetch and persist one source. */
export async function addSource(url: string, name: string): Promise<SourceLink> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("Source URL is empty.");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Source URL must start with http:// or https://.");
  }
  if (sourcesStore.read().sources.some((source) => source.url === trimmed)) {
    throw new Error("This source URL has already been added.");
  }

  const gameSource = await fetchSource(trimmed);
  const now = unixNow();
  const source: SourceLink = {
    id: nextSourceId(),
    url: trimmed,
    name: name.trim() || deriveNameFromUrl(trimmed),
    enabled: true,
    lastFetched: now,
    gameCount: gameSource.downloads.length,
  };

  writeSources((document) => ({
    ...document,
    sources: [...document.sources, source],
    cache: { ...document.cache, [source.id]: { fetchedAt: now, data: gameSource } },
  }));
  return source;
}

/** `sources_add_bulk`: per-URL outcome, duplicates reported as skipped. */
export async function addSourcesBulk(
  urls: string[],
  names: string[],
): Promise<BulkAddResult> {
  const added: SourceLink[] = [];
  const skipped: string[] = [];
  const failed: Array<{ url: string; error: string }> = [];

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index].trim();
    if (!url) continue;
    try {
      added.push(await addSource(url, names[index] ?? ""));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already been added")) skipped.push(url);
      else failed.push({ url, error: message });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return { added, skipped, failed };
}

export function removeSource(id: string): void {
  writeSources((document) => {
    const cache = { ...document.cache };
    delete cache[id];
    return {
      ...document,
      sources: document.sources.filter((source) => source.id !== id),
      cache,
    };
  });
}

export function toggleSource(id: string): void {
  writeSources((document) => ({
    ...document,
    sources: document.sources.map((source) =>
      source.id === id ? { ...source, enabled: !source.enabled } : source,
    ),
  }));
}

export async function refreshSource(id: string): Promise<void> {
  const source = sourcesStore.read().sources.find((entry) => entry.id === id);
  if (!source) throw new Error(`Source not found: ${id}`);
  const data = await fetchSource(source.url);
  cacheSource(source.id, data, unixNow());
}

export async function refreshAllSources(): Promise<void> {
  const enabled = sourcesStore.read().sources.filter((source) => source.enabled);
  if (enabled.length === 0) return;
  let refreshed = 0;
  for (const source of enabled) {
    try {
      const data = await fetchSource(source.url);
      cacheSource(source.id, data, unixNow());
      refreshed += 1;
    } catch (error) {
      console.warn(
        `[sources] refresh ${source.id} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (refreshed === 0) {
    throw new Error(
      `Failed to refresh any of ${enabled.length} enabled source(s) — check the source URLs and network connection.`,
    );
  }
}

// ── Local search over cached catalogues ────────────────────────────────

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u00ae\u2122\u00a9]/g, "")
    .replace(/[:–—]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeTitle(value).split(/\s+/).filter(Boolean);
}

/** Bounded edit distance for a single token (used only for fuzzy credit). */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function titleSimilarity(query: string, title: string): number {
  const queryTokens = tokenize(query);
  const titleTokens = tokenize(title);
  if (queryTokens.length === 0 || titleTokens.length === 0) return 0;
  if (queryTokens.join(" ") === titleTokens.join(" ")) return 1;

  const titleSet = new Set(titleTokens);
  let matched = 0;
  for (const token of queryTokens) {
    if (titleSet.has(token)) {
      matched += 1;
    } else if (
      token.length >= 4 &&
      titleTokens.some(
        (candidate) =>
          candidate.length >= 4 &&
          (candidate.startsWith(token) ||
            token.startsWith(candidate) ||
            withinOneEdit(candidate, token)),
      )
    ) {
      matched += 0.6;
    }
  }
  return matched / queryTokens.length;
}

function countTrackerParams(uri: string): number {
  return uri
    .toLowerCase()
    .split("&")
    .filter((part) => part.startsWith("tr=") && part.length > 3).length;
}

function isBareMagnet(uri: string): boolean {
  return uri.startsWith("magnet:") && countTrackerParams(uri) === 0;
}

function isTorrentFile(uri: string): boolean {
  return uri.endsWith(".torrent") || uri.includes(".torrent?");
}

/** Merge an explicit magnet and promote the best default mirror to index 0. */
export function mergeAndPickBest(uris: string[], magnet: string | undefined): string[] {
  const merged = [...uris];
  if (magnet && !merged.includes(magnet)) merged.unshift(magnet);
  if (merged.length === 0 || !isBareMagnet(merged[0])) return merged;

  const torrentIndex = merged.findIndex(
    (uri, index) => index > 0 && isTorrentFile(uri),
  );
  const trackeredIndex =
    torrentIndex >= 0
      ? -1
      : merged.findIndex(
          (uri, index) =>
            index > 0 && uri.startsWith("magnet:") && countTrackerParams(uri) > 0,
        );
  const best = torrentIndex >= 0 ? torrentIndex : trackeredIndex;
  if (best > 0) {
    const [promoted] = merged.splice(best, 1);
    merged.unshift(promoted);
  }
  return merged;
}

/** `sources_search_game`: rank cached downloads against a game name. */
export function searchSources(query: string): MatchedDownload[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const document = sourcesStore.read();
  const enabled = document.sources.filter((source) => source.enabled);
  const cached = enabled.filter((source) => document.cache[source.id]);
  if (cached.length === 0) {
    // No catalogue has ever been fetched (or every source is disabled). The
    // plugin runtime that will execute live source search is not wired into
    // this build, so the honest answer is an empty result.
    console.info(
      "[sources] search skipped: no cached catalogue — add a source and refresh it first",
    );
    return [];
  }

  const now = unixNow();
  const matches: MatchedDownload[] = [];
  for (const source of cached) {
    const entry = document.cache[source.id];
    const isNew =
      entry.fetchedAt > 0 && now - entry.fetchedAt <= NEW_SOURCE_WINDOW_SECS;
    for (const download of entry.data.downloads) {
      const score = titleSimilarity(trimmed, download.title);
      if (score < SEARCH_SCORE_FLOOR) continue;
      const uris = mergeAndPickBest(download.uris, download.magnet);
      const resolvedMagnet = uris.find((uri) => uri.startsWith("magnet:")) ?? null;
      matches.push({
        sourceName: source.name,
        sourceId: source.id,
        title: download.title,
        fileSize: download.fileSize,
        uris,
        magnet: resolvedMagnet,
        uploadDate: download.uploadDate ?? null,
        matchScore: score,
        isNew,
      });
    }
  }

  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches;
}

// ── Renderer availability cache (`source_cache.json`) ─────────────────

export function loadSourceCacheRaw(): string {
  return readUserDataText("source_cache.json", "");
}

export function saveSourceCacheRaw(data: string): void {
  if (typeof data !== "string") {
    throw new Error("save_source_cache expects the serialised availability map.");
  }
  // The renderer owns this shape; it is only stored for the next mount, but a
  // syntax check keeps a corrupt write from silencing the filter forever.
  if (data.trim() !== "") {
    try {
      JSON.parse(data);
    } catch (error) {
      throw new Error(
        `save_source_cache could not parse the payload — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  writeUserDataText("source_cache.json", data);
}

/** Drop a source's cached catalogue (used by remove, and after a failed add). */
export function invalidateSourceCache(id: string): void {
  writeSources((document) => {
    const cache = { ...document.cache };
    delete cache[id];
    return { ...document, cache };
  });
}

export function sourcesDocumentSnapshot(): SourcesDocument {
  return sourcesStore.read();
}
