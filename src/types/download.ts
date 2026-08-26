// TypeScript mirrors of the Rust DTOs in `src-tauri/src/torrent_engine.rs`
// and `src-tauri/src/store_checker.rs`. Field names are camelCase because
// the backend uses `#[serde(rename_all = "camelCase")]` on its structs.
import {
  DEFAULT_SIZE_UNIT,
  DEFAULT_SPEED_UNIT,
  type SizeUnit,
  type SpeedUnit,
} from "./game";
import { getActiveLocale } from "../i18n";
// wire format must stay byte-for-byte compatible, or `invoke<DownloadStatus>`
// will fail to deserialize and every Tauri command will throw.
//
// ## DownloadStatus serialization
//
// The Rust `DownloadStatus` is defined as:
//
//     #[serde(rename_all = "camelCase", tag = "kind", content = "message")]
//     pub enum DownloadStatus {
//         Queued, FetchingMetadata, Downloading, Paused, Seeding,
//         Completed, Error(String),
//     }
//
// `rename_all = "camelCase"` lower-cases the variant name's first letter
// (and joins multi-word variants into camelCase). `tag = "kind"` +
// `content = "message"` produces an **adjacently-tagged** representation:
//
//     Queued             → {"kind":"queued"}
//     FetchingMetadata   → {"kind":"fetchingMetadata"}
//     Downloading        → {"kind":"downloading"}
//     Paused             → {"kind":"paused"}
//     Seeding            → {"kind":"seeding"}
//     Completed          → {"kind":"completed"}
//     Error("...")       → {"kind":"error","message":"..."}
//
// Note the *all-lowercase* kind values — that's `rename_all = "camelCase"`
// doing its work on a single-word variant. Don't write `"Downloading"`
// in TS; the wire value is `"downloading"`.

/**
 * Status of a single torrent. Discriminated union on the `kind` field;
 * the helper functions below narrow the type-safely via `status.kind`.
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

/** Which pipeline a download runs on (mirrors the Rust `DownloadKind`). */
export type DownloadKind = "torrent" | "direct" | "debrid";

/**
 * One torrent's full state. The Rust side hands us a copy of this
 * structure on every `torrent_get_all` call (and on each `download-progress`
 * event emitted by the background polling task).
 *
 * `progress` is `null` until the engine knows `totalSize` (i.e. metadata
 * has been fetched). Once known, it's a 0.0-1.0 fraction. The
 * frontend uses `null` to render an indeterminate progress bar.
 */
export interface TorrentFile {
  name: string;
  size: number;
  downloaded: number;
  progress: number;
  selected: boolean;
}

export interface TorrentDownload {
  id: string;
  /** Pipeline this download runs on. Replaces the old `dd_`/`db_` id-prefix detection. */
  kind: DownloadKind;
  name: string;
  /** The magnet URI or .torrent URL that was passed in. */
  sourceUri: string;
  /** Folder the engine is downloading into. */
  savePath: string;
  downloaded: number;
  totalSize: number | null;
  progress: number | null;
  /** Live download speed in bytes/sec. `0` while paused / errored. */
  downloadSpeed: number;
  /** Live upload speed in bytes/sec. `0` while paused / errored. */
  uploadSpeed: number;
  /**
   * Peers currently connected to us. Mirrors
   * `LiveStats.snapshot.peer_stats.live` on the Rust side.
   */
  peers: number;
  /**
   * Peers we know about but aren't currently connected to
   * (`seen - live`, saturating). Strict seed/leech distinction
   * would require per-peer iteration, which the backend avoids on
   * the 2 s poll path.
   */
  seeds: number;
  status: DownloadStatus;
  /** Optional GameContext id, set when the DownloadModal knows the game. */
  gameId: string | null;
  /**
   * Poster image (URL or base64 data URI) of the game page this
   * download was started from. Persisted backend-side so it survives
   * the poller overwriting the record.
   */
  gamePoster?: string;
  /** Display name of the source the URI came from. */
  sourceName: string;
  /** Unix seconds when the user added the download. */
  addedAt: number;
  /** Unix seconds when the download finished (only set once completed). */
  completedAt?: number;
  /** Highest observed download speed in bytes/sec (only set once completed). */
  peakSpeed?: number;
  files: TorrentFile[];
  autoExtract?: boolean;
  extracted?: boolean;
  uris?: string[];
  /**
   * True when the debrid service already had this content cached on its
   * servers (instant download, no server-side re-fetch). Undefined for
   * non-debrid downloads or before the upload resolves.
   */
  debridCached?: boolean;
  /** True when this torrent should seed after it finishes. */
  shouldSeed?: boolean;
  /** 0-based position in the waiting queue (only set while `queued`). */
  queuePosition?: number;
  /** Original or reconstructed magnet URI. */
  magnetUri?: string;
}

/**
 * One row of the persistent download-history table. The Rust side records
 * every completed or removed download (including partials) here, so the
 * stats modal keeps counting them even after the user deletes the file
 * from the active list. Returned by the `download_history_get` Tauri
 * command, newest first.
 */
export interface DownloadHistory {
  /** Row id in the SQLite `download_history` table. */
  id: number;
  /** The original download id (matches `TorrentDownload.id`). */
  downloadId: string;
  /** Pipeline the download ran on. */
  kind: DownloadKind;
  name: string;
  /** Display name of the source the URI came from. */
  sourceName: string;
  /** Folder the engine was downloading into. */
  savePath: string;
  downloaded: number;
  totalSize: number | null;
  /** Final status. `"removed"` marks a partial download deleted before completion. */
  status: DownloadStatus;
  debridCached: boolean | null;
  autoExtract: boolean | null;
  extracted: boolean | null;
  /** Unix seconds when the download was added. */
  addedAt: number;
  /** Unix seconds when the download finished, or null if it never completed. */
  completedAt: number | null;
  /** Highest observed download speed in bytes/sec. */
  peakSpeed: number;
}

/**
 * Cross-store ownership result for a single game. Returned by
 * `check_ownership` and `check_ownership_for_ids` Tauri commands.
 *
 * The Rust side has `#[serde(rename_all = "camelCase")]` on both
 * `OwnershipResult` and `StoreOwnership` (verified), so camelCase
 * field names are correct here.
 */
export interface OwnershipResult {
  gameName: string;
  ownedStores: StoreOwnership[];
  isOwnedAnywhere: boolean;
}

export interface StoreOwnership {
  store: string;
  owned: boolean;
  storeGameId: string | null;
  details: string | null;
}

// ─── Display helpers ───────────────────────────────────────────────────────

/**
 * Render a byte/sec value as a human speed string.
 * Supports:
 * - "bytes": Decimal bytes/s (B/s, KB/s, MB/s, GB/s — in French: o/s, ko/s, Mo/s, Go/s)
 * - "binary" / "gib": Binary bytes/s (B/s, KiB/s, MiB/s, GiB/s — in French: o/s, Kio/s, Mio/s, Gio/s)
 * - "bits": Network bits/s (bit/s, kbit/s, Mbit/s, Gbit/s / Mbps)
 */
export function formatBytesPerSecond(
  bytesPerSec: number,
  unit: SizeUnit | SpeedUnit = DEFAULT_SPEED_UNIT,
  lang?: string
): string {
  const effectiveLang = lang || getActiveLocale();
  const isBits = unit === "bits";
  const isBinary = unit === "gib" || unit === "binary";

  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    if (isBits) {
      return effectiveLang === "ru" ? "0 бит/с" : "0 bit/s";
    }
    if (effectiveLang === "fr") {
      return "0 o/s";
    }
    if (effectiveLang === "ru") {
      return "0 Б/с";
    }
    return "0 B/s";
  }

  if (isBits) {
    // 1 byte = 8 bits. Telecom standard divisor is 1000.
    let value = bytesPerSec * 8;
    const units =
      effectiveLang === "ru"
        ? ["бит/с", "кбит/с", "Мбит/с", "Гбит/с", "Тбит/с"]
        : ["bit/s", "kbit/s", "Mbit/s", "Gbit/s", "Tbit/s"];
    let unitIndex = 0;
    while (value >= 1000 && unitIndex < units.length - 1) {
      value /= 1000;
      unitIndex++;
    }
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  const divisor = isBinary ? 1024 : 1000;
  let units: string[];
  if (effectiveLang === "fr") {
    units = isBinary
      ? ["o/s", "Kio/s", "Mio/s", "Gio/s", "Tio/s"]
      : ["o/s", "ko/s", "Mo/s", "Go/s", "To/s"];
  } else if (effectiveLang === "ru") {
    units = isBinary
      ? ["Б/с", "КиБ/с", "МиБ/с", "ГиБ/с", "ТиБ/с"]
      : ["Б/с", "КБ/с", "МБ/с", "ГБ/с", "ТБ/с"];
  } else {
    units = isBinary
      ? ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s"]
      : ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  }

  let value = bytesPerSec;
  let unitIndex = 0;
  while (value >= divisor && unitIndex < units.length - 1) {
    value /= divisor;
    unitIndex++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export const formatSpeed = formatBytesPerSecond;

/** Render a byte total as a short size string ("1.4 GB", "820 MB", "1.4 GiB", "820 MiB", "820 Mo", "1.4 Go"). */
export function formatBytesShort(
  bytes: number | undefined | null,
  unit: SizeUnit = DEFAULT_SIZE_UNIT,
  lang?: string
): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  const effectiveLang = lang || getActiveLocale();
  const isGib = unit === "gib";
  const divisor = isGib ? 1024 : 1000;

  let units: string[];
  if (effectiveLang === "fr") {
    units = isGib
      ? ["o", "Kio", "Mio", "Gio", "Tio", "Pio"]
      : ["o", "ko", "Mo", "Go", "To", "Po"];
  } else if (effectiveLang === "ru") {
    units = isGib
      ? ["Б", "КиБ", "МиБ", "ГиБ", "ТиБ", "ПиБ"]
      : ["Б", "КБ", "МБ", "ГБ", "ТБ", "ПБ"];
  } else {
    units = isGib
      ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
      : ["B", "KB", "MB", "GB", "TB", "PB"];
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= divisor && unitIndex < units.length - 1) {
    value /= divisor;
    unitIndex++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

/**
 * Format a progress value (0.0-1.0) as a percentage. Returns a
 * placeholder when the value is null/undefined so the UI can
 * always render a label. The output is always a non-empty string
 * (the explicit `return` on the first branch guarantees that the
 * function's `string` return type is honored at compile time).
 */
export function formatProgress(progress: number | null | undefined): string {
  if (progress === null || progress === undefined) return "—";
  if (!Number.isFinite(progress)) return "—";
  const clamped = Math.max(0, Math.min(1, progress));
  return `${Math.round(clamped * 100)}%`;
}

/** Return true if the status indicates the download is still in flight or active (not completed). */
export function isActiveStatus(status: DownloadStatus): boolean {
  return status.kind !== "completed";
}

/** Return true if the status indicates the download finished. */
export function isCompletedStatus(status: DownloadStatus): boolean {
  return status.kind === "completed";
}

/** Return true if the status indicates an error. */
export function isErrorStatus(status: DownloadStatus): boolean {
  return status.kind === "error";
}

/** Pull the error message out of a `DownloadStatus`, or null if not an error. */
export function getStatusError(status: DownloadStatus): string | null {
  return status.kind === "error" ? status.message : null;
}

type TranslateFn = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Get a short human label for any status (used in chips, tooltips).
 * The exhaustive switch on `status.kind` makes the function total —
 * TypeScript verifies we handle every variant of the discriminated union.
 */
export function getStatusLabel(status: DownloadStatus, t: TranslateFn): string {
  switch (status.kind) {
    case "queued":
      return t("download.status.queued");
    case "fetchingMetadata":
      return t("download.status.fetchingMetadata");
    case "downloading":
      return t("download.status.downloading");
    case "paused":
      return t("download.status.paused");
    case "seeding":
      return t("downloadRow.badgeSeeding");
    case "completed":
      return t("download.status.completed");
    case "removed":
      return t("download.status.removed");
    case "error":
      return t("download.status.error");
  }
}

/** Get a CSS class suffix for the status, suitable for BEM-style classes
 *  (e.g. `dl-progress-card-status--downloading`). */
export function getStatusClassSuffix(status: DownloadStatus): string {
  return status.kind;
}

/** Calculate and format the estimated time until finish (ETA). */
export function formatEta(
  downloaded: number,
  totalSize: number | null,
  speed: number,
  t: TranslateFn,
): string {
  if (totalSize === null || speed <= 0) return "";
  const remaining = totalSize - downloaded;
  if (remaining <= 0) return "";
  const seconds = Math.ceil(remaining / speed);

  if (seconds < 60) {
    return t("download.status.secondsRemaining", { seconds });
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return t("download.status.minutesRemaining", { minutes, remainingSeconds });
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return t("download.status.hoursRemaining", { hours, remainingMinutes });
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 30) {
    return t("download.status.over30d");
  }
  return t("download.status.daysRemaining", { days, remainingHours });
}

/**
 * Best-effort, status-aware description of what this torrent is
 * CURRENTLY doing, derived entirely from DTO fields the backend
 * already publishes (status + speeds + peer counts + extracted
 * flag). Used by the Downloads page row to give the user a
 * one-line answer to "why is the byte counter stuck at 0?" —
 * without forcing the row to grow another column.
 *
 * Returns `null` when the status chip + error/speed columns
 * already convey enough (paused, error). Returns a string for
 * every state where the user is left wondering whether the
 * torrent is making progress:
 *
 *   queued             → "Waiting in queue…"
 *   fetchingMetadata   → "Contacting trackers & bootstrapping DHT…"
 *                        (or "Resolving metadata (N peers contacted)…"
 *                        once some peers have responded)
 *   downloading        → "Searching for peers…" / "Connecting to known peers…"
 *                        / "Stalled — peer connections idle" /
 *                        "Downloading from N peers (M known)"
 *   completed          → "Extracting archives…" (during autoExtract phase)
 *                        or "Ready to play" (final state)
 *
 * For direct-debrib downloads (id prefix `dd_*` / `db_*`) the
 * hostname of `sourceUri` is substituted for "peers", giving the
 * user the answer to "which mirror is this hitting right now?".
 */
export function getActivityMessage(download: TorrentDownload, t: TranslateFn): string | null {
  const status = download.status;
  const isDirect =
    download.kind === "direct" || download.kind === "debrid";
  const speed = download.downloadSpeed;
  const peers = download.peers;
  const seeds = download.seeds;

  switch (status.kind) {
    case "queued":
      return t("download.waitingInQueue");

    case "fetchingMetadata":
      // Total size + file list won't arrive until we've fetched the
      // .torrent metadata from either a DHT node or a tracker.
      return peers > 0
        ? t("download.resolvingMetadata", { peers, s: peers === 1 ? "" : "s" })
        : t("download.contactingTrackers");

    case "downloading": {
      // Direct downloads don't have peer counts — surface the mirror
      // hostname (the equivalent of "who am I pulling from right now")
      // and a connecting/data distinction based on byte flow.
      if (isDirect) {
        const host = extractHostname(download.sourceUri);
        if (speed > 0) {
          return host ? t("download.downloadingFrom", { host }) : t("download.downloading");
        }
        return host ? t("download.connectingTo", { host }) : t("download.awaitingHost");
      }
      // Torrent: sense the librqbit state via bytes/sec + peer counts.
      // `peers` = currently-connected peers (`LiveStats.live`);
      // `seeds` = known-but-not-currently-connected (`seen - live`).
      if (download.totalSize == null) {
        // Metadata hasn't landed yet but librqbit already promoted
        // us out of FetchingMetadata — rare; the message is for
        // the lint-friendly branch, not a real codepath.
        return t("download.resolvingMetadataBare");
      }
      if (peers === 0 && seeds === 0) {
        return t("download.searchingPeers");
      }
      if (peers === 0 && speed === 0) {
        // We have peer addresses cached from a prior session but no
        // active connections yet — librqbit is reconnecting.
        return t("download.connectingPeers");
      }
      if (peers === 0 && speed > 0) {
        // No live peers but bytes are flowing — typical during the
        // last few KB of a download when we're flushing the disk
        // cache before closing the stream.
        return t("download.flushingBytes");
      }
      // peers > 0
      if (speed === 0) {
        return t("download.stalled");
      }
      // speed > 0 AND peers > 0 — the happy path. Mention the swarm
      // size when we have one so the user can see whether their
      // download is pulling from a healthy pool.
      return t("download.downloadingFromPeers", {
        peers,
        s: peers === 1 ? "" : "s",
        inSwarm: seeds > 0 ? t("download.inSwarm", { seeds }) : "",
      });
    }

    case "paused":
      // The status chip + speed column already say "Paused"; an
      // additional line here would be triple-info.
      return null;

    case "completed":
      if (download.autoExtract && !download.extracted) {
        return t("download.extractingArchives");
      }
      return t("download.readyToPlay");

    case "seeding":
      return t("download.seedingToPeers");

    case "removed":
      // Removed downloads are gone from the active list; there is nothing
      // in-flight to describe.
      return null;

    case "error":
      // Errors have their own dedicated `dl-row-error` line.
      return null;
  }
}

// ─── Filtering & sorting (Downloads page) ───────────────────────────────────

/**
 * Status filter buckets for the Downloads page. `all` shows every
 * download; the rest map onto one or more `DownloadStatus.kind`
 * values so the UI can offer coarse, human-meaningful groupings
 * (e.g. "Seeding" lumps together downloads that are uploading).
 */
export type DownloadStatusFilter =
  | "all"
  | "downloading"
  | "seeding"
  | "queued"
  | "paused"
  | "completed"
  | "error";

/** Sort keys for the Downloads page list. */
export type DownloadSort =
  | "added-desc"
  | "added-asc"
  | "name-asc"
  | "size-desc"
  | "progress-desc"
  | "speed-desc";

/** Return true if a download matches the given status filter. */
export function matchesStatusFilter(
  download: TorrentDownload,
  filter: DownloadStatusFilter,
): boolean {
  if (filter === "all") return true;
  const kind = download.status.kind;
  switch (filter) {
    case "downloading":
      // Anything actively downloading or working
      return kind === "downloading" || kind === "fetchingMetadata";
    case "seeding":
      return kind === "seeding";
    case "queued":
      return kind === "queued";
    case "paused":
      return kind === "paused";
    case "completed":
      return kind === "completed";
    case "error":
      return kind === "error";
  }
}

/**
 * Case-insensitive substring match against the download name and
 * its source name. Empty/whitespace queries match everything.
 */
export function matchesSearchQuery(download: TorrentDownload, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    download.name.toLowerCase().includes(q) ||
    download.sourceName.toLowerCase().includes(q)
  );
}

/** Comparator factory for the Downloads page sort dropdown. */
export function compareDownloads(sort: DownloadSort): (a: TorrentDownload, b: TorrentDownload) => number {
  switch (sort) {
    case "added-asc":
      return (a, b) => a.addedAt - b.addedAt;
    case "name-asc":
      return (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "size-desc":
      return (a, b) => (b.totalSize ?? 0) - (a.totalSize ?? 0);
    case "progress-desc":
      return (a, b) => (b.progress ?? 0) - (a.progress ?? 0);
    case "speed-desc":
      return (a, b) => b.downloadSpeed - a.downloadSpeed;
    case "added-desc":
    default:
      return (a, b) => b.addedAt - a.addedAt;
  }
}

/** Safe hostname extractor for direct-download URIs. Returns "" for
 *  magnet links / non-URL inputs. */
function extractHostname(uri: string): string {
  if (!uri || uri.startsWith("magnet:")) return "";
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
