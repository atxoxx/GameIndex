/**
 * Mod-manager data shapes.
 *
 * Mirrors `src-tauri/src/db/mods.rs` after serde's camelCase rename (and
 * `src/types/mods.ts`, which the renderer already uses).
 */

export interface ModRow {
  id: string;
  gameId: string;
  name: string;
  version?: string;
  author?: string;
  engine: string;
  kind: string;
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
  source?: string;
  sourceModId?: string;
  sourceFileId?: string;
  remoteUrl?: string;
  detectedAt: number;
  updatedAt: number;
}

export interface GameModSettingsRow {
  gameId: string;
  modsRoot?: string;
  customRoot?: string;
  engine?: string;
  pluginsTxt?: string;
  nexusDomain?: string;
  updatedAt: number;
}

export interface ModProfileRow {
  id: string;
  gameId: string;
  name: string;
  modStates: Record<string, boolean>;
  loadOrder: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ModSourceLinkRow {
  gameId: string;
  source: string;
  externalId: string;
  displayName?: string;
  updatedAt: number;
}

export interface ModRemoteInstallRow {
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

export interface GameModsPayload {
  mods: ModRow[];
  settings?: GameModSettingsRow;
  engines: string[];
  supportsReorder: boolean;
  scanFilesExamined: number;
  scanTruncated: boolean;
}

export interface ModConflict {
  relativePath: string;
  modIds: string[];
  winnerModId?: string;
  disabledModIds: string[];
}

export interface ModsOverviewRow {
  gameId: string;
  total: number;
  enabled: number;
  updates: number;
  engines: string[];
  modsRoot?: string;
  totalSizeBytes?: number;
}

export interface ModHealthFinding {
  id: string;
  kind: string;
  severity: string;
  modId: string;
  name: string;
  path?: string;
  detail?: string;
}

export interface ModHealthReport {
  totalMods: number;
  enabledMods: number;
  errors: number;
  warnings: number;
  findings: ModHealthFinding[];
  checkedAtMs: number;
}

export interface ModSourceInfo {
  id: string;
  name: string;
  homepage: string;
  requiresCredential: boolean;
  hasCredential: boolean;
  available: boolean;
  externalId?: string;
  externalLabel?: string;
  directDownload: boolean;
  supportsSearch: boolean;
  note?: string;
}

export interface RemoteModSummary {
  source: string;
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

export interface RemoteModDetail {
  summary: RemoteModSummary;
  description?: string;
  gallery: string[];
  files: RemoteModFile[];
  links?: { label: string; url: string }[];
}

export interface RemoteModSearch {
  source: string;
  query: string;
  results: RemoteModSummary[];
  page: number;
  total?: number;
  hasMore: boolean;
}

export interface RemoteInstallResult {
  status: "installed" | "manual" | "external" | "steam";
  installedPath?: string;
  installedFiles: number;
  url?: string;
  message?: string;
}

export interface NexusStatus {
  connected: boolean;
  userName?: string;
  isPremium?: boolean;
  error?: string;
}

export interface ModsDocument {
  version: number;
  mods: ModRow[];
  settings: Record<string, GameModSettingsRow>;
  profiles: ModProfileRow[];
  sourceLinks: ModSourceLinkRow[];
  remoteInstalls: ModRemoteInstallRow[];
  updatedAt: number;
}
