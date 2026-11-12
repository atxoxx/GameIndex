/**
 * RetroAchievements provider.
 *
 * Port of `src-tauri/src/retro.rs`: console/settings management, console game
 * search, the forced-game link, ROM-hash matching, and the per-game progress
 * sync that produces the same Steam-shaped `GameAchievementData` the other
 * providers return (`source: "retro"`, `providerId` = RA game id).
 *
 * Credentials (username + Web API key) live in this module's own settings
 * document, encrypted with Electron's `safeStorage` when the platform offers a
 * keyring. Every network command fails with an actionable message when the
 * account is not configured or RA rejects the pair.
 *
 * Endpoints (RA legacy PHP API, mirroring the SuccessStory plugin):
 *  - `API_GetConsoleIDs.php`
 *  - `API_GetGameList.php?i=<console>&h=1` (includes ROM MD5s)
 *  - `API_GetGameInfoAndUserProgress.php?u=<user>&g=<game>`
 */
import { safeStorage } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type {
  Achievement,
  AchievementLink,
  Game,
  GameAchievementData,
  RaConsole,
  RaSearchResult,
  RetroConsoleMapEntry,
  RetroSettings,
  RetroSettingsUpdate,
} from "../../../../src/types/game";
import { httpText } from "../../lib/http";
import { createJsonStore } from "../../state/jsonStore";
import { getGame } from "../../state/libraryStore";
import {
  deleteLink,
  getLink,
  getLinksForGame,
  upsertGame,
  upsertLink,
} from "./store";
import { nowSeconds, sortAchievements } from "./util";

const RA_API_BASE = "https://retroachievements.org/API/";
const RA_BADGE_UNLOCKED = "https://s3-eu-west-1.amazonaws.com/i.retroachievements.org/Badge/{}.png";
const RA_BADGE_LOCKED =
  "https://s3-eu-west-1.amazonaws.com/i.retroachievements.org/Badge/{}_lock.png";
/** Source tag for `achievement_links` + the achievements cache. */
const SOURCE = "retro";
/** Console list + per-console game list cache lifetime (5 days). */
const CACHE_TTL_SECS = 5 * 24 * 60 * 60;
/** Console ids the plugin excludes from hash matching. */
const CONSOLE_EXCLUDE_HASH = new Set([2, 8, 12, 16, 21, 40, 41, 47, 49, 76]);
const ZIP_EXTRACT_MAX_BYTES = 20 * 1024 * 1024;
const FILE_HASH_MAX_BYTES = 300 * 1024 * 1024;

// ── Wire types ────────────────────────────────────────────────────────

interface RaGameWire {
  id: number;
  title: string;
  numAchievements: number;
  hashes: string[];
}

interface RaAchievementWire {
  title: string;
  description: string;
  badgeName: string;
  dateEarned: string | null;
  numAwarded: number | null;
}

interface RaProgressWire {
  title: string;
  numDistinctPlayersCasual: number | null;
  achievements: Record<string, RaAchievementWire>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseGameWire(raw: unknown): RaGameWire | null {
  const row = record(raw);
  // RA returns PascalCase keys; accept the lowercase variants defensively.
  const id = num(row.ID ?? row.id);
  if (id <= 0) return null;
  const hashes: string[] = [];
  const rawHashes = row.Hashes ?? row.hashes;
  if (Array.isArray(rawHashes)) {
    for (const hash of rawHashes) {
      const text = str(hash).trim().toLowerCase();
      if (text) hashes.push(text);
    }
  }
  return {
    id,
    title: str(row.Title ?? row.title),
    numAchievements: num(row.NumAchievements ?? row.numAchievements),
    hashes,
  };
}

function parseProgressWire(raw: unknown): RaProgressWire {
  const row = record(raw);
  const achievements: Record<string, RaAchievementWire> = {};
  for (const [key, value] of Object.entries(record(row.Achievements))) {
    const entry = record(value);
    achievements[key] = {
      title: str(entry.Title),
      description: str(entry.Description),
      badgeName: str(entry.BadgeName),
      dateEarned:
        typeof entry.DateEarned === "string" && entry.DateEarned.trim()
          ? entry.DateEarned.trim()
          : null,
      numAwarded:
        entry.NumAwarded === null || entry.NumAwarded === undefined
          ? null
          : num(entry.NumAwarded),
    };
  }
  return {
    title: str(row.Title),
    numDistinctPlayersCasual:
      row.NumDistinctPlayersCasual === null || row.NumDistinctPlayersCasual === undefined
        ? null
        : num(row.NumDistinctPlayersCasual),
    achievements,
  };
}

// ── Settings document ─────────────────────────────────────────────────

interface StoredSecret {
  encrypted: boolean;
  value: string;
}

interface RetroState {
  username: string | null;
  apiKey: StoredSecret | null;
  consoleMap: RetroConsoleMapEntry[];
  enabled: boolean;
  consolesCache: { fetchedAt: number; consoles: RaConsole[] } | null;
  gamesCache: Record<string, { fetchedAt: number; games: RaGameWire[] }>;
}

interface SettingsDocument {
  version: number;
  localAchievementsEnabled: boolean;
  retro: RetroState;
}

function defaultRetroState(): RetroState {
  return {
    username: null,
    apiKey: null,
    consoleMap: [],
    enabled: true,
    consolesCache: null,
    gamesCache: {},
  };
}

function normalizeConsoleMap(raw: unknown): RetroConsoleMapEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RetroConsoleMapEntry[] = [];
  for (const entry of raw) {
    const row = record(entry);
    const platform = str(row.platform).trim();
    const consoleId = num(row.consoleId);
    if (platform && consoleId > 0) out.push({ platform, consoleId });
  }
  return out;
}

function normalizeSettings(raw: unknown): SettingsDocument {
  const doc = record(raw);
  const retro = record(doc.retro);
  const gamesCache: RetroState["gamesCache"] = {};
  for (const [consoleId, value] of Object.entries(record(retro.gamesCache))) {
    const row = record(value);
    const games: RaGameWire[] = [];
    if (Array.isArray(row.games)) {
      for (const game of row.games) {
        const parsed = parseGameWire(game);
        if (parsed) games.push(parsed);
      }
    }
    gamesCache[consoleId] = { fetchedAt: num(row.fetchedAt), games };
  }

  const consolesRaw = record(retro.consolesCache);
  const consoles: RaConsole[] = [];
  if (Array.isArray(consolesRaw.consoles)) {
    for (const entry of consolesRaw.consoles) {
      const row = record(entry);
      const id = num(row.id ?? row.ID);
      const name = str(row.name ?? row.Name);
      if (id > 0) consoles.push({ id, name });
    }
  }

  const apiKeyRaw = record(retro.apiKey);
  const apiKey: StoredSecret | null = str(apiKeyRaw.value)
    ? { encrypted: apiKeyRaw.encrypted === true, value: str(apiKeyRaw.value) }
    : null;

  const username = str(retro.username).trim();

  return {
    version: 1,
    localAchievementsEnabled: doc.localAchievementsEnabled !== false,
    retro: {
      username: username || null,
      apiKey,
      consoleMap: normalizeConsoleMap(retro.consoleMap),
      enabled: retro.enabled !== false,
      consolesCache:
        consoles.length > 0
          ? { fetchedAt: num(consolesRaw.fetchedAt), consoles }
          : null,
      gamesCache,
    },
  };
}

const settingsStore = createJsonStore<SettingsDocument>(
  "achievement-settings.json",
  () => ({
    version: 1,
    localAchievementsEnabled: true,
    retro: defaultRetroState(),
  }),
  normalizeSettings,
);

function updateSettings(mutate: (doc: SettingsDocument) => SettingsDocument): void {
  settingsStore.update((current) => {
    const next = mutate(current);
    next.version = 1;
    return next;
  });
}

export function isLocalAchievementsEnabled(): boolean {
  return settingsStore.read().localAchievementsEnabled;
}

export function setLocalAchievementsEnabled(enabled: boolean): void {
  updateSettings((doc) => ({ ...doc, localAchievementsEnabled: enabled }));
}

// ── Credential storage ────────────────────────────────────────────────

function encryptSecret(value: string): StoredSecret {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { encrypted: true, value: safeStorage.encryptString(value).toString("base64") };
    }
  } catch (error) {
    console.warn("[achievements] OS keyring unavailable for the RA key:", error);
  }
  return { encrypted: false, value };
}

let decryptFailureLogged = false;

function decryptSecret(secret: StoredSecret | null): string | null {
  if (!secret?.value) return null;
  if (!secret.encrypted) return secret.value;
  try {
    return safeStorage.decryptString(Buffer.from(secret.value, "base64"));
  } catch (error) {
    if (!decryptFailureLogged) {
      decryptFailureLogged = true;
      console.warn(
        "[achievements] could not decrypt the stored RetroAchievements key — re-enter it in " +
          "Settings → Achievements:",
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  }
}

interface RetroCredentials {
  username: string;
  apiKey: string;
}

function loadCredentials(): { username: string | null; apiKey: string | null } {
  const retro = settingsStore.read().retro;
  return {
    username: retro.username && retro.username.trim() ? retro.username.trim() : null,
    apiKey: (() => {
      const key = decryptSecret(retro.apiKey);
      return key && key.trim() ? key.trim() : null;
    })(),
  };
}

function requireCredentials(): RetroCredentials {
  const { username, apiKey } = loadCredentials();
  if (!username || !apiKey) {
    throw new Error(
      "RetroAchievements is not configured — add your username and Web API key in " +
        "Settings → Achievements.",
    );
  }
  return { username, apiKey };
}

// ── Settings commands ─────────────────────────────────────────────────

export function getRetroSettings(): RetroSettings {
  const { username, apiKey } = loadCredentials();
  const retro = settingsStore.read().retro;
  return {
    username,
    hasApiKey: apiKey !== null,
    consoleMap: retro.consoleMap.map((entry) => ({ ...entry })),
    enabled: retro.enabled,
  };
}

/** Persist only the provided fields; an empty username / key clears it. */
export function saveRetroSettings(patch: RetroSettingsUpdate): void {
  updateSettings((doc) => {
    const retro = { ...doc.retro };
    if (patch.username !== undefined) {
      const username = patch.username.trim();
      retro.username = username ? username : null;
    }
    if (patch.apiKey !== undefined) {
      const apiKey = patch.apiKey.trim();
      retro.apiKey = apiKey ? encryptSecret(apiKey) : null;
    }
    if (patch.consoleMap !== undefined) {
      retro.consoleMap = normalizeConsoleMap(patch.consoleMap);
    }
    if (patch.enabled !== undefined) retro.enabled = patch.enabled;
    return { ...doc, retro };
  });
  // The API key changes invalidate the per-console caches fetched with it.
  if (patch.apiKey !== undefined || patch.username !== undefined) {
    updateSettings((doc) => ({
      ...doc,
      retro: { ...doc.retro, consolesCache: null, gamesCache: {} },
    }));
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────

function md5Hex(bytes: Buffer): string {
  return createHash("md5").update(bytes).digest("hex");
}

function sliceRange(bytes: Buffer, start: number, length: number): Buffer {
  if (start >= bytes.length) return Buffer.alloc(0);
  return bytes.subarray(start, Math.min(start + length, bytes.length));
}

/** NDS: `header(352) + ARM9 + ARM7 + icon(2560)`, offsets from the header. */
function preprocessNds(bytes: Buffer): Buffer {
  if (bytes.length < 0x70) return bytes;
  const le32 = (offset: number): number => bytes.readUInt32LE(offset);
  const arm9Offset = le32(0x20);
  const arm9Size = le32(0x2c);
  const arm7Offset = le32(0x30);
  const arm7Size = le32(0x3c);
  const bannerOffset = le32(0x68);

  return Buffer.concat([
    bytes.subarray(0, Math.min(352, bytes.length)),
    sliceRange(bytes, arm9Offset, arm9Size),
    sliceRange(bytes, arm7Offset, arm7Size),
    sliceRange(bytes, bannerOffset, 2560),
  ]);
}

type RaPlatformType = "all" | "snes" | "segaCdSaturn" | "nes" | "famicom" | "arcade" | "nds";

/** Per-platform ROM preprocessing, exactly the plugin's byte payloads. */
function preprocessRom(
  bytes: Buffer,
  platform: RaPlatformType,
  fileName: string,
): Buffer {
  switch (platform) {
    case "all":
      return bytes;
    case "snes":
      // Drop the 512-byte copier header when present.
      return bytes.length > 512 ? bytes.subarray(512) : bytes;
    case "nes":
    case "famicom": {
      const magic = platform === "nes" ? Buffer.from("NES\x1a") : Buffer.from("FDS\x1a");
      if (bytes.length >= 16 && bytes.subarray(0, 4).equals(magic)) {
        return bytes.subarray(16);
      }
      return bytes;
    }
    case "segaCdSaturn":
      return bytes.subarray(0, Math.min(512, bytes.length));
    case "arcade": {
      const base = fileName.split(/[\\/]/).pop() ?? fileName;
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      return Buffer.from(
        Array.from(stem, (char) => (char.charCodeAt(0) > 127 ? 0x3f : char.charCodeAt(0))),
      );
    }
    case "nds":
      return preprocessNds(bytes);
  }
}

/** Remove every `(...)` / `[...]` segment (non-nested). */
function stripDelimited(value: string, open: string, close: string): string {
  let out = "";
  let depth = 0;
  for (const char of value) {
    if (char === open) depth += 1;
    else if (char === close) depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

/**
 * Documented approximation of the plugin's `NormalizeGameName`: trim, strip
 * bracketed/parenthetical content, then collapse every run of
 * punctuation/whitespace to a single space.
 */
export function normalizeGameName(name: string): string {
  const withoutBrackets = stripDelimited(name, "[", "]");
  const stripped = stripDelimited(withoutBrackets, "(", ")");
  let out = "";
  let pendingSpace = false;
  for (const char of stripped.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      if (pendingSpace && out.length > 0) out += " ";
      pendingSpace = false;
      out += char;
    } else {
      pendingSpace = true;
    }
  }
  return out;
}

const PLATFORM_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["sega genesis", "mega drive"],
  ["nintendo snes", "snes"],
  ["super nintendo entertainment system", "snes"],
  ["super nintendo", "snes"],
  ["nintendo game boy", "game boy"],
  ["nintendo game boy advance", "game boy advance"],
  ["nintendo game boy color", "game boy color"],
  ["nintendo entertainment system", "nes"],
  ["pc engine supergrafx", "pc engine"],
  ["sega 32x", "32x"],
  ["sega master system", "master system"],
  ["sony playstation", "playstation"],
  ["snk neo geo pocket", "neo geo pocket"],
  ["sega game gear", "game gear"],
  ["nintendo gamecube", "gamecube"],
  ["nintendo wii", "wii"],
  ["nintendo wii u", "wii u"],
  ["sony playstation 2", "playstation 2"],
  ["microsoft xbox", "xbox"],
  ["magnavox odyssey2", "magnavox odyssey 2"],
  ["pc (dos)", "dos"],
  ["various", "arcade"],
  ["mame 2003 plus", "arcade"],
  ["nintendo virtual boy", "virtual boy"],
  ["sega sg 1000", "sg-1000"],
  ["atari st/ste/tt/falcon", "atari st"],
  ["sega saturn", "saturn"],
  ["sega dreamcast", "dreamcast"],
  ["sony playstation portable", "playstation portable"],
  ["sony psp", "playstation portable"],
  ["coleco colecovision", "colecovision"],
  ["snk neo geo cd", "neo geo cd"],
];

export function normalizePlatformName(platform: string): string {
  const key = platform.trim().toLowerCase();
  for (const [from, to] of PLATFORM_ALIASES) {
    if (key === from) return to;
  }
  if (key.includes("grafx")) return "pc engine";
  return key;
}

function resolveConsoleId(
  platformKey: string,
  consoleMap: RetroConsoleMapEntry[],
): number | null {
  const key = normalizePlatformName(platformKey);
  if (!key) return null;
  const entry = consoleMap.find((row) => normalizePlatformName(row.platform) === key);
  return entry?.consoleId ?? null;
}

/** RA title → game-id match: normalized equality, then `|` / `-` fragments. */
function matchByName(gameName: string, games: RaGameWire[]): number | null {
  const wanted = normalizeGameName(gameName);
  for (const game of games) {
    if (normalizeGameName(game.title) === wanted) return game.id;
  }
  const target = gameName.trim();
  for (const game of games) {
    for (const fragment of game.title.split(/[|-]/)) {
      const trimmed = fragment.trim();
      if (trimmed && trimmed.toLowerCase() === target.toLowerCase()) return game.id;
    }
  }
  return null;
}

/** Plugin rarity formula: `NumAwarded * 100 / NumDistinctPlayersCasual`. */
function raPercent(numAwarded: number | null, distinctPlayers: number | null): number {
  if (numAwarded && distinctPlayers && numAwarded > 0 && distinctPlayers > 0) {
    return Math.floor((numAwarded * 100) / distinctPlayers);
  }
  return 100;
}

/** RA `YYYY-MM-DD HH:MM:SS` (UTC) → unix seconds. */
export function parseRaDateTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const ms = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isNaN(ms) ? null : Math.max(0, Math.floor(ms / 1000));
}

/** Map a parsed progress response to the shared Steam-shaped payload. */
export function mapProgressToData(
  raGameId: number,
  progress: RaProgressWire,
): GameAchievementData {
  const achievements: Achievement[] = Object.entries(progress.achievements).map(
    ([apiName, row]) => {
      const achieved = row.dateEarned !== null && row.dateEarned.length > 0;
      return {
        apiName,
        displayName: row.title,
        description: row.description,
        icon: RA_BADGE_UNLOCKED.replace("{}", row.badgeName),
        iconGray: RA_BADGE_LOCKED.replace("{}", row.badgeName),
        achieved,
        unlockTime: achieved ? (parseRaDateTime(row.dateEarned as string) ?? 0) : 0,
        percent: raPercent(row.numAwarded, progress.numDistinctPlayersCasual),
      };
    },
  );
  sortAchievements(achievements);
  const unlocked = achievements.reduce((count, a) => count + (a.achieved ? 1 : 0), 0);
  return {
    steamAppId: 0,
    achievements,
    total: achievements.length,
    unlocked,
    locked: achievements.length - unlocked,
    lastSynced: nowSeconds(),
    source: SOURCE,
    providerId: String(raGameId),
  };
}

// ── ROM hash matching ─────────────────────────────────────────────────

function buildHashMap(games: RaGameWire[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const game of games) {
    for (const hash of game.hashes) {
      if (!map.has(hash)) map.set(hash, game.id);
    }
  }
  return map;
}

function readZipEntry(zipPath: string): Buffer | null {
  try {
    const stat = fs.statSync(zipPath);
    if (stat.size > ZIP_EXTRACT_MAX_BYTES) return null;
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      return entry.getData();
    }
    return null;
  } catch (error) {
    console.warn("[achievements] could not read the zipped ROM:", error);
    return null;
  }
}

/** Try every platform variant and return the first game whose hash matches. */
export function matchByHash(romPath: string, games: RaGameWire[]): number | null {
  const hashToGame = buildHashMap(games);
  if (hashToGame.size === 0) return null;

  const lower = romPath.toLowerCase();
  if (lower.endsWith(".rar") || lower.endsWith(".7z")) return null;

  let bytes: Buffer | null;
  let fileName: string;
  if (lower.endsWith(".zip")) {
    bytes = readZipEntry(romPath);
    fileName = path.basename(romPath);
  } else {
    try {
      const stat = fs.statSync(romPath);
      if (stat.size > FILE_HASH_MAX_BYTES) return null;
      bytes = fs.readFileSync(romPath);
      fileName = path.basename(romPath);
    } catch (error) {
      console.warn("[achievements] could not read the ROM for hashing:", error);
      return null;
    }
  }
  if (!bytes) return null;

  const find = (platform: RaPlatformType): number | null => {
    const digest = md5Hex(preprocessRom(bytes as Buffer, platform, fileName));
    return hashToGame.get(digest) ?? null;
  };

  if (path.extname(fileName).toLowerCase() === ".nds") {
    const nds = find("nds");
    if (nds !== null) return nds;
  }
  for (const platform of [
    "all",
    "snes",
    "nes",
    "arcade",
    "famicom",
    "segaCdSaturn",
  ] as const) {
    const hit = find(platform);
    if (hit !== null) return hit;
  }
  return null;
}

/** Forced id → console map → ROM hash → normalized name. */
function pickGameId(
  forced: number | null,
  consoleId: number | null,
  games: RaGameWire[],
  romPath: string | null,
  gameName: string,
): number {
  if (forced !== null) return forced;
  if (consoleId === null) {
    throw new Error(
      "No RetroAchievements console mapped for this game — configure one in Settings → " +
        "Achievements, or link the game manually.",
    );
  }
  if (romPath && !CONSOLE_EXCLUDE_HASH.has(consoleId)) {
    const hashMatch = matchByHash(romPath, games);
    if (hashMatch !== null) return hashMatch;
  }
  const nameMatch = matchByName(gameName, games);
  if (nameMatch !== null) return nameMatch;
  throw new Error(
    `No RetroAchievements game matched "${gameName}" — search the console's game list and ` +
      `link it manually.`,
  );
}

// ── HTTP + caches ─────────────────────────────────────────────────────

async function getJson(url: string, label: string): Promise<string> {
  const response = await httpText(url, { timeoutMs: 30_000, retries: 1 });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  if (response.text.includes("Unauthenticated")) {
    throw new Error(
      "RetroAchievements rejected the credentials — check your username and Web API key.",
    );
  }
  return response.text;
}

function cacheFresh(fetchedAt: number): boolean {
  return fetchedAt > 0 && nowSeconds() - fetchedAt <= CACHE_TTL_SECS;
}

/** Full RA console list (5-day cached) for the settings picker. */
export async function getRetroConsoles(): Promise<RaConsole[]> {
  const credentials = requireCredentials();
  const cached = settingsStore.read().retro.consolesCache;
  if (cached && cacheFresh(cached.fetchedAt)) return cached.consoles.map((c) => ({ ...c }));

  const url =
    `${RA_API_BASE}API_GetConsoleIDs.php` +
    `?z=${encodeURIComponent(credentials.username)}&y=${encodeURIComponent(credentials.apiKey)}`;
  const body = await getJson(url, "RetroAchievements console list");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new Error(
      `Could not parse the RetroAchievements console list: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const consoles: RaConsole[] = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const row = record(entry);
      const id = num(row.ID ?? row.id);
      if (id > 0) consoles.push({ id, name: str(row.Name ?? row.name) });
    }
  }
  updateSettings((doc) => ({
    ...doc,
    retro: { ...doc.retro, consolesCache: { fetchedAt: nowSeconds(), consoles } },
  }));
  return consoles;
}

async function fetchGameList(consoleId: number): Promise<RaGameWire[]> {
  const credentials = requireCredentials();
  const cacheKey = String(consoleId);
  const cached = settingsStore.read().retro.gamesCache[cacheKey];
  if (cached && cacheFresh(cached.fetchedAt)) return cached.games;

  const url =
    `${RA_API_BASE}API_GetGameList.php` +
    `?z=${encodeURIComponent(credentials.username)}&y=${encodeURIComponent(credentials.apiKey)}` +
    `&i=${consoleId}&h=1`;
  const body = await getJson(url, "RetroAchievements game list");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new Error(
      `Could not parse the RetroAchievements game list for console ${consoleId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const games: RaGameWire[] = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const game = parseGameWire(entry);
      if (game) games.push(game);
    }
  }
  updateSettings((doc) => ({
    ...doc,
    retro: {
      ...doc.retro,
      gamesCache: {
        ...doc.retro.gamesCache,
        [cacheKey]: { fetchedAt: nowSeconds(), games },
      },
    },
  }));
  return games;
}

// ── Links ─────────────────────────────────────────────────────────────

function retroLink(gameId: string): AchievementLink | null {
  return getLink(gameId, SOURCE);
}

function forcedGameId(gameId: string): number | null {
  const providerId = retroLink(gameId)?.providerId ?? null;
  if (!providerId) return null;
  const parsed = Number(providerId);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Stored RetroAchievements game id "${providerId}" is invalid.`);
  }
  return Math.trunc(parsed);
}

function lookupTitleFromCache(raGameId: number): string | null {
  for (const cache of Object.values(settingsStore.read().retro.gamesCache)) {
    const game = cache.games.find((entry) => entry.id === raGameId);
    if (game) return game.title;
  }
  return null;
}

function nowTitleFor(gameId: string): string | null {
  try {
    return getGame(gameId)?.name ?? null;
  } catch {
    return null;
  }
}

export function setForcedRaGameId(gameId: string, raGameId: number | null): AchievementLink {
  const existing = retroLink(gameId);
  if (raGameId === null) {
    deleteLink(gameId, SOURCE);
    return {
      gameId,
      source: SOURCE,
      providerId: null,
      displayName: null,
      sourceUrl: null,
      manualUnlocks: null,
      createdAt: 0,
      updatedAt: 0,
    };
  }
  const title =
    existing?.displayName ?? lookupTitleFromCache(raGameId) ?? nowTitleFor(gameId);
  return upsertLink({
    gameId,
    source: SOURCE,
    providerId: String(raGameId),
    displayName: title,
    sourceUrl: `https://retroachievements.org/game/${raGameId}`,
    manualUnlocks: existing?.manualUnlocks ?? null,
  });
}

export function getLinksForRetroGame(gameId: string): AchievementLink[] {
  return getLinksForGame(gameId).filter((link) => link.source === SOURCE);
}

// ── Search ────────────────────────────────────────────────────────────

export async function searchRetroGames(
  consoleId: number,
  query: string,
): Promise<RaSearchResult[]> {
  const games = await fetchGameList(consoleId);
  const wanted = query.trim().toLowerCase();
  const wantedNormalized = normalizeGameName(query.trim());
  const results: RaSearchResult[] = [];
  for (const game of games) {
    if (
      !wanted ||
      game.title.toLowerCase().includes(wanted) ||
      normalizeGameName(game.title).includes(wantedNormalized)
    ) {
      results.push({
        id: game.id,
        title: game.title,
        numAchievements: game.numAchievements,
      });
      if (results.length >= 100) break;
    }
  }
  results.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  return results;
}

// ── Sync ──────────────────────────────────────────────────────────────

function platformKeyForGame(game: Game): string | null {
  const platform = typeof game.platform === "string" ? game.platform.trim() : "";
  return platform ? platform : null;
}

/**
 * Full sync for one game: resolve the RA game id (forced → console map → ROM
 * hash → name), fetch the user's progress, and persist both the `retro` link
 * and the achievements cache row.
 */
export async function syncRetroGame(gameId: string): Promise<GameAchievementData> {
  const credentials = requireCredentials();

  let game: Game | null;
  try {
    game = getGame(gameId);
  } catch (error) {
    throw new Error(
      `Could not read game ${gameId} from the library: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!game) throw new Error(`Game ${gameId} not found.`);

  const forced = forcedGameId(gameId);
  let consoleId: number | null = null;
  let games: RaGameWire[] = [];

  if (forced === null) {
    const platformKey = platformKeyForGame(game);
    const mapped = platformKey
      ? resolveConsoleId(platformKey, settingsStore.read().retro.consoleMap)
      : null;
    if (mapped === null) {
      throw new Error(
        "No RetroAchievements console mapped for this game — configure one in Settings → " +
          "Achievements, or link the game manually.",
      );
    }
    consoleId = mapped;
    games = await fetchGameList(mapped);
  }

  const raGameId = pickGameId(
    forced,
    consoleId,
    games,
    typeof game.romPath === "string" ? game.romPath : null,
    game.name,
  );

  const url =
    `${RA_API_BASE}API_GetGameInfoAndUserProgress.php` +
    `?z=${encodeURIComponent(credentials.username)}&y=${encodeURIComponent(credentials.apiKey)}` +
    `&u=${encodeURIComponent(credentials.username)}&g=${raGameId}`;
  const body = await getJson(url, "RetroAchievements game progress");
  let progressRaw: unknown;
  try {
    progressRaw = JSON.parse(body);
  } catch (error) {
    throw new Error(
      `Could not parse the RetroAchievements progress response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const progress = parseProgressWire(progressRaw);
  const data = mapProgressToData(raGameId, progress);

  upsertLink({
    gameId,
    source: SOURCE,
    providerId: String(raGameId),
    displayName: progress.title || lookupTitleFromCache(raGameId) || game.name,
    sourceUrl: `https://retroachievements.org/game/${raGameId}`,
    manualUnlocks: retroLink(gameId)?.manualUnlocks ?? null,
  });
  upsertGame(gameId, data, {
    source: SOURCE,
    providerId: String(raGameId),
    steamAppId: 0,
    lastSynced: data.lastSynced,
  });

  return data;
}

/** Kept for callers that need the raw console list without a settings round-trip. */
export function isRetroConfigured(): boolean {
  return (
    settingsStore.read().retro.username !== null &&
    decryptSecret(settingsStore.read().retro.apiKey) !== null
  );
}
