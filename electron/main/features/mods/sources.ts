/**
 * Mod-source plumbing for the Discover browser.
 *
 * Nexus Mods and Steam Workshop are the sources this build can actually drive:
 * Nexus needs an API key (direct downloads additionally need Premium), Steam
 * Workshop items are Steam-managed and only ever open in a browser. The other
 * sites the Tauri build scraped (Thunderstore, GameBanana, ModDB, CurseForge,
 * mod.io) are not registered at all — no key field, no fake empty results.
 *
 * Reference: `src-tauri/src/mods/sources/{mod.rs,nexus.rs}` and the install
 * half of `mods_source_download`.
 */
import fs from "node:fs";
import path from "node:path";
import { emit } from "../../ipc";
import { downloadToFile, httpJson } from "../../lib/http";
import { userDataPath } from "../../lib/paths";
import { getGame } from "../../state/libraryStore";
import { installArchive } from "./manage";
import * as nexus from "./nexus";
import {
  deleteSourceLink,
  getSettings,
  insertRemoteInstall,
  listSourceLinks,
  upsertSettings,
  upsertSourceLink,
} from "./store";
import type {
  ModSourceInfo,
  RemoteInstallResult,
  RemoteModDetail,
  RemoteModSearch,
} from "./types";
import { nowSecs } from "./util";

export const NEXUS_SOURCE = "nexus";
export const WORKSHOP_SOURCE = "workshop";

const SOURCE_META: Record<string, { name: string; homepage: string }> = {
  nexus: { name: "Nexus Mods", homepage: "https://www.nexusmods.com" },
  workshop: { name: "Steam Workshop", homepage: "https://steamcommunity.com/workshop/" },
};

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nexusKeyOrThrow(): string {
  const key = nexus.getApiKey();
  if (!key) {
    throw new Error(
      "Nexus Mods API key not set — add it in Settings → Mods to browse Nexus and check for updates",
    );
  }
  return key;
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?nexusmods\.com\//, "")
    .replace(/\/+$/, "")
    .replace(/\/mods\/.*$/, "");
}

export function storedDomain(gameId: string): string | null {
  const link = listSourceLinks(gameId).find((row) => row.source === NEXUS_SOURCE);
  if (link?.externalId) return link.externalId;
  const settings = getSettings(gameId);
  return settings?.nexusDomain?.trim() || null;
}

export function setSourceLink(
  gameId: string,
  source: string,
  externalId: string,
  displayName?: string | null,
): void {
  if (!gameId.trim()) throw new Error("invalid_source_link: select a game first");
  const id = source === NEXUS_SOURCE ? normalizeDomain(externalId) : externalId.trim();
  if (!id) throw new Error("invalid_source_link: the game id cannot be empty");
  upsertSourceLink({
    gameId,
    source,
    externalId: id,
    ...(displayName ? { displayName } : {}),
    updatedAt: nowSecs(),
  });
  if (source === NEXUS_SOURCE) {
    const settings = getSettings(gameId);
    if (settings) {
      upsertSettings({ ...settings, gameId, nexusDomain: id, updatedAt: nowSecs() });
    }
  }
}

export function clearSourceLink(gameId: string, source: string): void {
  deleteSourceLink(gameId, source);
}

async function resolveNexusDomain(gameId: string): Promise<string | null> {
  const existing = storedDomain(gameId);
  if (existing) return existing;
  const key = nexus.getApiKey();
  const game = getGame(gameId);
  if (!key || !game?.name) return null;
  try {
    const games = await nexusFetchGames(key);
    const target = normalizeName(game.name);
    let best: { score: number; domain: string } | null = null;
    for (const entry of games) {
      const name = typeof entry.name === "string" ? entry.name : "";
      const domain = typeof entry.domain_name === "string" ? entry.domain_name : "";
      if (!domain) continue;
      const candidate = normalizeName(name);
      let score = 0;
      if (candidate && candidate === target) score = 100;
      else if (candidate && (candidate.includes(target) || target.includes(candidate))) score = 60;
      if (score > 0 && (!best || score > best.score)) best = { score, domain };
    }
    if (!best) return null;
    upsertSourceLink({
      gameId,
      source: NEXUS_SOURCE,
      externalId: best.domain,
      displayName: best.domain,
      updatedAt: nowSecs(),
    });
    return best.domain;
  } catch {
    return null;
  }
}

interface NexusGameEntry {
  name?: string;
  domain_name?: string;
}

let gamesCache: NexusGameEntry[] | null = null;

async function nexusFetchGames(key: string): Promise<NexusGameEntry[]> {
  if (gamesCache) return gamesCache;
  const value = await httpJson<unknown>("https://api.nexusmods.com/v1/games.json", {
    headers: { apikey: key, accept: "application/json" },
    timeoutMs: 20_000,
  });
  const list = Array.isArray(value)
    ? (value as NexusGameEntry[])
    : Array.isArray((value as Record<string, unknown>).games)
      ? ((value as Record<string, unknown>).games as NexusGameEntry[])
      : [];
  gamesCache = list;
  return list;
}

export async function detectSources(gameId: string, resolve: boolean): Promise<ModSourceInfo[]> {
  const game = getGame(gameId);
  const steamAppId =
    typeof game?.steamAppId === "number" && Number.isFinite(game.steamAppId)
      ? String(game.steamAppId)
      : typeof game?.steamAppId === "string"
        ? game.steamAppId
        : null;

  const hasNexusKey = !!nexus.getApiKey();
  let domain = storedDomain(gameId);
  if (!domain && resolve) domain = await resolveNexusDomain(gameId);

  const sources: ModSourceInfo[] = [
    {
      id: NEXUS_SOURCE,
      name: SOURCE_META.nexus.name,
      homepage: SOURCE_META.nexus.homepage,
      requiresCredential: true,
      hasCredential: hasNexusKey,
      available: hasNexusKey && !!domain,
      ...(domain ? { externalId: domain, externalLabel: domain } : {}),
      directDownload: true,
      supportsSearch: true,
      ...(hasNexusKey
        ? domain
          ? {}
          : { note: "Pick the game's Nexus domain (its URL slug) below." }
        : { note: "Add a Nexus Mods API key in Settings → Mods." }),
    },
    {
      id: WORKSHOP_SOURCE,
      name: SOURCE_META.workshop.name,
      homepage: SOURCE_META.workshop.homepage,
      requiresCredential: false,
      hasCredential: true,
      // Browsing the Workshop catalogue needs Steam's Web API, which this
      // build does not call. Installed Workshop items are still listed and
      // toggled by the Mods scanner.
      available: false,
      ...(steamAppId ? { externalId: steamAppId, externalLabel: steamAppId } : {}),
      directDownload: false,
      supportsSearch: false,
      note: "Workshop items are managed by Steam; GameIndex lists and toggles installed items but cannot browse or download them.",
    },
  ];

  return sources;
}

function requireSource(source: string): { name: string; homepage: string } {
  const meta = SOURCE_META[source];
  if (!meta) {
    throw new Error(
      `unsupported_source: ${source} browsing is not available in the Electron build yet`,
    );
  }
  return meta;
}

export async function browseSource(
  source: string,
  externalId: string,
  query: string,
  sort: string,
  page: number,
  pageSize: number,
): Promise<RemoteModSearch> {
  requireSource(source);
  if (source === NEXUS_SOURCE) {
    const key = nexusKeyOrThrow();
    return nexus.browse(key, normalizeDomain(externalId), query, sort, page, pageSize);
  }
  return {
    source,
    query,
    results: [],
    page,
    total: 0,
    hasMore: false,
  };
}

export async function detailSource(
  source: string,
  externalId: string,
  modId: string,
): Promise<RemoteModDetail> {
  requireSource(source);
  if (source === NEXUS_SOURCE) {
    const key = nexusKeyOrThrow();
    return nexus.detail(key, normalizeDomain(externalId), modId);
  }
  throw new Error(
    `unsupported_source: ${source} mod details are not available in the Electron build yet`,
  );
}

function safeArchiveName(filename: string, fallback: string): string {
  const base = path.basename(filename || fallback).replace(/[^\w.\- ()[\]]+/g, "_");
  return base || `${fallback}.zip`;
}

function modDownloadsDir(): string {
  const dir = userDataPath("mod-downloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface DownloadArgs {
  gameId: string;
  source: string;
  externalId: string;
  modId: string;
  fileId?: string | null;
  name?: string | null;
  author?: string | null;
  version?: string | null;
  remoteUrl?: string | null;
  destination?: string | null;
}

export async function downloadSource(args: DownloadArgs): Promise<RemoteInstallResult> {
  requireSource(args.source);

  if (args.source === WORKSHOP_SOURCE) {
    const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(args.modId)}`;
    return {
      status: "steam",
      installedFiles: 0,
      url,
      message: "Workshop items install through Steam - open the item page.",
    };
  }

  const destination =
    args.destination?.trim() || getSettings(args.gameId)?.customRoot || getSettings(args.gameId)?.modsRoot || null;
  if (!destination || !fs.existsSync(destination)) {
    throw new Error("install_target_missing: select a mods folder first");
  }

  const key = nexusKeyOrThrow();
  const domain = normalizeDomain(args.externalId);
  const premium = (await nexus.isPremiumCached()) ?? false;
  const plan = await nexus.resolveDownload(key, domain, args.modId, args.fileId ?? null, premium);
  if (plan.kind !== "direct") {
    return {
      status: "external",
      installedFiles: 0,
      url: plan.url,
      ...(plan.message ? { message: plan.message } : {}),
    };
  }

  const label = args.name?.trim() || args.modId;
  const archive = path.join(modDownloadsDir(), safeArchiveName(plan.filename ?? "", label));
  emit("mods-remote-progress", {
    source: args.source,
    modId: args.modId,
    phase: "downloading",
    downloaded: 0,
    total: null,
  });
  let bytes = 0;
  try {
    const result = await downloadToFile(plan.url, archive, {
      timeoutMs: 120_000,
      headers: { referer: `https://www.nexusmods.com/${domain}/mods/${args.modId}` },
      onProgress: (downloaded) => {
        bytes = downloaded;
      },
    });
    bytes = result.bytes;
  } catch (error) {
    throw new Error(
      `download_failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  emit("mods-remote-progress", {
    source: args.source,
    modId: args.modId,
    phase: "installing",
    downloaded: bytes,
    total: bytes,
  });

  let installedFiles = 0;
  try {
    installedFiles = await installArchive(archive, destination);
  } catch (error) {
    // A conflict or unsupported format keeps the archive for the manual modal.
    insertRemoteInstall({
      id: `mri-${args.gameId}-${nowSecs()}-${Math.floor(Math.random() * 1000)}`,
      gameId: args.gameId,
      source: args.source,
      sourceModId: args.modId,
      ...(args.fileId ? { sourceFileId: args.fileId } : {}),
      name: label,
      ...(args.author ? { author: args.author } : {}),
      ...(args.version ? { version: args.version } : {}),
      remoteUrl: args.remoteUrl ?? plan.url,
      installedPath: archive,
      installedAt: nowSecs(),
    });
    return {
      status: "manual",
      installedPath: archive,
      installedFiles: 0,
      url: plan.url,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  insertRemoteInstall({
    id: `mri-${args.gameId}-${nowSecs()}-${Math.floor(Math.random() * 1000)}`,
    gameId: args.gameId,
    source: args.source,
    sourceModId: args.modId,
    ...(args.fileId ? { sourceFileId: args.fileId } : {}),
    name: label,
    ...(args.author ? { author: args.author } : {}),
    ...(args.version ? { version: args.version } : {}),
    remoteUrl: args.remoteUrl ?? plan.url,
    installedPath: destination,
    installedAt: nowSecs(),
  });

  emit("mods-remote-progress", {
    source: args.source,
    modId: args.modId,
    phase: "complete",
    downloaded: bytes,
    total: bytes,
    message: `${installedFiles} files installed`,
  });

  try {
    fs.rmSync(archive, { force: true });
  } catch {
    /* temp archive cleanup is best effort */
  }

  return {
    status: "installed",
    installedPath: destination,
    installedFiles,
    url: plan.url,
  };
}

/** Compare two versions the way the Rust `version_is_newer` did. */
export function versionIsNewer(installed: string | undefined, latest: string): boolean {
  if (!installed || !installed.trim()) return false;
  const left = versionTokens(installed);
  const right = versionTokens(latest);
  if (installed.trim().toLowerCase() === latest.trim().toLowerCase()) return false;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined && b !== undefined) return true;
    if (a !== undefined && b === undefined) return false;
    if (a === undefined || b === undefined) break;
    const na = Number(a);
    const nb = Number(b);
    const comparable = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.toLowerCase().localeCompare(b.toLowerCase());
    if (comparable !== 0) return comparable < 0;
  }
  return false;
}

function versionTokens(value: string): string[] {
  return value
    .trim()
    .replace(/^[vV]/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Latest version advertised by a source for a mod (Nexus only here). */
export async function latestVersionFor(
  source: string,
  externalId: string,
  modId: string,
): Promise<string | null> {
  if (source !== NEXUS_SOURCE) return null;
  const key = nexus.getApiKey();
  if (!key) return null;
  const detailResult = await nexus.detail(key, normalizeDomain(externalId), modId);
  const primary = detailResult.files.find((file) => file.isPrimary) ?? detailResult.files[0];
  return detailResult.summary.version ?? primary?.version ?? null;
}
