/**
 * Download DTOs — the exact wire shapes the Downloads UI consumes.
 *
 * Mirrors `src/types/download.ts` (which mirrors the retired Rust
 * `downloads::types`). Field names are camelCase, `DownloadStatus` is
 * adjacently tagged on `kind` / `message`, and timestamps are Unix seconds.
 */

export type DownloadStatus =
  | { kind: "queued" }
  | { kind: "fetchingMetadata" }
  | { kind: "downloading" }
  | { kind: "paused" }
  | { kind: "seeding" }
  | { kind: "completed" }
  | { kind: "removed" }
  | { kind: "error"; message: string };

export type DownloadKind = "torrent" | "direct" | "debrid";

export interface DownloadFile {
  name: string;
  size: number;
  downloaded: number;
  progress: number;
  selected: boolean;
}

/** What a post-download action does (mirrors Rust `PostActionKind`). */
export type PostActionKind = "openFolder" | "launchInstaller";

export interface PostAction {
  id: string;
  kind: PostActionKind;
  onSuccess: boolean;
  onFailure: boolean;
  path?: string | null;
}

/** Engine-wide download preferences (Rust `post_actions::DownloadSettings`). */
export interface DownloadSettings {
  multiConnection: boolean;
  segmentCount: number;
  installerOptIn: boolean;
  postActions: PostAction[];
}

export type ScheduleDays = [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
];

export interface BandwidthRule {
  id: string;
  label: string;
  days: ScheduleDays;
  start: string;
  end: string;
  downloadKbps: number;
  uploadKbps: number;
  disableUpload: boolean;
}

export interface SchedulerConfig {
  enabled: boolean;
  windowEnabled: boolean;
  windowStart: string;
  windowEnd: string;
  days: ScheduleDays;
  maxConcurrent: number;
  autoStartQueued: boolean;
  pauseOutsideWindow: boolean;
  pauseOnGame: boolean;
  bandwidthRules: BandwidthRule[];
}

/**
 * One download's full state. Every field the renderer's `TorrentDownload`
 * declares is present (optionals stay optional) so the record can be sent
 * straight over IPC.
 */
export interface DownloadRecord {
  id: string;
  kind: DownloadKind;
  name: string;
  sourceUri: string;
  savePath: string;
  downloaded: number;
  totalSize: number | null;
  progress: number | null;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  seeds: number;
  status: DownloadStatus;
  gameId: string | null;
  gamePoster?: string;
  sourceName: string;
  addedAt: number;
  completedAt?: number;
  peakSpeed?: number;
  files: DownloadFile[];
  autoExtract?: boolean;
  extracted?: boolean;
  uris?: string[];
  debridCached?: boolean;
  shouldSeed?: boolean;
  queuePosition?: number;
  magnetUri?: string;
  scheduledStartAt?: number;
  priority?: number;
  uploaded?: number;
  postActions?: PostAction[];
  postActionStatus?: string;
  /** Extra HTTP headers for hosters (name/value pairs, like Rust). */
  extraHeaders?: Array<[string, string]>;
  /** `Referer` for .torrent fetches / direct hosters. */
  referer?: string;
  /** Torrent/debrid file selection; `undefined` = all files. */
  onlyFiles?: number[];
  /** Provider-side debrid transfer id (AllDebrid/TorBox/…) for resume. */
  debridTransferId?: string;
  /** Expected hashes for a direct download, verified after the transfer. */
  checksums?: ChecksumSpec[];
}

/** One expected checksum (from a plugin result) for a downloaded file. */
export interface ChecksumSpec {
  algo: string;
  value: string;
}

/** One row of `download_history_get` (renderer `DownloadHistory`). */
export interface DownloadHistoryRow {
  id: number;
  downloadId: string;
  kind: DownloadKind;
  name: string;
  sourceName: string;
  savePath: string;
  downloaded: number;
  totalSize: number | null;
  status: DownloadStatus;
  debridCached: boolean | null;
  autoExtract: boolean | null;
  extracted: boolean | null;
  addedAt: number;
  completedAt: number | null;
  peakSpeed: number;
}

export interface TorrentPeerBreakdown {
  live: number;
  liveTcp: number;
  liveUtp: number;
  queued: number;
  connecting: number;
  dead: number;
  seen: number;
  etaSecs: number | null;
  averagePieceMs: number | null;
}

export interface TorrentPeerInfo {
  address: string;
  state: string;
  client?: string | null;
  connection?: string | null;
  downloaded: number;
  uploaded: number;
  pieces: number;
  errors: number;
}

/** `download_torrent_detail` payload (renderer `TorrentDetail`). */
export interface TorrentDetail {
  id: string;
  infoHash: string;
  name: string;
  magnetUri?: string | null;
  savePath: string;
  sourceName: string;
  status: DownloadStatus;
  totalSize: number | null;
  downloaded: number;
  uploaded: number;
  ratio: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  seeds: number;
  peakSpeed: number;
  addedAt: number;
  completedAt: number | null;
  breakdown: TorrentPeerBreakdown;
  peerList: TorrentPeerInfo[];
  trackers: string[];
  files: DownloadFile[];
  onlyFiles: number[] | null;
  stalled: boolean;
}

/** A debrid file entry resolved for download. */
export interface DebridResolvedFile {
  name: string;
  size: number;
  /** Direct link; may be empty when the provider mints links lazily. */
  link: string;
  /** Provider-side file id (TorBox / Premiumize). */
  fileId?: number | null;
}

export interface DebridStatus {
  id: string;
  /** 0..100, provider-reported. */
  progress: number;
  status: "ready" | "downloading" | "queued" | "error";
  files: DebridResolvedFile[];
  name: string | null;
  magnetSize: number | null;
  errorMessage: string | null;
}

export interface DebridUserInfo {
  username: string;
  premiumUntil: number | null;
}

export interface DebridCacheResult {
  cached: boolean;
  /** AllDebrid probe magnet that could not be removed from the account. */
  probeId: string | null;
}

export interface DebridFileEntry {
  name: string;
  size: number;
}

export interface DebridFileListResult {
  files: DebridFileEntry[];
  name: string | null;
  totalSize: number;
  probeId: string | null;
}

/** Per-provider debrid operations used by the manager and commands. */
export interface DebridProvider {
  readonly id: string;
  testKey(apikey: string): Promise<DebridUserInfo>;
  uploadMagnet(
    apikey: string,
    magnet: string,
  ): Promise<{ id: string; cached: boolean }>;
  getStatus(apikey: string, id: string): Promise<DebridStatus>;
  unrestrictLink(apikey: string, url: string): Promise<string>;
  checkCache(apikey: string, magnet: string): Promise<DebridCacheResult>;
  listMagnetFiles(
    apikey: string,
    magnet: string,
  ): Promise<DebridFileListResult>;
  /** Best-effort account cleanup used by probe flows. */
  deleteTransfer?(apikey: string, id: string): Promise<void>;
  /** Mint a fresh link for a file that was resolved earlier. */
  refreshFileLink?(
    apikey: string,
    file: DebridResolvedFile,
    transferId: string,
  ): Promise<string | null>;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  multiConnection: true,
  segmentCount: 8,
  installerOptIn: false,
  postActions: [],
};

export const DEFAULT_SCHEDULER_DAYS: ScheduleDays = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

/**
 * First-run scheduler configuration. `maxConcurrent` starts at the
 * engine's default cap of 2 (0 still means unlimited when a user sets it).
 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  windowEnabled: false,
  windowStart: "00:00",
  windowEnd: "06:00",
  days: [...DEFAULT_SCHEDULER_DAYS] as ScheduleDays,
  maxConcurrent: 2,
  autoStartQueued: true,
  pauseOutsideWindow: false,
  pauseOnGame: false,
  bandwidthRules: [],
};

/** Placeholder record name while torrent/debrid metadata is resolving. */
export const PENDING_METADATA_NAME = "Fetching metadata\u2026";
