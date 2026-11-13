/**
 * Steam Workshop browsing through the Steam Web API.
 *
 * Workshop items are never downloaded by GameIndex — Steam owns the
 * subscription — but the catalogue and detail pages can be browsed with the
 * connected Steam Web API key. Detail falls back to the keyless legacy
 * endpoint.
 */
import { formBody, httpJson, httpText } from "../../lib/http";
import { loadSteamSession } from "../stores/steamSession";
import type { RemoteModDetail, RemoteModFile, RemoteModSearch, RemoteModSummary } from "./types";

const QUERY_URL = "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/";
const DETAILS_URL = "https://api.steampowered.com/IPublishedFileService/GetDetails/v1/";
const LEGACY_DETAILS_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

function key(): string | null {
  return loadSteamSession()?.apiKey?.trim() || null;
}

function workshopUrl(id: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(id)}`;
}

function str(value: unknown, ...keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim()) return entry.trim();
    if (typeof entry === "number" && Number.isFinite(entry)) return String(entry);
  }
  return undefined;
}

function num(value: unknown, ...keys: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const entry = record[key];
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (typeof entry === "string" && entry.trim()) {
      const parsed = Number(entry);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function list(value: unknown, ...keys: string[]): unknown[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const entry = record[key];
    if (Array.isArray(entry)) return entry;
  }
  return [];
}

function summaryFrom(record: unknown): RemoteModSummary | null {
  const id = str(record, "publishedfileid", "published_file_id");
  if (!id) return null;
  return {
    source: "workshop",
    id,
    name: str(record, "title") ?? id,
    author: str(record, "creator"),
    summary: str(record, "short_description", "file_description", "description"),
    version: str(record, "time_updated"),
    downloads: num(record, "subscriptions", "views"),
    endorsements: num(record, "favorited", "favorites"),
    updatedAt: str(record, "time_updated"),
    createdAt: str(record, "time_created"),
    thumbnailUrl: str(record, "preview_url"),
    url: workshopUrl(id),
    fileCount: 1,
  };
}

function responseDetails(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const response = (payload as Record<string, unknown>).response;
  return list(response, "publishedfiledetails");
}

export function workshopKeyAvailable(): boolean {
  return !!key();
}

export async function browseWorkshop(
  appId: string,
  query: string,
  sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  const apiKey = key();
  if (!apiKey) throw new Error("Connect your Steam account to browse the Workshop");
  const url = new URL(QUERY_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("appid", appId);
  url.searchParams.set("search_text", query);
  url.searchParams.set("query_type", sort === "latest" ? "0" : "9");
  url.searchParams.set("numperpage", String(pageSize));
  url.searchParams.set("page", String(page));
  url.searchParams.set("return_details", "true");
  url.searchParams.set("filetype", "0");
  url.searchParams.set("days", "-1");
  const payload = await httpJson<unknown>(url.toString(), { timeoutMs: 25_000 });
  const details = responseDetails(payload);
  const response =
    payload && typeof payload === "object"
      ? ((payload as Record<string, unknown>).response as Record<string, unknown> | undefined)
      : undefined;
  const total = num(response, "total");
  const results = details
    .map(summaryFrom)
    .filter((entry): entry is RemoteModSummary => !!entry);
  return {
    source: "workshop",
    query,
    results,
    page,
    total,
    hasMore: total !== undefined ? page * pageSize < total : results.length >= pageSize,
  };
}

async function fetchDetailPayload(modId: string): Promise<unknown> {
  const apiKey = key();
  if (apiKey) {
    try {
      const response = await httpText(DETAILS_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody({
          key: apiKey,
          "publishedfileids[0]": modId,
          includeadditionalpreviews: "true",
          includeimages: "true",
          includevideos: "true",
          includetags: "true",
          includechildren: "true",
          includekvtags: "true",
          strip_description_bbcode: "false",
        }),
        timeoutMs: 25_000,
      });
      if (response.ok) return JSON.parse(response.text) as unknown;
    } catch {
      /* fall back to the keyless endpoint */
    }
  }
  const response = await httpText(LEGACY_DETAILS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody({
      itemcount: "1",
      "publishedfileids[0]": modId,
    }),
    timeoutMs: 25_000,
  });
  return JSON.parse(response.text) as unknown;
}

export async function detailWorkshop(_appId: string, modId: string): Promise<RemoteModDetail> {
  const details = responseDetails(await fetchDetailPayload(modId));
  const record = details[0];
  const result = num(record, "result");
  if (result !== undefined && result !== 1) {
    throw new Error("Workshop item not found or no longer public");
  }
  const summaryEntry = summaryFrom(record);
  if (!summaryEntry) throw new Error("Workshop item not found");
  const gallery: string[] = [];
  const push = (url: string | undefined) => {
    if (url && !gallery.includes(url)) gallery.push(url);
  };
  push(str(record, "preview_url"));
  for (const key of ["images", "additional_previews"]) {
    for (const image of list(record, key)) push(str(image, "url", "preview_url"));
  }
  for (const video of list(record, "videos")) push(str(video, "url"));
  const fileName = str(record, "filename") ?? summaryEntry.name;
  const files: RemoteModFile[] = [
    {
      id: summaryEntry.id,
      name: fileName,
      version: summaryEntry.version,
      sizeBytes: num(record, "file_size"),
      uploadedAt: str(record, "time_updated"),
      category: "Workshop",
      isPrimary: true,
      downloadKind: "steam",
      downloadUrl: workshopUrl(summaryEntry.id),
      fileName,
    },
  ];
  return {
    summary: summaryEntry,
    description:
      str(record, "description", "file_description", "short_description") ??
      summaryEntry.summary,
    gallery,
    files,
    links: [{ label: "Steam Workshop", url: workshopUrl(modId) }],
  };
}
