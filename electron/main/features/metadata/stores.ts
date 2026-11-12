/**
 * Small metadata workstream stores shared with other screens:
 *
 *   `fetch_url`         — CORS-free text GET used by the news feed reader
 *   `save/load_store_cache` — the Store browser's category/detail JSON blob
 *   `save/load_source_cache` — per-game download-source availability
 *
 * The store caches are opaque strings by contract: the renderer serializes
 * and parses them, so they are persisted verbatim.
 */
import fs from "node:fs";
import path from "node:path";

import { userDataPath } from "../../lib/paths";
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

function writeText(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, file);
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw new Error(`Failed to read ${path.basename(file)}: ${(error as Error).message}`);
  }
}

function storeCacheFile(): string {
  return userDataPath("store_cache.json");
}

function sourceCacheFile(): string {
  return userDataPath("source_cache.json");
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
  writeText(storeCacheFile(), data);
}

/** `load_store_cache` — the persisted blob, or "" when the cache is cold. */
export function loadStoreCache(): string {
  const raw = readText(storeCacheFile());
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
  writeText(sourceCacheFile(), data);
}

/** `load_source_cache` — "" on first run, matching the Rust contract. */
export function loadSourceCache(): string {
  return readText(sourceCacheFile());
}
