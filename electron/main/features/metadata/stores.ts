/**
 * Small metadata workstream stores shared with other screens:
 *
 *   `fetch_url`         — CORS-free text GET used by the news feed reader
 *   `save/load_store_cache` — the Store browser's category/detail JSON blob
 *   `save/load_source_cache` — per-game download-source availability
 *
 * The store caches are opaque strings by contract: the renderer serializes
 * and parses them, so they are persisted verbatim in the domain databases
 * (`store_cache.db` and `sources.db`; see `state/STORAGE.md`).
 */
import { readDocumentText, writeDocumentText } from "../../state/db/documents";
import { httpText } from "../../lib/http";

/** `fetch_url` — plain text fetch for RSS/Atom readers. */
export async function fetchUrlText(url: string): Promise<string> {
  const target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    throw new Error("Only http(s) feed URLs can be fetched.");
  }
  const response = await httpText(target, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
    },
    timeoutMs: 15_000,
    retries: 1,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${target}`);
  if (response.text.length > 10 * 1024 * 1024) {
    throw new Error("Feed is larger than the 10 MB limit.");
  }
  return response.text;
}

/** `save_store_cache` — validate and persist the Store JSON blob. */
export function saveStoreCache(data: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error(`Store cache is not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Store cache must be a JSON object.");
  }
  writeDocumentText("store_cache", "store_cache", data);
}

/** `load_store_cache` — the persisted blob, or "" when the cache is cold. */
export function loadStoreCache(): string {
  const raw = readDocumentText("store_cache", "store_cache", "");
  if (!raw) return "";
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return "";
  }
}

/** `save_source_cache` — opaque per-game availability map. */
export function saveSourceCache(data: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error(`Source cache is not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Source cache must be a JSON object.");
  }
  writeDocumentText("sources", "source_cache", data);
}

/** `load_source_cache` — "" on first run, matching the Rust contract. */
export function loadSourceCache(): string {
  return readDocumentText("sources", "source_cache", "");
}
