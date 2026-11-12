/**
 * Emulator registry — `emulators.db`.
 *
 * The Rust build kept this in `emulators.db` (`src-tauri/src/db/emulators.rs`).
 * This port keeps the same one-row-per-configured-emulator model, now in the
 * real `emulators` table (unknown fields ride along in `extra_json`).
 *
 * Behaviour kept from the DAO / `emulation.rs`:
 *  • `list_emulators` is ordered by display name (case-insensitive).
 *  • `save_emulator` is an upsert keyed by `id`.
 *  • `export_emulators_config` / `import_emulators_config` round-trip a stable
 *    JSON document that also carries per-ROM launch profiles.
 *
 * Added on top (per the port brief):
 *  • Executables are validated as real files.
 *  • A second entry cannot claim the same resolved executable **for the same
 *    platform** (Dolphin GameCube + Dolphin Wii are legitimate, the same exe
 *    twice for one platform is not).
 *  • Unknown fields on an emulator survive the round trip.
 */
import fs from "node:fs";
import path from "node:path";
import { emulatorsCodec } from "../../state/db/codecs";
import { createSqliteStore } from "../../state/sqliteStore";
import { getGame, listGames, upsertGames } from "../../state/libraryStore";
import type {
  EmulatorRow,
  EmulatorsDocument,
  EmulatorsExportDocument,
  RomProfile,
} from "./types";

const MAX_EMULATORS = 500;
const DOCUMENT_VERSION = 1 as const;

const store = createSqliteStore<EmulatorsDocument>({
  domain: "emulators",
  document: "emulators",
  createDefault: () => ({ version: DOCUMENT_VERSION, emulators: [] }),
  normalize: (value) => normalizeDocument(value),
  codec: emulatorsCodec,
});

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function optionalPath(value: unknown): string | undefined {
  const raw = text(value);
  return raw.length > 0 ? raw : undefined;
}

function normalizeRow(raw: unknown, now: number): EmulatorRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = text(value.id);
  const name = text(value.name);
  if (!id || !name) return null;

  const row: EmulatorRow = {
    ...value,
    id,
    name,
    platform: text(value.platform) || "Unknown",
    executablePath: text(value.executablePath),
    argumentsTemplate: text(value.argumentsTemplate) || "%ROM%",
    romFolder: text(value.romFolder),
    createdAt: timestamp(value.createdAt, now),
    updatedAt: timestamp(value.updatedAt, now),
  };
  const notes = optionalPath(value.notes);
  const iconUrl = optionalPath(value.iconUrl);
  const biosFolder = optionalPath(value.biosFolder);
  const savesFolder = optionalPath(value.savesFolder);
  if (notes) row.notes = notes;
  else delete row.notes;
  if (iconUrl) row.iconUrl = iconUrl;
  else delete row.iconUrl;
  if (biosFolder) row.biosFolder = biosFolder;
  else delete row.biosFolder;
  if (savesFolder) row.savesFolder = savesFolder;
  else delete row.savesFolder;
  if (typeof value.autoScan === "boolean") row.autoScan = value.autoScan;
  else delete row.autoScan;
  // Internal shape guarantees: drop keys that serialize badly.
  for (const key of Object.keys(row)) {
    if (row[key] === undefined) delete row[key];
  }
  return row;
}

function normalizeDocument(value: unknown): EmulatorsDocument {
  const now = Date.now();
  const raw = value as { version?: unknown; emulators?: unknown } | null;
  const rows = Array.isArray(raw?.emulators) ? raw.emulators : [];
  const seen = new Set<string>();
  const emulators: EmulatorRow[] = [];
  for (const entry of rows) {
    const row = normalizeRow(entry, now);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    emulators.push(row);
    if (emulators.length >= MAX_EMULATORS) break;
  }
  return { version: DOCUMENT_VERSION, emulators };
}

function sortByName(rows: EmulatorRow[]): EmulatorRow[] {
  return [...rows].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

/** Absolute, case-folded form of an executable path (best effort). */
function resolveKey(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "";
  let resolved = trimmed;
  try {
    resolved = fs.realpathSync.native(trimmed);
  } catch {
    resolved = path.resolve(trimmed);
  }
  const normalized = path.normalize(resolved).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertExecutable(row: EmulatorRow): void {
  if (!row.executablePath) return;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(row.executablePath);
  } catch {
    throw new Error(
      `Emulator executable not found: ${row.executablePath} — pick the emulator's executable file again.`,
    );
  }
  if (!stat.isFile()) {
    throw new Error(
      `Emulator executable is not a file: ${row.executablePath} — pick the executable itself, not its folder.`,
    );
  }
  if (row.romFolder) {
    try {
      const folder = fs.statSync(row.romFolder);
      if (!folder.isDirectory()) {
        throw new Error(
          `ROM folder is not a folder: ${row.romFolder} — pick the folder that holds the ROM files.`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ROM folder is not a folder")) {
        throw error;
      }
      // A ROM folder that does not exist yet is allowed (it is created on scan).
    }
  }
}

export interface SaveEmulatorOptions {
  /** `false` for imports / restore paths (paths come from another machine). */
  validateExecutable?: boolean;
  /** `true` for imports (a foreign config may legitimately carry duplicates). */
  allowDuplicateExecutable?: boolean;
}

/** Every configured emulator, ordered like the Rust `list_all`. */
export function listEmulators(): EmulatorRow[] {
  return sortByName(store.read().emulators);
}

/** One configured emulator by id, or `null`. */
export function getEmulator(id: string): EmulatorRow | null {
  const key = id.trim();
  if (!key) return null;
  return store.read().emulators.find((row) => row.id === key) ?? null;
}

/**
 * Create or update an emulator. Returns the stored row.
 *
 * Throws when:
 *  • the payload has no id/name;
 *  • the executable does not exist (unless validation is off);
 *  • another emulator already uses the same executable for the same platform.
 */
export function saveEmulator(
  input: unknown,
  options: SaveEmulatorOptions = {},
): EmulatorRow {
  const now = Date.now();
  const row = normalizeRow(input, now);
  if (!row) {
    throw new Error("Invalid emulator payload — an id and a name are required.");
  }
  if (options.validateExecutable !== false) assertExecutable(row);

  const document = store.read();
  const exeKey = resolveKey(row.executablePath);
  if (exeKey && options.allowDuplicateExecutable !== true) {
    const platformKey = row.platform.trim().toLowerCase();
    const clash = document.emulators.find(
      (other) =>
        other.id !== row.id &&
        other.platform.trim().toLowerCase() === platformKey &&
        resolveKey(other.executablePath) === exeKey,
    );
    if (clash) {
      throw new Error(
        `"${clash.name}" already uses ${row.executablePath} for ${row.platform} — edit that entry instead of adding a duplicate.`,
      );
    }
  }

  const previous = getEmulator(row.id);
  row.createdAt = previous?.createdAt ?? row.createdAt;
  row.updatedAt = now;

  const existingIndex = document.emulators.findIndex((entry) => entry.id === row.id);
  const emulators =
    existingIndex >= 0
      ? document.emulators.map((entry, index) => (index === existingIndex ? row : entry))
      : [...document.emulators, row].slice(0, MAX_EMULATORS);

  store.write({ version: DOCUMENT_VERSION, emulators });
  return row;
}

/** Remove one emulator row. Returns true when a row was removed. */
export function deleteEmulator(id: string): boolean {
  const key = id.trim();
  if (!key) return false;
  const document = store.read();
  const next = document.emulators.filter((row) => row.id !== key);
  if (next.length === document.emulators.length) return false;
  store.write({ version: DOCUMENT_VERSION, emulators: next });
  return true;
}

function readRomProfile(value: unknown): RomProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const profile: RomProfile = {};
  if (typeof raw.argumentsOverride === "string" && raw.argumentsOverride.trim()) {
    profile.argumentsOverride = raw.argumentsOverride.trim();
  }
  if (typeof raw.graphicsBackend === "string" && raw.graphicsBackend.trim()) {
    profile.graphicsBackend = raw.graphicsBackend.trim();
  }
  if (typeof raw.resolution === "string" && raw.resolution.trim()) {
    profile.resolution = raw.resolution.trim();
  }
  if (typeof raw.controllerLayout === "string" && raw.controllerLayout.trim()) {
    profile.controllerLayout = raw.controllerLayout.trim();
  }
  if (typeof raw.shaders === "string" && raw.shaders.trim()) {
    profile.shaders = raw.shaders.trim();
  }
  if (typeof raw.fullscreen === "boolean" && raw.fullscreen) profile.fullscreen = true;
  if (Array.isArray(raw.envVars)) {
    const env = raw.envVars.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    if (env.length > 0) profile.envVars = env;
  }
  return Object.keys(profile).length > 0 ? profile : null;
}

/** JSON document for `export_emulators_config` (stable key order, pretty). */
export function exportEmulatorsConfig(): string {
  const emulators = listEmulators();
  const ids = new Set(emulators.map((row) => row.id));
  const romProfiles: Record<string, RomProfile> = {};
  for (const game of listGames()) {
    if (!game.emulatorId || !ids.has(game.emulatorId)) continue;
    const profile = readRomProfile(game.romProfile);
    if (profile) romProfiles[game.id] = profile;
  }
  const payload: EmulatorsExportDocument = {
    version: DOCUMENT_VERSION,
    exportedAtMs: Date.now(),
    emulators,
    romProfiles,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Import a document produced by `exportEmulatorsConfig`.
 *
 * Emulators are upserted without executable validation (they may point at
 * another machine's paths). Per-ROM profiles are applied only to games that
 * already exist in the library, exactly like the Rust import.
 */
export function importEmulatorsConfig(json: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Invalid emulator config JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const document = parsed as {
    emulators?: unknown;
    romProfiles?: unknown;
  } | null;
  const rows = Array.isArray(document)
    ? (document as unknown[])
    : Array.isArray(document?.emulators)
      ? (document?.emulators as unknown[])
      : null;
  if (!rows) {
    throw new Error(
      'Invalid emulator config: expected a JSON document with an "emulators" array.',
    );
  }

  const now = Date.now();
  let imported = 0;
  for (const entry of rows) {
    if (imported >= MAX_EMULATORS) break;
    const row = normalizeRow(entry, now);
    if (!row) continue;
    try {
      saveEmulator(
        { ...row, updatedAt: now },
        { validateExecutable: false, allowDuplicateExecutable: true },
      );
      imported += 1;
    } catch (error) {
      console.warn(`[emulators] skipped an imported emulator row:`, error);
    }
  }

  const profiles =
    document && !Array.isArray(document) && document.romProfiles && typeof document.romProfiles === "object"
      ? (document.romProfiles as Record<string, unknown>)
      : {};
  for (const [gameId, rawProfile] of Object.entries(profiles)) {
    const profile = readRomProfile(rawProfile);
    if (!profile) continue;
    const game = getGame(gameId);
    if (!game) continue;
    upsertGames([{ ...game, romProfile: profile }]);
  }

  return imported;
}
