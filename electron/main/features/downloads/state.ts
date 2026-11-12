/**
 * Persistence for the downloads engine.
 *
 * Documents (all under Electron's `userData`, stored in `downloads.db`):
 *   downloads-state    settings, scheduler, seeding + speed limits
 *   downloads-queue    live download records (restart resume)
 *   downloads-history  append-only download-history ledger (`download_history` table)
 *   downloads-secrets  debrid API key (safeStorage-encrypted when available)
 *
 * The Rust build kept these in its SQLite `kv` store, the `download_history`
 * table and the OS keychain; this pass uses one domain database and keeps the
 * same synchronous durability model.
 */
import { safeStorage } from "electron";
import { downloadHistoryCodec } from "../../state/db/codecs";
import { createSqliteStore } from "../../state/sqliteStore";
import {
  DEFAULT_DOWNLOAD_SETTINGS,
  DEFAULT_SCHEDULER_CONFIG,
  DEFAULT_SCHEDULER_DAYS,
  type BandwidthRule,
  type DownloadHistoryRow,
  type DownloadRecord,
  type DownloadSettings,
  type PostAction,
  type ScheduleDays,
  type SchedulerConfig,
} from "./types";

export interface SpeedLimitSettings {
  /** kbps; `null`/0 = unlimited. */
  downloadKbps: number | null;
  uploadKbps: number | null;
  disableUpload: boolean;
}

export interface DownloadsState {
  version: 1;
  settings: DownloadSettings;
  scheduler: SchedulerConfig;
  seedAfterComplete: boolean;
  seedRatioLimit: number;
  seedTimeLimitMinutes: number;
  speedLimits: SpeedLimitSettings;
  /** uTP listener preference (stored; webtorrent's support is optional). */
  transportUtp: boolean;
  /** Persisted default debrid provider (`none` when unset). */
  debridProvider: string;
  /** AllDebrid probe magnets whose cleanup failed; retried by the UI. */
  allDebridProbeIds: string[];
}

export interface DownloadsQueue {
  version: 1;
  /** Records in insertion order; the array order is not meaningful. */
  downloads: DownloadRecord[];
}

export interface DownloadsHistoryDocument {
  version: 1;
  nextId: number;
  rows: DownloadHistoryRow[];
}

interface SecretDocument {
  version: 1;
  /** `value` is base64 ciphertext when `encrypted` is true. */
  debridApiKey: { encrypted: boolean; value: string } | null;
}

export const DEFAULT_STATE: DownloadsState = {
  version: 1,
  settings: DEFAULT_DOWNLOAD_SETTINGS,
  scheduler: DEFAULT_SCHEDULER_CONFIG,
  seedAfterComplete: false,
  seedRatioLimit: 0,
  seedTimeLimitMinutes: 0,
  speedLimits: { downloadKbps: null, uploadKbps: null, disableUpload: false },
  transportUtp: false,
  debridProvider: "none",
  allDebridProbeIds: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeDays(value: unknown): ScheduleDays {
  if (!Array.isArray(value) || value.length !== 7) {
    return [...DEFAULT_SCHEDULER_DAYS] as ScheduleDays;
  }
  return value.map((day) => Boolean(day)) as ScheduleDays;
}

function normalizeHhMm(value: unknown, fallback: string): string {
  const raw = asString(value, fallback).trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

function normalizeBandwidthRule(value: unknown, index: number): BandwidthRule {
  const raw = asRecord(value);
  return {
    id: asString(raw.id, `rule-${index + 1}`),
    label: asString(raw.label),
    days: normalizeDays(raw.days),
    start: normalizeHhMm(raw.start, "00:00"),
    end: normalizeHhMm(raw.end, "00:00"),
    downloadKbps: Math.max(0, Math.round(asNumber(raw.downloadKbps))),
    uploadKbps: Math.max(0, Math.round(asNumber(raw.uploadKbps))),
    disableUpload: asBoolean(raw.disableUpload),
  };
}

export function normalizeSchedulerConfig(value: unknown): SchedulerConfig {
  const raw = asRecord(value);
  const rules = Array.isArray(raw.bandwidthRules)
    ? raw.bandwidthRules.map(normalizeBandwidthRule)
    : [];
  return {
    enabled: asBoolean(raw.enabled, DEFAULT_SCHEDULER_CONFIG.enabled),
    windowEnabled: asBoolean(raw.windowEnabled, DEFAULT_SCHEDULER_CONFIG.windowEnabled),
    windowStart: normalizeHhMm(raw.windowStart, DEFAULT_SCHEDULER_CONFIG.windowStart),
    windowEnd: normalizeHhMm(raw.windowEnd, DEFAULT_SCHEDULER_CONFIG.windowEnd),
    days: normalizeDays(raw.days),
    maxConcurrent: Math.min(50, Math.max(0, Math.round(asNumber(raw.maxConcurrent, 0)))),
    autoStartQueued: asBoolean(raw.autoStartQueued, true),
    pauseOutsideWindow: asBoolean(raw.pauseOutsideWindow),
    pauseOnGame: asBoolean(raw.pauseOnGame),
    bandwidthRules: rules,
  };
}

function normalizePostAction(value: unknown, index: number): PostAction {
  const raw = asRecord(value);
  const kind = raw.kind === "launchInstaller" ? "launchInstaller" : "openFolder";
  return {
    id: asString(raw.id, `action-${index + 1}`),
    kind,
    onSuccess: asBoolean(raw.onSuccess, true),
    onFailure: asBoolean(raw.onFailure),
    path: typeof raw.path === "string" ? raw.path : null,
  };
}

export function normalizeDownloadSettings(value: unknown): DownloadSettings {
  const raw = asRecord(value);
  const count = Math.round(asNumber(raw.segmentCount, 8));
  return {
    multiConnection: asBoolean(raw.multiConnection, true),
    segmentCount: Math.min(16, Math.max(1, count)),
    installerOptIn: asBoolean(raw.installerOptIn),
    postActions: Array.isArray(raw.postActions)
      ? raw.postActions.map(normalizePostAction)
      : [],
  };
}

function normalizeState(value: unknown): DownloadsState {
  const raw = asRecord(value);
  const limits = asRecord(raw.speedLimits);
  const downloadKbps = limits.downloadKbps;
  const uploadKbps = limits.uploadKbps;
  return {
    version: 1,
    settings: normalizeDownloadSettings(raw.settings),
    scheduler: normalizeSchedulerConfig(raw.scheduler),
    seedAfterComplete: asBoolean(raw.seedAfterComplete),
    seedRatioLimit: Math.max(0, asNumber(raw.seedRatioLimit)),
    seedTimeLimitMinutes: Math.max(0, Math.round(asNumber(raw.seedTimeLimitMinutes))),
    speedLimits: {
      downloadKbps:
        typeof downloadKbps === "number" && downloadKbps > 0
          ? Math.round(downloadKbps)
          : null,
      uploadKbps:
        typeof uploadKbps === "number" && uploadKbps > 0 ? Math.round(uploadKbps) : null,
      disableUpload: asBoolean(limits.disableUpload),
    },
    transportUtp: asBoolean(raw.transportUtp),
    debridProvider: asString(raw.debridProvider, "none") || "none",
    allDebridProbeIds: Array.isArray(raw.allDebridProbeIds)
      ? raw.allDebridProbeIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

const stateStore = createSqliteStore<DownloadsState>({
  domain: "downloads",
  document: "downloads-state",
  createDefault: () => ({ ...DEFAULT_STATE, settings: { ...DEFAULT_DOWNLOAD_SETTINGS }, scheduler: { ...DEFAULT_SCHEDULER_CONFIG } }),
  normalize: normalizeState,
});

const queueStore = createSqliteStore<DownloadsQueue>({
  domain: "downloads",
  document: "downloads-queue",
  createDefault: () => ({ version: 1, downloads: [] }),
  normalize: (value) => {
    const raw = asRecord(value);
    return {
      version: 1,
      downloads: Array.isArray(raw.downloads)
        ? (raw.downloads as DownloadRecord[]).filter(
            (row) => row && typeof row === "object" && typeof row.id === "string",
          )
        : [],
    };
  },
});

const historyStore = createSqliteStore<DownloadsHistoryDocument>({
  domain: "downloads",
  document: "downloads-history",
  createDefault: () => ({ version: 1, nextId: 1, rows: [] }),
  normalize: (value) => {
    const raw = asRecord(value);
    const rows = Array.isArray(raw.rows)
      ? (raw.rows as DownloadHistoryRow[]).filter(
          (row) => row && typeof row === "object" && typeof row.downloadId === "string",
        )
      : [];
    let maxId = 0;
    for (const row of rows) maxId = Math.max(maxId, asNumber(row.id));
    return {
      version: 1,
      nextId: Math.max(Math.round(asNumber(raw.nextId, 1)), maxId + 1),
      rows,
    };
  },
  codec: downloadHistoryCodec,
});

const secretStore = createSqliteStore<SecretDocument>({
  domain: "downloads",
  document: "downloads-secrets",
  createDefault: () => ({ version: 1, debridApiKey: null }),
  normalize: (value) => {
    const raw = asRecord(value);
    const key = asRecord(raw.debridApiKey);
    const valid =
      typeof key.value === "string" && key.value.length > 0
        ? { encrypted: asBoolean(key.encrypted), value: key.value }
        : null;
    return { version: 1, debridApiKey: valid };
  },
});

export function readState(): DownloadsState {
  return stateStore.read();
}

export function writeState(next: DownloadsState): DownloadsState {
  return stateStore.write(next);
}

export function updateState(mutate: (state: DownloadsState) => DownloadsState): DownloadsState {
  return stateStore.update(mutate);
}

export function readQueue(): DownloadRecord[] {
  return queueStore.read().downloads;
}

export function writeQueue(downloads: DownloadRecord[]): void {
  queueStore.write({ version: 1, downloads });
}

export function readHistoryDocument(): DownloadsHistoryDocument {
  return historyStore.read();
}

export function writeHistoryDocument(doc: DownloadsHistoryDocument): void {
  historyStore.write(doc);
}

/** Read the debrid API key, decrypting it with Electron's safeStorage. */
export function readDebridKey(): string | null {
  const entry = secretStore.read().debridApiKey;
  if (!entry) return null;
  if (!entry.encrypted) return entry.value;
  try {
    return safeStorage.decryptString(Buffer.from(entry.value, "base64"));
  } catch (error) {
    console.error("[downloads] failed to decrypt the debrid API key:", error);
    return null;
  }
}

/** Store (or clear) the debrid API key. Never throws for empty input. */
export function writeDebridKey(apikey: string | null): void {
  const trimmed = apikey?.trim() ?? "";
  if (!trimmed) {
    secretStore.write({ version: 1, debridApiKey: null });
    return;
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(trimmed).toString("base64");
      secretStore.write({ version: 1, debridApiKey: { encrypted: true, value: encrypted } });
      return;
    }
  } catch (error) {
    console.error("[downloads] safeStorage unavailable, falling back to plaintext:", error);
  }
  secretStore.write({ version: 1, debridApiKey: { encrypted: false, value: trimmed } });
}
