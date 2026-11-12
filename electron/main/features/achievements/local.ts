/**
 * Local (crack / emulator) achievement discovery + parsing.
 *
 * Port of `src-tauri/src/local_achievements.rs` and the merge half of
 * `src-tauri/src/achievements.rs` (`sync_local_for_game`,
 * `merge_into_cache`).
 *
 * Cracked / repacked games ship achievement emulators (Goldberg, CODEX, RUNE,
 * OnlineFix, RLD!, Skidrow, CreamAPI, SmartSteamEmu, EMPRESS, Razor1911, 3DM, …)
 * that write local achievement state files under well-known folders keyed by
 * the game's Steam appid. This module locates those files, parses them into
 * `{ name, unlockTime }` records, and merges the unlock state into the same
 * Steam-shaped payload the Web API path produces — with the schema (names,
 * icons, descriptions, rarity) fetched from Steam's public sources.
 *
 * Unlock times are milliseconds on disk and in `UnlockedAchievement`; the merge
 * converts to seconds, matching the cached `Achievement` model.
 */
import fs from "node:fs";
import path from "node:path";
import type { Achievement, GameAchievementData } from "../../../../src/types/game";
import { getAppSetting } from "../../state/appSettings";
import { fetchSteamSchema } from "./steam";
import { getCachedGame, upsertGame } from "./store";
import { apiNameKey, nowMillis, sortAchievements } from "./util";

export interface UnlockedAchievement {
  /** Internal achievement name (matches Steam's `name` / api_name). */
  name: string;
  /** Unlock time in milliseconds. */
  unlockTime: number;
}

export interface AchievementFile {
  cracker: Cracker;
  path: string;
}

type Cracker =
  | "codex"
  | "rune"
  | "onlineFix"
  | "goldberg"
  | "userStats"
  | "rld"
  | "creamApi"
  | "skidrow"
  | "smartSteamEmu"
  | "empress"
  | "razor1911"
  | "rle"
  | "threedm";

/** The crackers we scan for, in priority order. */
const CRACKERS: readonly Cracker[] = [
  "codex",
  "goldberg",
  "rune",
  "onlineFix",
  "rld",
  "creamApi",
  "skidrow",
  "smartSteamEmu",
  "empress",
  "razor1911",
  "rle",
];

type WinRoot = "appData" | "localAppData" | "programData" | "documents" | "publicDocuments";

interface CrackerPath {
  root: WinRoot;
  rel: string[];
  fileLocation: string[];
}

function pathsForCracker(cracker: Cracker): CrackerPath[] {
  switch (cracker) {
    case "codex":
      return [
        {
          root: "publicDocuments",
          rel: ["Steam", "CODEX"],
          fileLocation: ["<objectId>", "achievements.ini"],
        },
        {
          root: "appData",
          rel: ["Steam", "CODEX"],
          fileLocation: ["<objectId>", "achievements.ini"],
        },
      ];
    case "rune":
      return [
        {
          root: "publicDocuments",
          rel: ["Steam", "RUNE"],
          fileLocation: ["<objectId>", "achievements.ini"],
        },
      ];
    case "onlineFix":
      return [
        {
          root: "publicDocuments",
          rel: ["OnlineFix"],
          fileLocation: ["<objectId>", "Stats", "Achievements.ini"],
        },
        {
          root: "publicDocuments",
          rel: ["OnlineFix"],
          fileLocation: ["<objectId>", "Achievements.ini"],
        },
      ];
    case "goldberg":
      return [
        {
          root: "appData",
          rel: ["Goldberg SteamEmu Saves"],
          fileLocation: ["<objectId>", "achievements.json"],
        },
        {
          root: "appData",
          rel: ["GSE Saves"],
          fileLocation: ["<objectId>", "achievements.json"],
        },
      ];
    case "rld":
      return [
        {
          root: "programData",
          rel: ["RLD!"],
          fileLocation: ["<objectId>", "achievements.ini"],
        },
        {
          root: "programData",
          rel: ["Steam", "Player"],
          fileLocation: ["<objectId>", "stats", "achievements.ini"],
        },
        {
          root: "programData",
          rel: ["Steam", "RLD!"],
          fileLocation: ["<objectId>", "stats", "achievements.ini"],
        },
        {
          root: "programData",
          rel: ["Steam", "dodi"],
          fileLocation: ["<objectId>", "stats", "achievements.ini"],
        },
      ];
    case "empress":
      return [
        {
          root: "appData",
          rel: ["EMPRESS", "remote"],
          fileLocation: ["<objectId>", "achievements.json"],
        },
        {
          root: "publicDocuments",
          rel: ["EMPRESS"],
          fileLocation: ["<objectId>", "remote", "<objectId>", "achievements.json"],
        },
      ];
    case "skidrow":
      return [
        {
          root: "documents",
          rel: ["SKIDROW"],
          fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
        },
        {
          root: "documents",
          rel: ["Player"],
          fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
        },
        {
          root: "localAppData",
          rel: ["SKIDROW"],
          fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
        },
      ];
    case "creamApi":
      return [
        {
          root: "appData",
          rel: ["CreamAPI"],
          fileLocation: ["<objectId>", "stats", "CreamAPI.Achievements.cfg"],
        },
      ];
    case "smartSteamEmu":
      return [
        {
          root: "appData",
          rel: ["SmartSteamEmu"],
          fileLocation: ["<objectId>", "User", "Achievements.ini"],
        },
      ];
    case "rle":
      return [
        { root: "appData", rel: ["RLE"], fileLocation: ["<objectId>", "achievements.ini"] },
        { root: "appData", rel: ["RLE"], fileLocation: ["<objectId>", "Achievements.ini"] },
      ];
    case "razor1911":
      return [
        { root: "appData", rel: [".1911"], fileLocation: ["<objectId>", "achievement"] },
      ];
    default:
      // 3DM / UserStats live next to the executable, not in a shared folder.
      return [];
  }
}

// ── Root resolution (Windows + Wine) ──────────────────────────────────

function nativeRoot(root: WinRoot): string[] {
  const env = process.env;
  switch (root) {
    case "appData":
      return env.APPDATA ? [env.APPDATA] : [];
    case "localAppData":
      return env.LOCALAPPDATA ? [env.LOCALAPPDATA] : [];
    case "programData":
      return [env.ProgramData ?? "C:\\ProgramData"];
    case "documents":
      return env.USERPROFILE ? [path.join(env.USERPROFILE, "Documents")] : [];
    case "publicDocuments":
      return ["C:\\Users\\Public\\Documents"];
  }
}

/** `drive_c` dirs inside the detected Wine prefixes (non-Windows only). */
function wineDriveRoots(): string[] {
  const candidates: string[] = [];
  if (process.env.WINEPREFIX && process.env.WINEPREFIX.trim()) {
    candidates.push(process.env.WINEPREFIX);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) {
    candidates.push(
      path.join(home, ".wine"),
      path.join(home, ".wineprefixes"),
      path.join(home, ".var/app/org.winehq.Wine/data/wineprefixes"),
      path.join(home, ".var/app/org.winehq.wine/data/wineprefixes"),
      path.join(home, ".var/app/com.usebottles.bottles/data/bottles/bottles"),
      path.join(home, ".PlayOnLinux/wineprefix"),
      path.join(home, "Games"),
    );
  }

  const drives: string[] = [];
  for (const root of candidates) {
    const drive = path.join(root, "drive_c");
    if (isDirectory(drive)) {
      drives.push(drive);
      continue;
    }
    // A container of prefixes: each child dir may hold a `drive_c`.
    for (const entry of safeReadDir(root)) {
      const child = path.join(root, entry.name);
      if (entry.isDirectory() && isDirectory(path.join(child, "drive_c"))) {
        drives.push(path.join(child, "drive_c"));
      }
    }
  }
  return drives;
}

/** User profile dirs under `drive_c/users`, skipping Public / Default. */
function rootInsideDrive(drive: string, root: WinRoot): string[] {
  if (root === "programData") return [path.join(drive, "ProgramData")];
  if (root === "publicDocuments") {
    return [path.join(drive, "users", "Public", "Documents")];
  }
  const out: string[] = [];
  for (const entry of safeReadDir(path.join(drive, "users"))) {
    if (!entry.isDirectory()) continue;
    if (/^(public|default)$/i.test(entry.name)) continue;
    const userDir = path.join(drive, "users", entry.name);
    if (root === "appData") out.push(path.join(userDir, "AppData", "Roaming"));
    else if (root === "localAppData") out.push(path.join(userDir, "AppData", "Local"));
    else out.push(path.join(userDir, "Documents"));
  }
  return out;
}

function resolveRoots(root: WinRoot): string[] {
  if (process.platform === "win32") {
    return nativeRoot(root).filter((entry) => entry.length > 0);
  }
  const out: string[] = [];
  for (const drive of wineDriveRoots()) out.push(...rootInsideDrive(drive, root));
  return out;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function safeReadDir(target: string): fs.Dirent[] {
  try {
    return fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Dishonored ships achievements under sibling appids. */
export function getAlternativeObjectIds(objectId: string): string[] {
  if (objectId === "205100") return ["205100", "217980", "31292"];
  return [objectId];
}

// ── Discovery ─────────────────────────────────────────────────────────

function mapFileLocation(location: string[], objectId: string): string[] {
  return location.map((segment) => segment.replace(/<objectId>/g, objectId));
}

/** Achievement files that live inside the game's install directory. */
export function findAchievementFilesInExecutableDirectory(
  exePath: string | null | undefined,
): AchievementFile[] {
  if (!exePath) return [];
  const dir = path.dirname(exePath);
  const candidates: Array<[Cracker, string]> = [
    ["userStats", path.join(dir, "SteamData", "user_stats.ini")],
    ["threedm", path.join(dir, "3DMGAME", "Player", "stats", "achievements.ini")],
  ];
  return candidates
    .filter(([, candidate]) => exists(candidate))
    .map(([cracker, file]) => ({ cracker, path: file }));
}

function exists(target: string): boolean {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Find crack achievement files for a single game (by Steam appid). */
export function findAchievementFiles(
  steamAppId: number,
  exePath?: string | null,
): AchievementFile[] {
  const out: AchievementFile[] = [];
  const objectIds = getAlternativeObjectIds(String(steamAppId));

  for (const cracker of CRACKERS) {
    for (const table of pathsForCracker(cracker)) {
      for (const root of resolveRoots(table.root)) {
        const folder = path.join(root, ...table.rel);
        for (const objectId of objectIds) {
          const filePath = path.join(folder, ...mapFileLocation(table.fileLocation, objectId));
          if (exists(filePath)) out.push({ cracker, path: filePath });
        }
      }
    }
  }

  out.push(...findAchievementFilesInExecutableDirectory(exePath));
  return out;
}

// ── Parsing ───────────────────────────────────────────────────────────

type IniObject = Map<string, Array<[string, string]>>;

/** INI parser: strips a BOM, skips blank / `###` lines, keeps section order. */
function iniParse(filePath: string): IniObject {
  const raw = fs.readFileSync(filePath, "utf8");
  const content = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const object: IniObject = new Map();
  object.set("", []);
  let section = "";

  for (const line of content.split(/\r|\n/)) {
    if (!line || line.startsWith("###")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      if (!object.has(section)) object.set(section, []);
      continue;
    }
    const index = line.indexOf("=");
    if (index < 0) continue;
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    const entries = object.get(section) ?? [];
    entries.push([name, value]);
    object.set(section, entries);
  }
  return object;
}

function sectionEntries(object: IniObject, name: string): Array<[string, string]> | undefined {
  return object.get(name);
}

function entriesToMap(entries: Array<[string, string]>): Map<string, string> {
  return new Map(entries);
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/** Parse a hex string as a little-endian u32. */
function hexLeU32(text: string): number {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 2) {
    const byte = Number.parseInt(text.slice(i, i + 2), 16);
    if (Number.isFinite(byte)) bytes.push(byte);
  }
  let value = 0;
  for (let i = 0; i < Math.min(4, bytes.length); i += 1) {
    value |= bytes[i] << (8 * i);
  }
  return value >>> 0;
}

/** CODEX / RUNE / RLE / SmartSteamEmu: `Achieved=1` + `UnlockTime=<secs>`. */
function processDefault(object: IniObject): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = [];
  for (const [name, entries] of object) {
    if (!name) continue;
    const map = entriesToMap(entries);
    if (map.get("Achieved") === "1") {
      out.push({ name, unlockTime: parseNumber(map.get("UnlockTime")) * 1000 });
    }
  }
  return out;
}

/** OnlineFix: `achieved=true` / `Achieved=true` variants. */
function processOnlineFix(object: IniObject): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = [];
  for (const [name, entries] of object) {
    if (!name) continue;
    const map = entriesToMap(entries);
    if (map.get("achieved") === "true") {
      out.push({ name, unlockTime: parseNumber(map.get("timestamp")) * 1000 });
    } else if (map.get("Achieved") === "true") {
      const raw = map.get("TimeUnlocked") ?? "0";
      const value = parseNumber(raw);
      out.push({
        name,
        unlockTime: raw.trim().length === 7 ? value * 1000 * 1000 : value * 1000,
      });
    }
  }
  return out;
}

/** CreamAPI: `achieved=true` + `unlocktime`. */
function processCreamApi(object: IniObject): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = [];
  for (const [name, entries] of object) {
    if (!name) continue;
    const map = entriesToMap(entries);
    if (map.get("achieved") === "true") {
      const raw = map.get("unlocktime") ?? "0";
      const value = parseNumber(raw);
      out.push({
        name,
        unlockTime: raw.trim().length === 7 ? value * 1000 * 1000 : value * 1000,
      });
    }
  }
  return out;
}

/** Skidrow: `[Achievements]` values look like `1@…@<secs>`. */
function processSkidrow(object: IniObject): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = [];
  const entries = sectionEntries(object, "Achievements");
  if (!entries) return out;
  for (const [name, value] of entries) {
    const parts = value.split("@");
    if (parts[0] === "1") {
      out.push({ name, unlockTime: parseNumber(parts[parts.length - 1]) * 1000 });
    }
  }
  return out;
}

/** Goldberg / EMPRESS: JSON array or object of `{ earned, earned_time }`. */
function processGoldberg(value: unknown): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = [];
  const collect = (name: string, entry: unknown): void => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;
    if (row.earned !== true) return;
    out.push({
      name,
      unlockTime: parseNumber(String(row.earned_time ?? 0)) * 1000,
    });
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      collect(String((entry as Record<string, unknown>).name ?? ""), entry);
    }
    return out.filter((entry) => entry.name.length > 0);
  }
  if (value && typeof value === "object") {
    for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
      collect(name, entry);
    }
  }
  return out;
}

/** 3DM: `[State]` = "0101" unlocked, `[Time]` hex-LE u32 seconds. */
function process3dm(object: IniObject): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = [];
  const states = sectionEntries(object, "State");
  const times = sectionEntries(object, "Time");
  if (!states || !times) return out;
  const timesMap = entriesToMap(times);
  for (const [name, state] of states) {
    if (state === "0101") {
      const seconds = hexLeU32(timesMap.get(name) ?? "");
      out.push({ name, unlockTime: seconds * 1000 });
    }
  }
  return out;
}

/** RLD!: per-section `State` (hex-LE u32 == 1) + `Time` (hex-LE u32). */
function processRld(object: IniObject): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = [];
  for (const [name, entries] of object) {
    if (!name || name === "Steam") continue;
    const map = entriesToMap(entries);
    const state = map.get("State");
    if (state === undefined) continue;
    if (hexLeU32(state) === 1) {
      out.push({ name, unlockTime: hexLeU32(map.get("Time") ?? "") * 1000 });
    }
  }
  return out;
}

/** SmartSteamEmu / UserStats: `(unlocked = true, time = <secs>)`. */
function processUserStats(object: IniObject): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = [];
  const entries = sectionEntries(object, "ACHIEVEMENTS");
  if (!entries) return out;
  for (const [name, value] of entries) {
    let inner = value;
    if (inner.startsWith("(") && inner.endsWith(")")) inner = inner.slice(1, -1);
    const text = inner.replace("unlocked = true, time = ", "").trim();
    const seconds = Number(text);
    if (Number.isFinite(seconds)) {
      out.push({ name: name.replace(/"/g, ""), unlockTime: seconds * 1000 });
    }
  }
  return out;
}

/** Razor1911: whitespace-delimited `name unlocked unlockTime` lines. */
function processRazor1911(filePath: string): UnlockedAchievement[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const content = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const out: UnlockedAchievement[] = [];
  for (const line of content.split(/\r|\n/)) {
    if (!line) continue;
    const parts = line.split(" ");
    if (parts.length >= 3 && parts[1] === "1") {
      out.push({ name: parts[0], unlockTime: parseNumber(parts[2]) * 1000 });
    }
  }
  return out;
}

/** Parse one achievement file into its unlocked achievements. */
export function parseAchievementFile(file: AchievementFile): UnlockedAchievement[] {
  try {
    switch (file.cracker) {
      case "codex":
      case "rune":
      case "rle":
      case "smartSteamEmu":
        return processDefault(iniParse(file.path));
      case "onlineFix":
        return processOnlineFix(iniParse(file.path));
      case "goldberg":
      case "empress": {
        const raw = fs.readFileSync(file.path, "utf8");
        return processGoldberg(JSON.parse(raw) as unknown);
      }
      case "userStats":
        return processUserStats(iniParse(file.path));
      case "rld":
        return processRld(iniParse(file.path));
      case "skidrow":
        return processSkidrow(iniParse(file.path));
      case "threedm":
        return process3dm(iniParse(file.path));
      case "creamApi":
        return processCreamApi(iniParse(file.path));
      case "razor1911":
        return processRazor1911(file.path);
      default:
        return [];
    }
  } catch (error) {
    console.warn(
      `[local_achievements] could not parse ${file.path} (${file.cracker}):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

// ── Sync + merge ──────────────────────────────────────────────────────

function languageSetting(): string {
  const value = getAppSetting("language");
  return typeof value === "string" && value.trim() ? value.trim() : "english";
}

export interface LocalSyncResult {
  data: GameAchievementData;
  /** Number of achievements newly unlocked in this pass. */
  newCount: number;
  /** The newly unlocked rows (already marked achieved). */
  newlyUnlocked: Achievement[];
}

/** Uppercased api name → unlock seconds for the already-achieved rows. */
function achievedMap(data: GameAchievementData | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const achievement of data?.achievements ?? []) {
    if (achievement.achieved) map.set(apiNameKey(achievement.apiName), achievement.unlockTime);
  }
  return map;
}

/**
 * Fetch the Steam schema, read every local crack/emulator file for this appid,
 * and merge the union of unlocks into the cache.
 *
 * Never relocks a previously-unlocked achievement; the earliest known unlock
 * time wins. A failed schema fetch keeps the cached row's definitions.
 */
export async function syncLocalAchievementsForGame(
  gameId: string,
  steamAppId: number,
  exePath?: string | null,
): Promise<LocalSyncResult> {
  const language = languageSetting();
  const schema = await fetchSteamSchema(steamAppId, language).catch((error) => {
    console.warn(
      `[achievements] local schema fetch failed for appid ${steamAppId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  });

  const files = findAchievementFiles(steamAppId, exePath);
  const unlocked: UnlockedAchievement[] = [];
  for (const file of files) unlocked.push(...parseAchievementFile(file));

  const existing = getCachedGame(gameId);
  const previous = achievedMap(existing);

  const base: Achievement[] =
    schema && schema.length > 0
      ? schema.map((achievement) => ({ ...achievement }))
      : (existing?.achievements ?? []).map((achievement) => ({ ...achievement }));

  if (base.length === 0) {
    const empty: GameAchievementData = existing ?? {
      steamAppId,
      achievements: [],
      total: 0,
      unlocked: 0,
      locked: 0,
      lastSynced: nowMillis(),
      source: "steam",
    };
    return { data: empty, newCount: 0, newlyUnlocked: [] };
  }

  const localUnlocked = new Map<string, number>();
  for (const entry of unlocked) {
    const key = apiNameKey(entry.name);
    if (!key) continue;
    const seconds = Math.max(0, Math.floor(entry.unlockTime / 1000));
    const current = localUnlocked.get(key);
    if (current === undefined || seconds < current) localUnlocked.set(key, seconds);
  }

  let newCount = 0;
  let unlockedCount = 0;
  const newlyUnlocked: Achievement[] = [];

  for (const achievement of base) {
    const key = apiNameKey(achievement.apiName);
    const wasAchieved = previous.has(key);
    const nowLocal = localUnlocked.has(key);
    const achieved = wasAchieved || nowLocal;

    if (achieved) {
      unlockedCount += 1;
      const previousTime = previous.get(key) ?? 0;
      const localTime = localUnlocked.get(key) ?? 0;
      achievement.unlockTime =
        previousTime === 0
          ? localTime
          : localTime === 0
            ? previousTime
            : Math.min(previousTime, localTime);
      if (!wasAchieved) {
        newCount += 1;
        newlyUnlocked.push(achievement);
      }
    }
    achievement.achieved = achieved;
  }

  sortAchievements(base);
  const data: GameAchievementData = {
    steamAppId,
    achievements: base,
    total: base.length,
    unlocked: unlockedCount,
    locked: base.length - unlockedCount,
    lastSynced: nowMillis(),
    source: "steam",
  };

  const stored = upsertGame(gameId, data, {
    source: "steam",
    steamAppId,
    lastSynced: data.lastSynced,
  });

  return { data: stored, newCount, newlyUnlocked: newlyUnlocked.map((a) => ({ ...a })) };
}
