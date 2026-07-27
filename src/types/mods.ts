// Mod-support types — mirror the Rust `ModRow` / `GameModSettingsRow`
// shapes (src-tauri/src/db/mods.rs) after serde camelCase rename.

/** Modding "engine" a mod belongs to. Matches the backend detectors. */
export type ModEngine =
  | "bethesda"
  | "bepinex"
  | "melonloader"
  | "unreal"
  | "workshop"
  | "generic";

export interface GameMod {
  id: string;
  gameId: string;
  name: string;
  version?: string;
  author?: string;
  engine: ModEngine;
  /** plugin | dll | pak | folder | file */
  kind: string;
  /** Absolute path to the mod file/folder on disk. */
  path: string;
  enabled: boolean;
  loadOrder: number;
  sizeBytes?: number;
  fileCount?: number;
  md5?: string;
  nexusModId?: number;
  nexusDomain?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  notes?: string;
  detectedAt: number;
  updatedAt: number;
}

export interface GameModSettings {
  gameId: string;
  modsRoot?: string;
  /** User-picked mods folder (survives re-scans). */
  customRoot?: string;
  engine?: string;
  pluginsTxt?: string;
  nexusDomain?: string;
  updatedAt: number;
}

export interface GameModsPayload {
  mods: GameMod[];
  settings?: GameModSettings;
  engines: string[];
  /** True when the load order can be written back (plugins.txt). */
  supportsReorder: boolean;
}

export interface ModConflict {
  relativePath: string;
  modIds: string[];
}

export interface ModsOverviewEntry {
  gameId: string;
  total: number;
  enabled: number;
  updates: number;
  engines: string[];
  modsRoot?: string;
}

export interface NexusStatus {
  connected: boolean;
  userName?: string;
  isPremium?: boolean;
  error?: string;
}

/** Human labels for engine badges (not localized — proper nouns). */
export const ENGINE_LABELS: Record<ModEngine, string> = {
  bethesda: "Bethesda",
  bepinex: "BepInEx",
  melonloader: "MelonLoader",
  unreal: "Unreal",
  workshop: "Workshop",
  generic: "Mods folder",
};
