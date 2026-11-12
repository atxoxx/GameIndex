/**
 * Nexus Mods API client (v1 REST).
 *
 * The user's personal API key is stored in `<userData>/nexus.json` through the
 * shared JSON store. It is only ever sent in the `apikey` header — never
 * logged, echoed or included in error messages.
 *
 * Endpoints used:
 *  - `GET /v1/users/validate.json` — key check + account info.
 *  - `GET /v1/games/{domain}/mods/md5_search/{md5}.json` — identify local files.
 *  - `GET /v1/games/{domain}/mods/{id}.json` — latest published version.
 *  - `GET /v1/games/{domain}/mods/{id}/files.json` — file list.
 *  - `GET /v1/games/{domain}/mods/{id}/files/{fileId}/download_link.json` — Premium only.
 *  - `GET /v1/games/{domain}/mods/{latest_added|latest_updated|trending}.json` — browse feeds.
 */
import { createJsonStore } from "../../state/jsonStore";
import { httpJson } from "../../lib/http";
import type { NexusStatus, RemoteModFile, RemoteModSearch, RemoteModSummary } from "./types";

const API = "https://api.nexusmods.com/v1";

interface NexusKeyDocument {
  apiKey: string;
}

export const nexusKeyStore = createJsonStore<NexusKeyDocument>(
  "nexus.json",
  () => ({ apiKey: "" }),
  (value) => ({ apiKey: typeof value.apiKey === "string" ? value.apiKey : "" }),
);

export function getApiKey(): string | null {
  try {
    const key = nexusKeyStore.read().apiKey.trim();
    return key ? key : null;
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  nexusKeyStore.write({ apiKey: trimmed });
  clearPremiumCache();
}

// Validate is a network round-trip; cache the premium flag for the process.
let premiumCache: boolean | null | undefined;

export function clearPremiumCache(): void {
  premiumCache = undefined;
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, accept: "application/json" };
}

export async function validate(key: string): Promise<NexusStatus> {
  try {
    const value = await httpJson<Record<string, unknown>>(`${API}/users/validate.json`, {
      headers: authHeaders(key),
      timeoutMs: 15_000,
    });
    return {
      connected: true,
      ...(typeof value.name === "string" ? { userName: value.name } : {}),
      ...(typeof value.is_premium === "boolean" ? { isPremium: value.is_premium } : {}),
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Cached `isPremium` for the stored key; `null` when unknown/no key. */
export async function isPremiumCached(): Promise<boolean | null> {
  if (premiumCache !== undefined) return premiumCache;
  const key = getApiKey();
  if (!key) return null;
  const status = await validate(key);
  premiumCache = status.isPremium ?? null;
  return premiumCache;
}

export interface Md5Match {
  modId: number;
  modName?: string;
  author?: string;
  fileVersion?: string;
}

export async function md5Search(
  key: string,
  domain: string,
  md5: string,
): Promise<Md5Match | null> {
  const url = `${API}/games/${encodeURIComponent(domain)}/mods/md5_search/${encodeURIComponent(md5)}.json`;
  try {
    const value = await httpJson<unknown>(url, {
      headers: authHeaders(key),
      timeoutMs: 15_000,
    });
    const list = Array.isArray(value) ? value : [];
    const first = list[0] as Record<string, unknown> | undefined;
    if (!first) return null;
    const mod = (first.mod ?? {}) as Record<string, unknown>;
    const modId = typeof mod.mod_id === "number" ? mod.mod_id : null;
    if (modId === null) return null;
    const fileDetails = (first.file_details ?? {}) as Record<string, unknown>;
    return {
      modId,
      ...(typeof mod.name === "string" ? { modName: mod.name } : {}),
      ...(typeof mod.author === "string" ? { author: mod.author } : {}),
      ...(typeof fileDetails.version === "string" && fileDetails.version
        ? { fileVersion: fileDetails.version }
        : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A plain 404 means "no known mod for this file", not a failure.
    if (message.includes("HTTP 404")) return null;
    throw new Error(`nexus md5_search: ${message}`);
  }
}

export async function modLatestVersion(
  key: string,
  domain: string,
  modId: number,
): Promise<string | null> {
  const url = `${API}/games/${encodeURIComponent(domain)}/mods/${modId}.json`;
  try {
    const value = await httpJson<Record<string, unknown>>(url, {
      headers: authHeaders(key),
      timeoutMs: 15_000,
    });
    return typeof value.version === "string" && value.version ? value.version : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("HTTP 404")) return null;
    throw new Error(`nexus mod info: ${message}`);
  }
}

interface RawNexusFile extends Record<string, unknown> {
  file_id?: number;
  name?: string;
  file_name?: string;
  version?: string;
  category_name?: string;
  size_kb?: number;
  uploaded_timestamp?: number;
}

export async function modFiles(
  key: string,
  domain: string,
  modId: string,
  premium: boolean,
): Promise<RemoteModFile[]> {
  const url = `${API}/games/${encodeURIComponent(domain)}/mods/${encodeURIComponent(modId)}/files.json`;
  let value: Record<string, unknown>;
  try {
    value = await httpJson<Record<string, unknown>>(url, {
      headers: authHeaders(key),
      timeoutMs: 20_000,
    });
  } catch {
    return [];
  }
  const files = Array.isArray(value.files) ? (value.files as RawNexusFile[]) : [];
  return files.map((file, index) => {
    const sizeKb = typeof file.size_kb === "number" ? file.size_kb : null;
    const uploaded =
      typeof file.uploaded_timestamp === "number"
        ? new Date(file.uploaded_timestamp * 1000).toISOString()
        : undefined;
    return {
      id: typeof file.file_id === "number" ? String(file.file_id) : "",
      name: file.name ?? file.file_name ?? `File ${index + 1}`,
      ...(typeof file.version === "string" ? { version: file.version } : {}),
      ...(sizeKb !== null ? { sizeBytes: sizeKb * 1024 } : {}),
      ...(uploaded ? { uploadedAt: uploaded } : {}),
      ...(typeof file.category_name === "string" ? { category: file.category_name } : {}),
      isPrimary: index === 0,
      downloadKind: premium ? "direct" : "external",
      downloadUrl: `https://www.nexusmods.com/${domain}/mods/${modId}`,
      ...(typeof file.file_name === "string" ? { fileName: file.file_name } : {}),
    };
  });
}

export interface NexusDownloadPlan {
  kind: "direct" | "external";
  url: string;
  filename?: string;
  message?: string;
}

export async function resolveDownload(
  key: string,
  domain: string,
  modId: string,
  fileId: string | null,
  premium: boolean,
): Promise<NexusDownloadPlan> {
  const modPage = `https://www.nexusmods.com/${domain}/mods/${modId}`;
  if (!premium) {
    return {
      kind: "external",
      url: modPage,
      message: "Nexus direct downloads need a Premium account - open the mod page.",
    };
  }

  let targetFileId = fileId;
  if (!targetFileId) {
    const files = await modFiles(key, domain, modId, premium);
    targetFileId = files[0]?.id ?? null;
  }
  if (!targetFileId) throw new Error("nexus: no files available");

  const url = `${API}/games/${encodeURIComponent(domain)}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(targetFileId)}/download_link.json`;
  try {
    const value = await httpJson<unknown>(url, {
      headers: authHeaders(key),
      timeoutMs: 20_000,
    });
    const list = Array.isArray(value)
      ? (value as Array<Record<string, unknown>>)
      : typeof value === "object" && value !== null && Array.isArray((value as Record<string, unknown>).links)
        ? ((value as Record<string, unknown>).links as Array<Record<string, unknown>>)
        : [];
    const first = list[0];
    const link =
      first && (typeof first.URI === "string" ? first.URI : typeof first.uri === "string" ? first.uri : undefined);
    if (!link) throw new Error("nexus: empty download link");
    const filename =
      first && typeof first.name === "string"
        ? first.name
        : first && typeof first.short_name === "string"
          ? first.short_name
          : undefined;
    return { kind: "direct", url: link, ...(filename ? { filename } : {}) };
  } catch (error) {
    return {
      kind: "external",
      url: modPage,
      message: `Nexus declined the link (${error instanceof Error ? error.message : String(error)}) - open the page.`,
    };
  }
}

// ── Browse (v1 feeds) ───────────────────────────────────────────────

interface RawNexusMod extends Record<string, unknown> {
  mod_id?: number;
  name?: string;
  author?: string;
  summary?: string;
  version?: string;
  downloads?: number;
  endorsements?: number;
  picture_url?: string;
  category_name?: string;
  created_timestamp?: number;
  updated_timestamp?: number;
  file_count?: number;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function summaryFromItem(domain: string, item: Record<string, unknown>): RemoteModSummary | null {
  const inner = (item.mod ?? item) as RawNexusMod;
  const id = typeof inner.mod_id === "number" ? inner.mod_id : null;
  if (id === null) return null;
  const created =
    typeof inner.created_timestamp === "number"
      ? new Date(inner.created_timestamp * 1000).toISOString()
      : undefined;
  const updated =
    typeof inner.updated_timestamp === "number"
      ? new Date(inner.updated_timestamp * 1000).toISOString()
      : undefined;
  return {
    source: "nexus",
    id: String(id),
    name: typeof inner.name === "string" ? inner.name : String(id),
    ...(typeof inner.author === "string" ? { author: inner.author } : {}),
    ...(typeof inner.summary === "string" ? { summary: inner.summary } : {}),
    ...(typeof inner.version === "string" ? { version: inner.version } : {}),
    ...(typeof inner.downloads === "number" ? { downloads: inner.downloads } : {}),
    ...(typeof inner.endorsements === "number" ? { endorsements: inner.endorsements } : {}),
    ...(created ? { createdAt: created } : {}),
    ...(updated ? { updatedAt: updated } : {}),
    ...(typeof inner.picture_url === "string" ? { thumbnailUrl: inner.picture_url } : {}),
    url: `https://www.nexusmods.com/${domain}/mods/${id}`,
    ...(typeof inner.category_name === "string" ? { category: inner.category_name } : {}),
    ...(typeof inner.file_count === "number" ? { fileCount: inner.file_count } : {}),
  };
}

/**
 * Browse a game's Nexus catalogue. The v1 API has no paginated "all mods"
 * endpoint, so the three fixed feeds are merged, filtered and paged here.
 */
export async function browse(
  key: string,
  domain: string,
  query: string,
  sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  const endpoints = ["latest_added", "latest_updated", "trending"];
  const responses = await Promise.allSettled(
    endpoints.map((endpoint) =>
      httpJson<unknown>(`${API}/games/${encodeURIComponent(domain)}/mods/${endpoint}.json`, {
        headers: authHeaders(key),
        timeoutMs: 15_000,
      }),
    ),
  );

  let hadResponse = false;
  const seen = new Set<string>();
  let results: RemoteModSummary[] = [];
  for (const response of responses) {
    if (response.status !== "fulfilled") continue;
    hadResponse = true;
    const value = response.value;
    const items = Array.isArray(value)
      ? value
      : Array.isArray((value as Record<string, unknown>).mods)
        ? ((value as Record<string, unknown>).mods as unknown[])
        : Array.isArray((value as Record<string, unknown>).results)
          ? ((value as Record<string, unknown>).results as unknown[])
          : [];
    for (const item of items) {
      const summary = summaryFromItem(domain, item as Record<string, unknown>);
      if (summary && !seen.has(summary.id)) {
        seen.add(summary.id);
        results.push(summary);
      }
    }
  }
  if (!hadResponse) throw new Error("nexus browse: request failed");

  const needle = normalizeName(query);
  if (needle) {
    results = results.filter(
      (mod) =>
        normalizeName(mod.name).includes(needle) ||
        (mod.summary ? normalizeName(mod.summary).includes(needle) : false) ||
        (mod.author ? normalizeName(mod.author).includes(needle) : false),
    );
  }

  if (sort === "latest") {
    results.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  } else if (sort === "updated") {
    results.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  } else if (sort === "downloads") {
    results.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  } else {
    results.sort((a, b) => (b.endorsements ?? 0) - (a.endorsements ?? 0));
  }

  const start = Math.max(0, (page - 1) * pageSize);
  const end = Math.min(results.length, start + pageSize);
  return {
    source: "nexus",
    query,
    results: start < results.length ? results.slice(start, end) : [],
    page,
    total: results.length,
    hasMore: end < results.length,
  };
}

export async function detail(
  key: string,
  domain: string,
  modId: string,
): Promise<import("./types").RemoteModDetail> {
  const url = `${API}/games/${encodeURIComponent(domain)}/mods/${encodeURIComponent(modId)}.json`;
  const value = await httpJson<Record<string, unknown>>(url, {
    headers: authHeaders(key),
    timeoutMs: 20_000,
  });
  const summary = summaryFromItem(domain, value);
  if (!summary) throw new Error("nexus: empty mod");
  const premium = (await isPremiumCached()) ?? false;
  const files = await modFiles(key, domain, modId, premium);
  const gallery = typeof value.picture_url === "string" ? [value.picture_url] : [];
  return {
    summary,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    gallery,
    files,
  };
}
