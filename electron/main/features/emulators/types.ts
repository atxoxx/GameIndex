/**
 * Wire shapes for the emulation workstream.
 *
 * Every interface here mirrors a type the renderer already declares in
 * `src/types/emulator.ts` (and the Rust structs those were ported from), so the
 * Emulators page, the ROM detail modal and the big-screen page can consume the
 * results without a translation layer. Field names are camelCase on the wire;
 * optional fields are omitted (not `null`) exactly where the Rust structs used
 * `skip_serializing_if`.
 */

/** One configured emulator (`emulators.json`, previously `emulators.db`). */
export interface EmulatorRow {
  id: string;
  name: string;
  platform: string;
  executablePath: string;
  /** Launch-argument template; `%ROM%` is replaced with the ROM path. */
  argumentsTemplate: string;
  romFolder: string;
  notes?: string;
  iconUrl?: string;
  biosFolder?: string;
  savesFolder?: string;
  autoScan?: boolean;
  createdAt: number;
  updatedAt: number;
  /**
   * Unknown keys (e.g. a future `portable` flag) survive a save round-trip
   * instead of being silently dropped by the normalized store.
   */
  [key: string]: unknown;
}

export interface EmulatorsDocument {
  version: 1;
  emulators: EmulatorRow[];
}

/** Per-ROM launch profile (persisted on the game row, not in this store). */
export interface RomProfile {
  argumentsOverride?: string;
  graphicsBackend?: string;
  resolution?: string;
  controllerLayout?: string;
  shaders?: string;
  fullscreen?: boolean;
  envVars?: string[];
}

/** Filename identification result (`rom_identify`). */
export interface ParsedRomName {
  cleanTitle: string;
  region?: string;
  language?: string;
  group?: string;
  disc?: number;
  /**
   * `ok` when the filename produced a usable title, `unknown` when it carried
   * nothing but tags (or was empty). The renderer ignores the extra key today;
   * it exists so a caller can refuse to invent a title.
   */
  code: "ok" | "unknown";
}

export interface RomMetadataCandidate {
  title: string;
  description?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  genres: string[];
  coverUrl?: string;
  sourceUrl?: string;
  sourceName?: string;
  igdbId?: number;
}

export interface RomMetadataPatch {
  name?: string;
  coverArtUrl?: string;
  description?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  genres?: string[];
  screenshots?: string[];
  region?: string;
  language?: string;
}

export interface RomEnrichSummary {
  requested: number;
  matched: number;
  failed: number;
  skipped: number;
}

/** Payload of the `rom-enrich-progress` event. */
export interface RomEnrichProgress {
  emulatorId: string;
  done: number;
  total: number;
  title: string;
}

export interface RomSaveEntry {
  path: string;
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  backedUp: boolean;
}

export interface SaveSnapshot {
  name: string;
  createdAtMs: number;
  fileCount: number;
  sizeBytes: number;
}

export interface RomSavesStatus {
  savesConfigured: boolean;
  savesFolder?: string;
  hasSaves: boolean;
  saveCount: number;
  lastSaveMtime?: number;
  lastBackupMtime?: number;
  outdated: boolean;
}

/** Manifest written next to a ROM's snapshots (`rom-saves/<game>/manifest.json`). */
export interface RomSaveManifestEntry {
  name: string;
  createdAtMs: number;
  fileCount: number;
  sizeBytes: number;
  files: Array<{ relativePath: string; sizeBytes: number; modifiedAtMs: number }>;
}

export interface RomSaveManifest {
  version: 1;
  gameId: string;
  romPath?: string;
  savesFolder?: string;
  snapshots: RomSaveManifestEntry[];
}

export interface BiosRequirement {
  name: string;
  description?: string;
  expectedSha1?: string;
  mandatory: boolean;
}

export interface BiosStatus {
  name: string;
  description?: string;
  found: boolean;
  path?: string;
  hashOk?: boolean;
  mandatory: boolean;
}

export interface BiosCheckResult {
  platform: string;
  biosFolder?: string;
  configured: boolean;
  requirements: BiosStatus[];
  missing: string[];
}

export interface BiosBoardEntry {
  emulatorId: string;
  emulatorName: string;
  platform: string;
  check: BiosCheckResult;
  ready: boolean;
}

export interface DiscoveredEmulator {
  key: string;
  name: string;
  platform: string;
  executablePath: string;
  executableName: string;
}

export interface DuplicateGroup {
  hash: string;
  sizeBytes: number;
  games: import("../../../../src/types/game").Game[];
}

export interface RomLaunchPlan {
  executablePath: string;
  arguments: string;
  /**
   * Directory the process should start in (the emulator's own folder). The
   * renderer's `launch_game` call keeps spawning from its own cwd today; the
   * field is reported so a spawner can honour it.
   */
  workingDir?: string;
  envVars?: string[];
  extractedRomPath?: string;
  savesStatus?: RomSavesStatus;
  /** Mandatory firmware files the platform table expects but did not find. */
  biosMissing?: string[];
}

/** One row of the downloadable-emulator catalog (`list_emulator_downloads`). */
export interface EmulatorDownloadRow {
  key: string;
  url: string;
  exeName: string;
  archiveRoot?: string;
  sizeHint?: string;
  notes?: string;
  buildKind: "native" | "wine" | "windows";
}

/** Persisted install spec so `finish_emulator_install` survives a restart. */
export interface EmulatorInstallSpec {
  downloadId: string;
  emulatorKey: string;
  installDir: string;
  archivePath: string;
  createdAtMs: number;
  extracted: boolean;
}

export interface EmulatorInstallsDocument {
  version: 1;
  installs: Record<string, EmulatorInstallSpec>;
}

// ── Health scan (`emulator_health.rs`) ────────────────────────────────

export type EmulatorHealthKind =
  | "missing_executable"
  | "missing_rom_folder"
  | "missing_rom"
  | "empty_rom"
  | "missing_bios"
  | "bios_unconfigured"
  | "unknown_size"
  | "duplicate_rom";

export interface EmulatorHealthFinding {
  id: string;
  kind: EmulatorHealthKind;
  severity: "error" | "warning" | "info";
  emulatorId?: string;
  emulatorName?: string;
  gameId?: string;
  gameName?: string;
  gameIds: string[];
  paths: string[];
  path?: string;
  missingFiles: string[];
  message: string;
  fix?: "edit_emulator" | "unlink_rom" | "recalc_sizes" | "review_duplicates";
  bytes?: number;
}

export interface EmulatorHealthReport {
  findings: EmulatorHealthFinding[];
  systems: number;
  roms: number;
  errors: number;
  warnings: number;
  missingRoms: number;
  missingBios: number;
  duplicateGroups: number;
  reclaimableBytes: number;
  deep: boolean;
  checkedAtMs: number;
}

/** JSON document produced by `export_emulators_config`. */
export interface EmulatorsExportDocument {
  version: 1;
  exportedAtMs: number;
  emulators: EmulatorRow[];
  romProfiles: Record<string, RomProfile>;
}
