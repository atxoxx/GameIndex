// Mod-support types — mirror the Rust `ModRow` / `GameModSettingsRow`
// shapes (src-tauri/src/db/mods.rs) after serde camelCase rename.

/** Modding "engine" a mod belongs to. Matches the backend detectors. */
export type ModEngine =
  | "bethesda"
  | "bepinex"
  | "melonloader"
  | "unreal"
  | "workshop"
  | "generic"
  | "mo2";

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
  /** Remote mod-site provenance, set when installed from Discover. */
  source?: string;
  sourceModId?: string;
  sourceFileId?: string;
  remoteUrl?: string;
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

/** Status filter for the installed-mods list. */
export type ModFilterTab = "all" | "enabled" | "disabled" | "updates" | "conflicts";

/** Sort options for the installed-mods list. */
export type ModSortOption = "order" | "name" | "size:desc" | "size:asc";

/** Compact per-game summary shown in the workspace header. */
export interface ModWorkspaceStats {
  total: number;
  enabled: number;
  updates: number;
  sizeBytes: number;
}

export interface ModConflict {
  relativePath: string;
  modIds: string[];
  /** Highest load-order enabled mod that supplies this path. */
  winnerModId?: string;
  /** Disabled providers are retained for diagnostics but do not participate in precedence. */
  disabledModIds?: string[];
}

export interface ModsOverviewEntry {
  gameId: string;
  total: number;
  enabled: number;
  updates: number;
  engines: string[];
  modsRoot?: string;
  /** Sum of on-disk mod sizes (bytes) from mods_overview — lets the
   *  global storage KPI stay accurate without visiting each game. */
  totalSizeBytes?: number;
}

export interface NexusStatus {
  connected: boolean;
  userName?: string;
  isPremium?: boolean;
  error?: string;
}

// ── Multi-source mod browsing ("Discover") ──────────────────────────

/** A supported mod website. */
export type ModSourceId =
  | "nexus"
  | "thunderstore"
  | "gamebanana"
  | "moddb"
  | "curseforge"
  | "modio"
  | "workshop";

/** Which sites have content for a game, and whether they're usable. */
export interface ModSourceInfo {
  id: ModSourceId;
  name: string;
  homepage: string;
  requiresCredential: boolean;
  hasCredential: boolean;
  /** A game→site mapping exists (and any required key is set). */
  available: boolean;
  externalId?: string;
  externalLabel?: string;
  /** False when the site can't hand out an archive (Steam Workshop). */
  directDownload: boolean;
  supportsSearch: boolean;
  note?: string;
}

export interface RemoteModSummary {
  source: ModSourceId;
  id: string;
  name: string;
  author?: string;
  summary?: string;
  version?: string;
  downloads?: number;
  endorsements?: number;
  updatedAt?: string;
  createdAt?: string;
  thumbnailUrl?: string;
  url: string;
  category?: string;
  /** Omitted by the backend when empty, so treat it as optional. */
  tags?: string[];
  fileCount?: number;
}

export interface RemoteModFile {
  id: string;
  name: string;
  version?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  category?: string;
  isPrimary: boolean;
  downloadKind: "direct" | "external" | "steam";
  downloadUrl?: string;
  fileName?: string;
}

export interface RemoteModLink {
  label: string;
  url: string;
}

export interface RemoteModDetail {
  summary: RemoteModSummary;
  description?: string;
  gallery: string[];
  files: RemoteModFile[];
  /** Omitted by the backend when empty. */
  links?: RemoteModLink[];
}

export interface RemoteModSearch {
  source: ModSourceId;
  query: string;
  results: RemoteModSummary[];
  page: number;
  total?: number;
  hasMore: boolean;
}

export type RemoteInstallStatus = "installed" | "manual" | "external" | "steam";

export interface RemoteInstallResult {
  status: RemoteInstallStatus;
  installedPath?: string;
  installedFiles: number;
  url?: string;
  message?: string;
}

export interface ModRemoteInstall {
  id: string;
  gameId: string;
  source: string;
  sourceModId: string;
  sourceFileId?: string;
  name: string;
  author?: string;
  version?: string;
  remoteUrl?: string;
  installedPath?: string;
  installedAt: number;
}

/** Progress event emitted while a remote mod is downloaded/installed. */
export interface ModRemoteProgress {
  source: string;
  modId: string;
  phase: "starting" | "downloading" | "installing" | "complete" | string;
  downloaded: number;
  total?: number;
  message?: string;
}

/** Human labels for engine badges (not localized — proper nouns). */
export const ENGINE_LABELS: Record<ModEngine, string> = {
  bethesda: "Bethesda",
  bepinex: "BepInEx",
  melonloader: "MelonLoader",
  unreal: "Unreal",
  workshop: "Workshop",
  generic: "Mods folder",
  mo2: "Mod Organizer 2",
};
