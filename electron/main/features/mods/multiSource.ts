/**
 * Non-Nexus mod sources (Thunderstore, GameBanana, ModDB, CurseForge,
 * mod.io). Ported from `src-tauri/src/mods/sources/*` with the same public
 * endpoints and defensive JSON parsing.
 */
import { load } from "cheerio";
import { net } from "electron";
import { httpJson, httpText } from "../../lib/http";
import { createSqliteStore } from "../../state/sqliteStore";
import type {
  RemoteModDetail,
  RemoteModFile,
  RemoteModSearch,
  RemoteModSummary,
} from "./types";

export type MultiSourceId =
  | "thunderstore"
  | "gamebanana"
  | "moddb"
  | "curseforge"
  | "modio";

export interface GameRef {
  externalId: string;
  label: string;
}

export interface DownloadPlan {
  kind: "direct" | "external";
  url: string;
  filename?: string;
  message?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface CredentialDocument {
  keys: Record<string, string>;
}

const credentialStore = createSqliteStore<CredentialDocument>({
  domain: "mods",
  document: "source-keys",
  createDefault: () => ({ keys: {} }),
  normalize: (value) => ({
    keys:
      value.keys && typeof value.keys === "object" && !Array.isArray(value.keys)
        ? Object.fromEntries(
            Object.entries(value.keys).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {},
  }),
});

export function getSourceKey(source: string): string | null {
  const key = credentialStore.read().keys[source]?.trim();
  return key ? key : null;
}

export function setSourceKey(source: string, key: string): void {
  const current = credentialStore.read();
  const keys = { ...current.keys };
  if (key.trim()) keys[source] = key.trim();
  else delete keys[source];
  credentialStore.write({ keys });
  if (source === "curseforge") curseforgeGamesCache = null;
}

function requireKey(source: string): string {
  const key = getSourceKey(source);
  if (!key) throw new Error(`${source} API key not set`);
  return key;
}

function val(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown, ...keys: string[]): string | undefined {
  if (!value) return undefined;
  const record = val(value);
  if (!record) return undefined;
  for (const key of keys) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim()) return entry.trim();
    if (typeof entry === "number" && Number.isFinite(entry)) return String(entry);
  }
  return undefined;
}

function num(value: unknown, ...keys: string[]): number | undefined {
  if (!value) return undefined;
  const record = val(value);
  if (!record) return undefined;
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

function arr(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = val(value);
  if (!record) return [];
  for (const key of keys) {
    const entry = record[key];
    if (Array.isArray(entry)) return entry;
  }
  return [];
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function score(candidates: string[], values: string[]): number {
  let best = 0;
  for (const candidate of candidates) {
    const target = normalized(candidate);
    if (!target) continue;
    for (const value of values) {
      const current = normalized(value);
      if (!current) continue;
      if (current === target) best = Math.max(best, 100);
      else if (current.includes(target) || target.includes(current)) best = Math.max(best, 60);
    }
  }
  return best;
}

function summary(
  source: MultiSourceId,
  base: Omit<RemoteModSummary, "source">,
): RemoteModSummary {
  return { source, ...base };
}

// ── Thunderstore ─────────────────────────────────────────────────────

let thunderCommunities: Array<Record<string, unknown>> | null = null;

async function thunderstoreCommunities(): Promise<Array<Record<string, unknown>>> {
  if (thunderCommunities) return thunderCommunities;
  const all: Array<Record<string, unknown>> = [];
  let url: string | null = "https://thunderstore.io/api/experimental/community/";
  for (let page = 0; url && page < 25; page += 1) {
    const response = await httpJson<Record<string, unknown>>(url, {
      headers: { "user-agent": USER_AGENT },
      timeoutMs: 20_000,
    });
    all.push(...arr(response, "results").map((entry) => val(entry) ?? {}));
    const pagination = val(response.pagination) ?? {};
    const nextLink = str(pagination, "next_link");
    url = nextLink ?? null;
  }
  thunderCommunities = all;
  return all;
}

function thunderSummary(record: Record<string, unknown>): RemoteModSummary | null {
  const owner = str(record, "owner", "namespace");
  const name = str(record, "name");
  if (!name) return null;
  const versions = arr(record, "versions");
  const latest = versions
    .map((entry) => val(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .sort((a, b) => String(str(b, "date_created") ?? "").localeCompare(String(str(a, "date_created") ?? "")))[0];
  const categories = arr(record, "categories").filter((entry): entry is string => typeof entry === "string");
  return summary("thunderstore", {
    id: owner ? `${owner}/${name}` : name,
    name,
    author: owner,
    summary: str(latest, "description"),
    version: str(latest, "version_number", "version"),
    downloads: versions.reduce<number>((total, entry) => total + (num(entry, "downloads") ?? 0), 0),
    endorsements: num(record, "rating_score"),
    updatedAt: str(record, "date_updated"),
    createdAt: str(record, "date_created"),
    thumbnailUrl: str(latest, "icon"),
    url: str(record, "package_url") ?? `https://thunderstore.io/c/${owner ?? ""}/${name}`,
    category: categories[0],
    fileCount: versions.length,
  });
}

async function thunderstoreResolve(candidates: string[]): Promise<GameRef | null> {
  const communities = await thunderstoreCommunities();
  let best: { score: number; ref: GameRef } | null = null;
  for (const community of communities) {
    const identifier = str(community, "identifier", "name_id", "name");
    const display = str(community, "name", "display_name") ?? identifier;
    if (!identifier) continue;
    const current = score(candidates, [identifier, display ?? ""]);
    if (current >= 60 && (!best || current > best.score)) {
      best = { score: current, ref: { externalId: identifier, label: display ?? identifier } };
    }
  }
  return best?.ref ?? null;
}

async function thunderstoreBrowse(
  externalId: string,
  query: string,
  sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  const response = await httpJson<unknown>(
    `https://thunderstore.io/c/${encodeURIComponent(externalId)}/api/v1/package/`,
    { headers: { "user-agent": USER_AGENT }, timeoutMs: 30_000 },
  );
  const q = normalized(query);
  const results = arr(response, "results")
    .map((entry) => val(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .filter((entry) => entry.is_deprecated !== true)
    .map(thunderSummary)
    .filter((entry): entry is RemoteModSummary => !!entry)
    .filter(
      (entry) =>
        !q ||
        normalized(entry.name).includes(q) ||
        normalized(entry.author ?? "").includes(q) ||
        normalized(entry.summary ?? "").includes(q),
    );
  if (sort === "latest" || sort === "updated") {
    results.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  } else {
    results.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  }
  const start = (page - 1) * pageSize;
  return {
    source: "thunderstore",
    query,
    results: results.slice(start, start + pageSize),
    page,
    total: results.length,
    hasMore: start + pageSize < results.length,
  };
}

async function thunderstoreDetail(
  externalId: string,
  modId: string,
): Promise<RemoteModDetail> {
  const [owner, name] = modId.split("/");
  if (!owner || !name) throw new Error("thunderstore mod id must be namespace/name");
  const record = await httpJson<Record<string, unknown>>(
    `https://thunderstore.io/api/experimental/package/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/`,
    { headers: { "user-agent": USER_AGENT }, timeoutMs: 20_000 },
  );
  const summaryEntry = thunderSummary(record) ?? summary("thunderstore", {
    id: modId,
    name,
    url: `https://thunderstore.io/c/${externalId}/p/${name}/`,
  });
  const latest = val(record.latest) ?? {};
  const version = str(latest, "version_number", "version") ?? "";
  const file: RemoteModFile = {
    id: version,
    name: `${name} v${version}`,
    version,
    sizeBytes: num(latest, "file_size"),
    uploadedAt: str(latest, "date_created"),
    isPrimary: true,
    downloadKind: "direct",
    downloadUrl:
      str(latest, "download_url") ??
      `https://thunderstore.io/package/download/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/`,
    fileName: `${name}-${version}.zip`,
  };
  return {
    summary: summaryEntry,
    description: str(latest, "description") ?? summaryEntry.summary,
    gallery: [],
    files: version ? [file] : [],
    links: [],
  };
}

// ── GameBanana ───────────────────────────────────────────────────────

function gbThumbnail(record: Record<string, unknown>): string | undefined {
  const images = arr(val(record._aPreviewMedia) ?? {}, "_aImages");
  for (const wanted of ["banner", ""]) {
    for (const entry of images) {
      const image = val(entry);
      if (!image) continue;
      if (wanted && str(image, "_sType") !== wanted) continue;
      const direct = str(image, "_sUrl");
      if (direct) return direct;
      const base = str(image, "_sBaseUrl");
      const file = str(image, "_sFile220", "_sFile530", "_sFile");
      if (base && file) return `${base}/${file}`;
    }
  }
  return undefined;
}

function gbSummary(record: Record<string, unknown>): RemoteModSummary | null {
  const id = num(record, "_idRow", "id");
  if (!id) return null;
  const name = str(record, "_sName", "name") ?? String(id);
  return summary("gamebanana", {
    id: String(id),
    name,
    author: str(val(record._aSubmitter) ?? {}, "_sName", "name"),
    summary: str(record, "_sSubtitle", "_sSummary", "summary"),
    version: str(record, "_sVersion"),
    downloads: num(record, "_nDownloadCount", "_nDownloads"),
    endorsements: num(record, "_nLikeCount", "_nEndorsements"),
    updatedAt: str(record, "_tsDateUpdated") ?? str(record, "_tsDateAdded"),
    createdAt: str(record, "_tsDateAdded"),
    thumbnailUrl: gbThumbnail(record) ?? str(record, "_sImageUrl"),
    url: str(record, "_sProfileUrl", "_sUrl") ?? `https://gamebanana.com/mods/${id}`,
    category: str(val(record._aCategory) ?? {}, "_sName"),
  });
}

async function gamebananaResolve(candidates: string[]): Promise<GameRef | null> {
  let best: { score: number; ref: GameRef } | null = null;
  for (const candidate of candidates.slice(0, 3)) {
    const response = await httpJson<unknown>(
      `https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Game&_sSearchString=${encodeURIComponent(candidate)}&_nPerpage=15`,
      { headers: { "user-agent": USER_AGENT }, timeoutMs: 20_000 },
    ).catch(() => null);
    for (const entry of arr(response, "_aRecords", "records")) {
      const game = val(entry);
      if (!game) continue;
      const id = num(game, "_idRow", "id");
      const name = str(game, "_sName", "name") ?? "";
      if (!id) continue;
      const slug = (str(game, "_sProfileUrl") ?? "").split("/").pop() ?? "";
      const current = score(candidates, [name, slug, str(game, "_sAbbreviation") ?? ""]);
      if (current >= 60 && (!best || current > best.score)) {
        best = { score: current, ref: { externalId: String(id), label: name } };
      }
    }
    if ((best?.score ?? 0) >= 100) break;
  }
  return best?.ref ?? null;
}

async function gamebananaBrowse(
  externalId: string,
  query: string,
  sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  const sortParam = sort === "latest" ? "new" : sort === "updated" ? "updated" : "default";
  const url = query.trim()
    ? `https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_sSearchString=${encodeURIComponent(query)}&_nPerpage=${pageSize}&_nPage=${page}&_idGameRow=${encodeURIComponent(externalId)}`
    : `https://gamebanana.com/apiv11/Game/${encodeURIComponent(externalId)}/Subfeed?_nPerpage=${pageSize}&_nPage=${page}&_sSort=${sortParam}&_csvModelInclusions=Mod`;
  const response = await httpJson<Record<string, unknown>>(url, {
    headers: { "user-agent": USER_AGENT },
    timeoutMs: 25_000,
  });
  const results = arr(response, "_aRecords", "records")
    .map((entry) => val(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .map(gbSummary)
    .filter((entry): entry is RemoteModSummary => !!entry);
  const meta = val(response._aMetadata) ?? {};
  const total = num(meta, "_nRecordCount") ?? results.length;
  const complete = meta._bIsComplete === true;
  return {
    source: "gamebanana",
    query,
    results,
    page,
    total,
    hasMore: !complete && page * pageSize < total,
  };
}

async function gamebananaDetail(
  _externalId: string,
  modId: string,
): Promise<RemoteModDetail> {
  const record = await httpJson<Record<string, unknown>>(
    `https://gamebanana.com/apiv11/Mod/${encodeURIComponent(modId)}/ProfilePage`,
    { headers: { "user-agent": USER_AGENT }, timeoutMs: 25_000 },
  );
  const summaryEntry =
    gbSummary(record) ??
    summary("gamebanana", { id: modId, name: `GameBanana mod ${modId}`, url: `https://gamebanana.com/mods/${modId}` });
  const gallery: string[] = [];
  for (const entry of arr(val(record._aPreviewMedia) ?? {}, "_aImages")) {
    const image = val(entry);
    if (!image) continue;
    const base = str(image, "_sBaseUrl");
    const file = str(image, "_sFile", "_sFile530");
    if (base && file) gallery.push(`${base}/${file}`);
  }
  const files: RemoteModFile[] = arr(record, "_aFiles")
    .map((entry) => val(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .map((file, index) => ({
      id: String(num(file, "_idRow") ?? ""),
      name: str(file, "_sFile", "_sName") ?? "file",
      version: str(file, "_sVersion"),
      sizeBytes: num(file, "_nFilesize", "_nFileSize"),
      uploadedAt: str(file, "_tsDateAdded"),
      isPrimary: index === 0,
      downloadKind: str(file, "_sDownloadUrl") ? "direct" : "external",
      downloadUrl: str(file, "_sDownloadUrl") ?? summaryEntry.url,
      fileName: str(file, "_sFile"),
    }));
  return {
    summary: summaryEntry,
    description: str(record, "_sText", "_sDescription"),
    gallery,
    files,
    links: [],
  };
}

// ── mod.io ───────────────────────────────────────────────────────────

function modioSummary(record: Record<string, unknown>): RemoteModSummary | null {
  const id = num(record, "id", "id_row");
  if (!id) return null;
  const logo = val(record.logo) ?? {};
  return summary("modio", {
    id: String(id),
    name: str(record, "name") ?? String(id),
    author: str(val(record.submitted_by) ?? {}, "name", "username"),
    summary: str(record, "summary"),
    downloads: num(val(record.stats) ?? {}, "downloads_total") ?? num(record, "downloads_total"),
    endorsements:
      num(val(record.stats) ?? {}, "ratings_positive") ?? num(record, "ratings_positive"),
    updatedAt: str(record, "date_updated"),
    createdAt: str(record, "date_added"),
    thumbnailUrl: str(logo, "thumb_320x180", "original", "thumb_640x360"),
    url: str(record, "profile_url") ?? `https://mod.io/mods/${id}`,
  });
}

function withKey(url: string, key: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`;
}

async function modioResolve(candidates: string[]): Promise<GameRef | null> {
  const key = getSourceKey("modio");
  if (!key) return null;
  let best: { score: number; ref: GameRef } | null = null;
  for (const candidate of candidates.slice(0, 3)) {
    const response = await httpJson<unknown>(
      withKey(`https://api.mod.io/v1/games?_q=${encodeURIComponent(candidate)}&_limit=20`, key),
      { headers: { "user-agent": USER_AGENT }, timeoutMs: 20_000 },
    ).catch(() => null);
    for (const entry of arr(response, "data")) {
      const game = val(entry);
      if (!game) continue;
      const id = num(game, "id");
      const name = str(game, "name") ?? "";
      const nameId = str(game, "name_id") ?? "";
      if (!id) continue;
      const current = score(candidates, [name, nameId]);
      if (current >= 60 && (!best || current > best.score)) {
        best = { score: current, ref: { externalId: String(id), label: name } };
      }
    }
    if ((best?.score ?? 0) >= 100) break;
  }
  return best?.ref ?? null;
}

async function modioBrowse(
  externalId: string,
  query: string,
  sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  const key = requireKey("modio");
  const sortParam = sort === "latest" || sort === "updated" ? "-date_updated" : sort === "downloads" ? "-downloads_total" : "-popular";
  const offset = (page - 1) * pageSize;
  const response = await httpJson<unknown>(
    withKey(
      `https://api.mod.io/v1/games/${encodeURIComponent(externalId)}/mods?_q=${encodeURIComponent(query)}&_limit=${pageSize}&_offset=${offset}&_sort=${sortParam}`,
      key,
    ),
    { headers: { "user-agent": USER_AGENT }, timeoutMs: 25_000 },
  );
  const results = arr(response, "data")
    .map((entry) => val(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .map(modioSummary)
    .filter((entry): entry is RemoteModSummary => !!entry);
  const total = num(response, "result_count") ?? results.length;
  return {
    source: "modio",
    query,
    results,
    page,
    total,
    hasMore: offset + results.length < total,
  };
}

async function modioDetail(externalId: string, modId: string): Promise<RemoteModDetail> {
  const key = requireKey("modio");
  const record = await httpJson<Record<string, unknown>>(
    withKey(`https://api.mod.io/v1/games/${encodeURIComponent(externalId)}/mods/${encodeURIComponent(modId)}`, key),
    { headers: { "user-agent": USER_AGENT }, timeoutMs: 25_000 },
  );
  const summaryEntry =
    modioSummary(record) ??
    summary("modio", { id: modId, name: `mod.io mod ${modId}`, url: `https://mod.io/mods/${modId}` });
  const gallery: string[] = [];
  for (const entry of arr(val(record.media) ?? {}, "images")) {
    const image = val(entry);
    if (!image) continue;
    const url = str(image, "original", "url");
    if (url) gallery.push(url);
  }
  const files: RemoteModFile[] = [];
  const modfile = val(record.modfile);
  if (modfile) {
    const direct = str(val(modfile.download) ?? {}, "binary_url");
    files.push({
      id: String(num(modfile, "id") ?? ""),
      name: str(modfile, "filename", "name") ?? summaryEntry.name,
      version: str(modfile, "version"),
      sizeBytes: num(modfile, "filesize"),
      uploadedAt: str(modfile, "date_added"),
      category: "Primary",
      isPrimary: true,
      downloadKind: direct ? "direct" : "external",
      downloadUrl: direct ?? summaryEntry.url,
      fileName: str(modfile, "filename"),
    });
  }
  return {
    summary: summaryEntry,
    description: str(record, "description_plaintext", "description"),
    gallery,
    files,
    links: [],
  };
}

// ── CurseForge ───────────────────────────────────────────────────────

function cfHeaders(): Record<string, string> {
  return { "x-api-key": requireKey("curseforge"), accept: "application/json", "user-agent": USER_AGENT };
}

function cfSummary(record: Record<string, unknown>): RemoteModSummary | null {
  const id = num(record, "id");
  if (!id) return null;
  const links = val(record.links) ?? {};
  const logo = val(record.logo) ?? {};
  return summary("curseforge", {
    id: String(id),
    name: str(record, "name") ?? String(id),
    author: str(val(arr(record, "authors")[0]) ?? {}, "name"),
    summary: str(record, "summary"),
    downloads: num(record, "downloadCount"),
    endorsements: num(record, "thumbsUpCount"),
    updatedAt: str(record, "dateModified"),
    createdAt: str(record, "dateCreated"),
    thumbnailUrl: str(logo, "thumbnailUrl", "url"),
    url: str(links, "websiteUrl") ?? `https://www.curseforge.com/mods/${id}`,
    category: str(val(arr(record, "categories")[0]) ?? {}, "name"),
  });
}

async function curseforgeResolve(candidates: string[]): Promise<GameRef | null> {
  if (!getSourceKey("curseforge")) return null;
  let games = curseforgeGamesCache;
  if (!games) {
    games = [];
    for (let index = 0; index < 16; index += 1) {
      const response = await httpJson<unknown>(
        `https://api.curseforge.com/v1/games?index=${index * 50}&pageSize=50`,
        { headers: cfHeaders(), timeoutMs: 20_000 },
      ).catch(() => null);
      const data = arr(response, "data");
      if (data.length === 0) break;
      games.push(...data);
      if (games.length >= 800) break;
    }
    curseforgeGamesCache = games;
  }
  let best: { score: number; ref: GameRef } | null = null;
  for (const entry of games) {
    const game = val(entry);
    if (!game) continue;
    const id = num(game, "id");
    const name = str(game, "name") ?? "";
    const slug = str(game, "slug") ?? "";
    if (!id) continue;
    const current = score(candidates, [name, slug]);
    if (current >= 60 && (!best || current > best.score)) {
      best = { score: current, ref: { externalId: String(id), label: name } };
    }
  }
  return best?.ref ?? null;
}

let curseforgeGamesCache: unknown[] | null = null;

async function curseforgeBrowse(
  externalId: string,
  query: string,
  sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  const sortField = sort === "latest" ? 11 : sort === "updated" ? 3 : sort === "downloads" ? 6 : 2;
  const index = (page - 1) * pageSize;
  const response = await httpJson<Record<string, unknown>>(
    `https://api.curseforge.com/v1/mods/search?gameId=${encodeURIComponent(externalId)}&searchFilter=${encodeURIComponent(query)}&sortField=${sortField}&sortOrder=desc&pageSize=${pageSize}&index=${index}`,
    { headers: cfHeaders(), timeoutMs: 25_000 },
  );
  const results = arr(response, "data")
    .map((entry) => val(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .map(cfSummary)
    .filter((entry): entry is RemoteModSummary => !!entry);
  const total = num(val(response.pagination) ?? {}, "totalCount") ?? results.length;
  return {
    source: "curseforge",
    query,
    results,
    page,
    total,
    hasMore: index + results.length < total,
  };
}

async function curseforgeDetail(_externalId: string, modId: string): Promise<RemoteModDetail> {
  const response = await httpJson<Record<string, unknown>>(
    `https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}`,
    { headers: cfHeaders(), timeoutMs: 25_000 },
  );
  const record = val(response.data) ?? response;
  const summaryEntry =
    cfSummary(record) ??
    summary("curseforge", { id: modId, name: `CurseForge mod ${modId}`, url: `https://www.curseforge.com/mods/${modId}` });
  const filesResponse = await httpJson<unknown>(
    `https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}/files?pageSize=50`,
    { headers: cfHeaders(), timeoutMs: 25_000 },
  ).catch(() => null);
  const files: RemoteModFile[] = arr(filesResponse, "data")
    .map((entry) => val(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .map((file, index) => ({
      id: String(num(file, "id") ?? ""),
      name: str(file, "displayName", "fileName") ?? "file",
      version: str(file, "displayName"),
      sizeBytes: num(file, "fileLength"),
      uploadedAt: str(file, "fileDate"),
      isPrimary: index === 0,
      downloadKind: "direct",
      downloadUrl: str(file, "downloadUrl"),
      fileName: str(file, "fileName"),
    }));
  return {
    summary: summaryEntry,
    description: str(record, "description"),
    gallery: [],
    files,
    links: [],
  };
}

// ── ModDB ────────────────────────────────────────────────────────────

function moddbSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * ModDB sits behind Cloudflare, which rejects Node/undici requests once
 * cheerio's own HTTP dependencies are loaded. Electron's `net.fetch` uses
 * Chromium's network stack, which passes the same challenge a browser does.
 */
async function moddbText(url: string): Promise<string | null> {
  try {
    const response = await net.fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (response.ok) return await response.text();
  } catch {
    /* fall through to the shared fetch helper */
  }
  try {
    const response = await httpText(url, {
      headers: { "user-agent": USER_AGENT },
      timeoutMs: 15_000,
    });
    return response.ok ? response.text : null;
  } catch {
    return null;
  }
}

async function moddbResolve(candidates: string[]): Promise<GameRef | null> {
  for (const candidate of candidates.slice(0, 3)) {
    const slug = moddbSlug(candidate);
    if (!slug) continue;
    for (const kind of ["games", "mods"] as const) {
      const html = await moddbText(`https://www.moddb.com/${kind}/${slug}`);
      if (html && !/page not found/i.test(html)) {
        return { externalId: `${kind[0]}:${slug}`, label: candidate };
      }
    }
  }
  return null;
}

async function moddbBrowse(
  externalId: string,
  query: string,
  _sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  const [kind, slug] = externalId.split(":");
  const base =
    kind === "m"
      ? `https://www.moddb.com/mods/${slug}/downloads`
      : `https://www.moddb.com/games/${slug}/mods`;
  const html = await moddbText(base);
  if (!html) throw new Error("moddb browse: request failed");
  const $ = load(html);
  const seen = new Set<string>();
  const results: RemoteModSummary[] = [];
  $('a[href^="/mods/"]').each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const parts = href.replace(/\/+$/, "").split("/");
    if (parts.length < 3) return;
    const modSlug = parts[2];
    if (!modSlug || seen.has(modSlug) || modSlug === slug) return;
    seen.add(modSlug);
    const name = $(element).text().trim() || modSlug.replace(/-/g, " ");
    if (!name || /^mods$/i.test(name)) return;
    results.push(
      summary("moddb", {
        id: modSlug,
        name,
        url: `https://www.moddb.com/mods/${modSlug}`,
      }),
    );
  });
  const q = normalized(query);
  const filtered = results.filter((entry) => !q || normalized(entry.name).includes(q));
  const start = (page - 1) * pageSize;
  return {
    source: "moddb",
    query,
    results: filtered.slice(start, start + pageSize),
    page,
    total: filtered.length,
    hasMore: start + pageSize < filtered.length,
  };
}

async function moddbDetail(_externalId: string, modId: string): Promise<RemoteModDetail> {
  const url = `https://www.moddb.com/mods/${modId}`;
  const html = await moddbText(url);
  if (!html) throw new Error("moddb detail: request failed");
  const $ = load(html);
  const title = $("h1").first().text().trim() || modId.replace(/-/g, " ");
  const description =
    $('div[class*="description"]').first().text().trim() ||
    $('meta[name="description"]').attr("content") ||
    undefined;
  const downloadsUrl = `${url}/downloads`;
  return {
    summary: summary("moddb", { id: modId, name: title, url }),
    description,
    gallery: [],
    files: [
      {
        id: "downloads",
        name: "Open ModDB downloads",
        isPrimary: true,
        downloadKind: "external",
        downloadUrl: downloadsUrl,
      },
    ],
    links: [],
  };
}

// ── Public dispatch ──────────────────────────────────────────────────

export async function resolveMultiSource(
  source: MultiSourceId,
  candidates: string[],
): Promise<GameRef | null> {
  switch (source) {
    case "thunderstore":
      return thunderstoreResolve(candidates);
    case "gamebanana":
      return gamebananaResolve(candidates);
    case "moddb":
      return moddbResolve(candidates);
    case "curseforge":
      return curseforgeResolve(candidates);
    case "modio":
      return modioResolve(candidates);
  }
}

export async function browseMultiSource(
  source: MultiSourceId,
  externalId: string,
  query: string,
  sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  switch (source) {
    case "thunderstore":
      return thunderstoreBrowse(externalId, query, sort, page, pageSize);
    case "gamebanana":
      return gamebananaBrowse(externalId, query, sort, page, pageSize);
    case "moddb":
      return moddbBrowse(externalId, query, sort, page, pageSize);
    case "curseforge":
      return curseforgeBrowse(externalId, query, sort, page, pageSize);
    case "modio":
      return modioBrowse(externalId, query, sort, page, pageSize);
  }
}

export async function detailMultiSource(
  source: MultiSourceId,
  externalId: string,
  modId: string,
): Promise<RemoteModDetail> {
  switch (source) {
    case "thunderstore":
      return thunderstoreDetail(externalId, modId);
    case "gamebanana":
      return gamebananaDetail(externalId, modId);
    case "moddb":
      return moddbDetail(externalId, modId);
    case "curseforge":
      return curseforgeDetail(externalId, modId);
    case "modio":
      return modioDetail(externalId, modId);
  }
}

export async function downloadMultiSource(
  source: MultiSourceId,
  externalId: string,
  modId: string,
  fileId: string | null,
): Promise<DownloadPlan> {
  const detail = await detailMultiSource(source, externalId, modId);
  const file =
    (fileId && detail.files.find((entry) => entry.id === fileId)) || detail.files[0];
  if (file?.downloadKind === "direct" && file.downloadUrl) {
    return {
      kind: "direct",
      url: file.downloadUrl,
      filename: file.fileName,
    };
  }
  return {
    kind: "external",
    url: file?.downloadUrl ?? detail.summary.url,
    message:
      source === "moddb"
        ? "ModDB needs a mirror choice on its downloads page — open it in the browser."
        : "This source has no direct download; open the mod page.",
  };
}
