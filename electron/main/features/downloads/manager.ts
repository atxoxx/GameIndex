/**
 * Downloads engine.
 *
 * Owns every live download record and drives three pipelines:
 *   - direct HTTP (`httpDownload.ts`),
 *   - debrid magnet resolve + multi-file HTTP (`debrid.ts`),
 *   - BitTorrent (`torrentEngine.ts`).
 *
 * Behavioural reference: `src-tauri/src/downloads/manager.rs` +
 * `http.rs` + `mod.rs`. Deliberate differences, all documented in the
 * workstream report:
 *   - the scheduler enforces a concurrency cap (default 2) instead of the
 *     Rust engine's unbounded concurrency,
 *   - torrents use WebTorrent (no librqbit fast-resume / piece cache),
 *   - direct downloads resume with a `Range` request into `<dest>.part`.
 */
import { app, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { emit, onEvent } from "../../ipc";
import { kbpsToBps } from "./util";
import { clearHistory, listHistory, recordHistory } from "./history";
import {
  ensureDiskSpace,
  normalizeChecksums,
  removeDownloadFile,
  streamToFile,
  verifyFileChecksum,
} from "./httpDownload";
import { debridProvider, resolveFileUrl } from "./debrid";
import { TorrentEngine, TorrentEngineUnavailableError, parseTorrentFiles } from "./torrentEngine";
import {
  readDebridKey,
  readQueue,
  readState,
  updateState,
  writeQueue,
  writeDebridKey,
  type DownloadsState,
  type SpeedLimitSettings,
} from "./state";
import {
  PENDING_METADATA_NAME,
  type ChecksumSpec,
  type DebridResolvedFile,
  type DownloadFile,
  type DownloadHistoryRow,
  type DownloadRecord,
  type DownloadSettings,
  type SchedulerConfig,
  type TorrentDetail,
  type TorrentPeerBreakdown,
  type TorrentPeerInfo,
} from "./types";
import {
  activeBandwidthRule,
  btihFromMagnet,
  compareDownloads,
  configAllowsStart,
  filenameFromUrl,
  frontendIdFromBtihHex,
  inWindow,
  isActiveRecord,
  localTimeParts,
  normalizePath,
  sanitizeFilename,
  sanitizeRelPath,
  unixNow,
  uniquify,
} from "./util";

const PROGRESS_INTERVAL_MS = 250;
const TICK_INTERVAL_MS = 500;
const PERSIST_INTERVAL_MS = 5_000;
const STALL_AFTER_MS = 30_000;

interface WorkerHandle {
  controller: AbortController;
  generation: number;
}

interface DebridCredentials {
  provider: string;
  apikey: string;
}

function nowMs(): number {
  return Date.now();
}

function statusMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileProgress(size: number, downloaded: number): number {
  return size > 0 ? Math.max(0, Math.min(1, downloaded / size)) : downloaded > 0 ? 1 : 0;
}

function extraHeadersToRecord(
  value: unknown,
): Array<[string, string]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs: Array<[string, string]> = [];
  for (const entry of value) {
    if (Array.isArray(entry) && entry.length >= 2) {
      pairs.push([String(entry[0]), String(entry[1])]);
    }
  }
  return pairs.length > 0 ? pairs : undefined;
}

export interface AddTorrentOptions {
  magnetUri: string;
  savePath: string;
  gameId?: string | null;
  gamePoster?: string | null;
  sourceName: string;
  autoExtract?: boolean;
  listOnly?: boolean;
  referer?: string | null;
  postActions?: DownloadRecord["postActions"];
}

export interface AddDirectOptions {
  id: string;
  url: string;
  savePath: string;
  gameId?: string | null;
  gamePoster?: string | null;
  sourceName: string;
  autoExtract?: boolean;
  uris?: string[] | null;
  referer?: string | null;
  extraHeaders?: unknown;
  /** Expected hashes from a plugin result; verified after the transfer. */
  checksums?: ChecksumSpec[] | null;
  postActions?: DownloadRecord["postActions"];
}

export interface AddDebridOptions {
  id: string;
  magnet: string;
  savePath: string;
  gameId?: string | null;
  gamePoster?: string | null;
  sourceName: string;
  provider: string;
  apikey: string;
  autoExtract?: boolean;
  onlyFiles?: number[] | null;
  postActions?: DownloadRecord["postActions"];
}

export class DownloadManager {
  private readonly records = new Map<string, DownloadRecord>();
  /** old id → new id after a torrent metadata rekey. */
  private readonly aliases = new Map<string, string>();
  private readonly workers = new Map<string, WorkerHandle>();
  private readonly workerRuns = new Map<string, Promise<void>>();
  private readonly generations = new Map<string, number>();
  private readonly debridParams = new Map<string, DebridCredentials>();
  private readonly automationPaused = new Map<string, "window" | "game">();
  /** Games currently running (from the session workstream's events). */
  private readonly runningGames = new Set<string>();
  /**
   * Set when a `game-exited` reported another session still running. Covers a
   * session that started before this manager booted (so its `game-started`
   * event was never seen).
   */
  private otherGamesRunning = false;
  private readonly requested = new Set<string>();
  private readonly postActionRan = new Set<string>();
  private readonly samples = new Map<string, { bytes: number; at: number; speed: number }>();
  private readonly stallSince = new Map<string, number>();

  private state: DownloadsState;
  private readonly torrent: TorrentEngine;

  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private lastEmit = 0;
  private lastSignature = "";
  private lastPersist = 0;
  private dirty = false;
  private bootstrapped = false;
  private lastAppliedLimits = "";
  private disposed = false;
  private defaultDebridProvider: string;
  private defaultDebridKey: string | null;

  constructor() {
    this.state = readState();
    this.defaultDebridProvider =
      this.state.debridProvider && this.state.debridProvider !== "none"
        ? this.state.debridProvider
        : "";
    this.defaultDebridKey = readDebridKey();

    for (const record of readQueue()) {
      this.records.set(record.id, this.normalizeRecord(record));
    }

    this.torrent = new TorrentEngine(
      {
        onMetadata: (id, info) => this.handleTorrentMetadata(id, info),
        onError: (id, message) => this.handleTorrentError(id, message),
        onDone: (id) => this.handleTorrentDone(id),
      },
      this.state.transportUtp,
    );

    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();

    // `pauseOnGame` needs to know when a game is running; the session
    // workstream broadcasts these two events on the main-process bus.
    const stopGameStarted = onEvent("game-started", (payload) =>
      this.noteGameSession(payload, true),
    );
    const stopGameExited = onEvent("game-exited", (payload) =>
      this.noteGameSession(payload, false),
    );

    app.once("before-quit", () => {
      this.disposed = true;
      if (this.timer) clearInterval(this.timer);
      stopGameStarted();
      stopGameExited();
      this.persistNow();
      void this.torrent.destroy();
    });

    setTimeout(() => {
      void this.bootstrap();
    }, 250);
  }

  // ── Record helpers ──────────────────────────────────────────────────

  private normalizeRecord(record: DownloadRecord): DownloadRecord {
    return {
      ...record,
      gameId: record.gameId ?? null,
      sourceName: record.sourceName ?? "",
      files: Array.isArray(record.files) ? record.files : [],
      downloaded: Number(record.downloaded) || 0,
      totalSize: typeof record.totalSize === "number" ? record.totalSize : null,
      progress: typeof record.progress === "number" ? record.progress : null,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      priority: record.priority ?? 0,
      uploaded: record.uploaded ?? 0,
      status:
        record.status && typeof record.status === "object" && "kind" in record.status
          ? record.status
          : { kind: "queued" },
    };
  }

  private resolveId(id: string): string {
    return this.aliases.get(id) ?? id;
  }

  record(id: string): DownloadRecord | null {
    return this.records.get(this.resolveId(id)) ?? null;
  }

  list(): DownloadRecord[] {
    return [...this.records.values()].sort(compareDownloads);
  }

  private getState(): DownloadsState {
    return this.state;
  }

  // ── Persistence / events ────────────────────────────────────────────

  private markDirty(): void {
    this.dirty = true;
  }

  private persistNow(): void {
    try {
      writeQueue(this.list());
      this.dirty = false;
      this.lastPersist = nowMs();
    } catch (error) {
      console.error("[downloads] failed to persist the queue:", error);
    }
  }

  private persistIfNeeded(force = false): void {
    if (!this.dirty) return;
    if (force || nowMs() - this.lastPersist >= PERSIST_INTERVAL_MS) this.persistNow();
  }

  private signature(): string {
    return JSON.stringify(
      this.list().map((record) => [
        record.id,
        record.status.kind,
        record.status.kind === "error" ? record.status.message : "",
        Math.round(record.downloaded / 1024),
        Math.round(record.downloadSpeed / 1024),
        Math.round(record.uploadSpeed / 1024),
        record.totalSize,
        record.progress,
        record.name,
        record.files.length,
        record.queuePosition ?? -1,
        record.priority ?? 0,
        record.uploaded ?? 0,
        record.onlyFiles?.join(",") ?? "",
      ]),
    );
  }

  private emitProgress(force = false): void {
    if (this.disposed) return;
    const now = nowMs();
    if (!force && now - this.lastEmit < PROGRESS_INTERVAL_MS) return;
    const signature = this.signature();
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.lastEmit = now;
    const payload = this.list().map((record) => ({
      ...record,
      files: record.files.map((file) => ({ ...file })),
    }));
    emit("download-progress", payload);
  }

  // ── Bootstrap / tick ────────────────────────────────────────────────

  private async bootstrap(): Promise<void> {
    if (this.bootstrapped || this.disposed) return;
    this.bootstrapped = true;
    this.applySpeedLimits();
    for (const record of [...this.records.values()]) {
      const kind = record.status.kind;
      const shouldResume =
        kind === "downloading" || kind === "fetchingMetadata" || kind === "seeding";
      if (!shouldResume) continue;
      if (record.kind === "torrent") {
        void this.startTorrent(record.id);
      } else if (record.kind === "direct") {
        void this.startDirect(record.id);
      } else {
        void this.startDebrid(record.id);
      }
    }
    this.emitProgress(true);
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    this.tickCount += 1;
    try {
      this.refreshTorrentStats();
      this.refreshTransferSpeeds();
      this.enforceSeedLimits();
      if (this.tickCount % 2 === 0) this.applyScheduler();
      this.applySpeedLimits();
      this.emitProgress();
      this.persistIfNeeded();
    } catch (error) {
      console.error("[downloads] tick failed:", error);
    }
  }

  private refreshTorrentStats(): void {
    for (const record of this.records.values()) {
      if (record.kind !== "torrent") continue;
      const stats = this.torrent.snapshot(record.id);
      if (!stats) continue;
      if (record.status.kind === "error" || record.status.kind === "removed") continue;

      const selected = record.onlyFiles ? new Set(record.onlyFiles) : null;
      let downloaded = 0;
      let totalSize = 0;
      const files: DownloadFile[] = stats.files.map((file, index) => {
        const isSelected = selected ? selected.has(index) : true;
        if (isSelected) {
          downloaded += file.downloaded;
          totalSize += file.length;
        }
        return {
          name: file.path,
          size: file.length,
          downloaded: file.downloaded,
          progress: file.progress,
          selected: isSelected,
        };
      });

      if (files.length > 0) {
        record.files = files;
      }
      if (stats.name) record.name = stats.name;
      record.downloaded = downloaded;
      if (totalSize > 0) record.totalSize = totalSize;
      record.progress = record.totalSize ? Math.min(1, downloaded / record.totalSize) : null;
      record.downloadSpeed = stats.downloadSpeed;
      record.uploadSpeed = stats.uploadSpeed;
      record.uploaded = stats.uploaded;
      record.peers = stats.peers;
      record.seeds = stats.seeds;
      if (stats.downloadSpeed > (record.peakSpeed ?? 0)) {
        record.peakSpeed = stats.downloadSpeed;
      }

      if (record.status.kind === "paused") {
        record.downloadSpeed = 0;
        record.uploadSpeed = 0;
      } else if (stats.peers === 0 && stats.downloadSpeed === 0) {
        if (!this.stallSince.has(record.id)) this.stallSince.set(record.id, nowMs());
      } else {
        this.stallSince.delete(record.id);
      }

      if (
        stats.done &&
        (record.status.kind === "downloading" || record.status.kind === "fetchingMetadata")
      ) {
        this.finishTorrent(record);
      } else if (
        record.status.kind === "fetchingMetadata" &&
        stats.files.length > 0 &&
        record.files.length > 0
      ) {
        record.status = { kind: "downloading" };
        this.markDirty();
      }
    }
  }

  private refreshTransferSpeeds(): void {
    const now = nowMs();
    for (const record of this.records.values()) {
      if (record.kind === "torrent") continue;
      const previous = this.samples.get(record.id);
      if (record.status.kind !== "downloading") {
        record.downloadSpeed = 0;
        this.samples.set(record.id, { bytes: record.downloaded, at: now, speed: 0 });
        continue;
      }
      if (!previous) {
        this.samples.set(record.id, { bytes: record.downloaded, at: now, speed: 0 });
        continue;
      }
      const elapsed = (now - previous.at) / 1000;
      const delta = Math.max(0, record.downloaded - previous.bytes);
      const raw = elapsed > 0 ? delta / elapsed : 0;
      const speed =
        previous.speed === 0 || raw === 0
          ? Math.round(raw)
          : Math.round(raw * 0.7 + previous.speed * 0.3);
      record.downloadSpeed = speed;
      if (speed > (record.peakSpeed ?? 0)) record.peakSpeed = speed;
      record.progress = record.totalSize
        ? Math.min(1, record.downloaded / record.totalSize)
        : null;
      this.samples.set(record.id, { bytes: record.downloaded, at: now, speed });
    }
  }

  private enforceSeedLimits(): void {
    const ratioLimit = this.state.seedRatioLimit;
    const minutesLimit = this.state.seedTimeLimitMinutes;
    if (ratioLimit <= 0 && minutesLimit <= 0) return;
    for (const record of this.records.values()) {
      if (record.status.kind !== "seeding") continue;
      const ratio = record.downloaded > 0 ? (record.uploaded ?? 0) / record.downloaded : 0;
      const seededMinutes = record.completedAt
        ? (unixNow() - record.completedAt) / 60
        : 0;
      const ratioHit = ratioLimit > 0 && ratio >= ratioLimit;
      const timeHit = minutesLimit > 0 && seededMinutes >= minutesLimit;
      if (!ratioHit && !timeHit) continue;
      record.status = { kind: "completed" };
      record.uploadSpeed = 0;
      record.shouldSeed = false;
      void this.torrent.stop(record.id);
      recordHistory(record);
      this.markDirty();
      this.emitProgress(true);
    }
  }

  private applyScheduler(): void {
    const config = this.state.scheduler;
    const now = unixNow();
    const parts = localTimeParts();
    const windowOpen =
      !config.enabled ||
      !config.windowEnabled ||
      this.schedulerWindowOpen(config, parts.nowMin, parts.weekday);
    const gameRunning =
      config.enabled && config.pauseOnGame && this.anyGameRunning();

    if (config.enabled && config.windowEnabled && config.pauseOutsideWindow && !windowOpen) {
      for (const record of [...this.records.values()]) {
        if (!isActiveRecord(record)) continue;
        this.automationPaused.set(record.id, "window");
        void this.pause(record.id);
      }
    } else if (windowOpen && !gameRunning && this.automationPaused.size > 0) {
      for (const [id, trigger] of [...this.automationPaused.entries()]) {
        if (trigger !== "window") continue;
        this.automationPaused.delete(id);
        const record = this.records.get(id);
        if (record && record.status.kind === "paused") void this.requestStart(id);
      }
    }

    // `pauseOnGame`: hold transfers while a game runs, resume when it exits.
    if (gameRunning) {
      for (const record of [...this.records.values()]) {
        if (!isActiveRecord(record)) continue;
        this.automationPaused.set(record.id, "game");
        void this.pause(record.id);
      }
    } else if (windowOpen && this.automationPaused.size > 0) {
      for (const [id, trigger] of [...this.automationPaused.entries()]) {
        if (trigger !== "game") continue;
        this.automationPaused.delete(id);
        const record = this.records.get(id);
        if (record && record.status.kind === "paused") void this.requestStart(id);
      }
    }

    const cap = config.maxConcurrent > 0 ? config.maxConcurrent : 0;
    let active = 0;
    for (const record of this.records.values()) if (isActiveRecord(record)) active += 1;
    if (cap > 0 && active >= cap) return;

    const queued = [...this.records.values()]
      .filter((record) => record.status.kind === "queued")
      .filter((record) =>
        configAllowsStart(
          config,
          record.scheduledStartAt,
          now,
          parts.nowMin,
          parts.weekday,
        ),
      )
      .filter((record) => config.autoStartQueued || this.requested.has(record.id))
      .sort((a, b) => {
        const priority = (b.priority ?? 0) - (a.priority ?? 0);
        return priority !== 0 ? priority : a.addedAt - b.addedAt;
      });

    for (const record of queued) {
      if (cap > 0 && active >= cap) break;
      active += 1;
      void this.startRecord(record.id);
    }
  }

  private schedulerWindowOpen(
    config: SchedulerConfig,
    nowMin: number,
    weekday: number,
  ): boolean {
    return inWindow(config.windowStart, config.windowEnd, config.days, nowMin, weekday);
  }

  /** True when at least one game session is known to be running. */
  private anyGameRunning(): boolean {
    return this.runningGames.size > 0 || this.otherGamesRunning;
  }

  /**
   * Track `game-started` / `game-exited` from the session workstream so the
   * scheduler's `pauseOnGame` toggle actually pauses transfers while a game
   * runs (it used to be a stored-but-unused flag).
   */
  private noteGameSession(payload: unknown, started: boolean): void {
    const record =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const gameId =
      typeof record.gameId === "string" && record.gameId.trim() ? record.gameId : "unknown";
    if (started) {
      this.runningGames.add(gameId);
      this.otherGamesRunning = true;
    } else {
      this.runningGames.delete(gameId);
      const remaining = record.remainingGameName;
      this.otherGamesRunning =
        typeof remaining === "string" && remaining.trim().length > 0;
    }
    if (this.state.scheduler.pauseOnGame) this.applyScheduler();
  }

  private effectiveLimits(): SpeedLimitSettings {
    const base = this.state.speedLimits;
    if (!this.state.scheduler.enabled) return base;
    const parts = localTimeParts();
    const rule = activeBandwidthRule(this.state.scheduler, parts.nowMin, parts.weekday);
    if (!rule) return base;
    return {
      downloadKbps: rule.downloadKbps > 0 ? rule.downloadKbps : null,
      uploadKbps: rule.uploadKbps > 0 ? rule.uploadKbps : null,
      disableUpload: base.disableUpload || rule.disableUpload,
    };
  }

  private applySpeedLimits(): void {
    const limits = this.effectiveLimits();
    const key = `${limits.downloadKbps ?? 0}|${limits.uploadKbps ?? 0}|${limits.disableUpload}`;
    if (key === this.lastAppliedLimits) return;
    this.lastAppliedLimits = key;
    this.torrent.setSpeedLimits(
      kbpsToBps(limits.downloadKbps),
      kbpsToBps(limits.uploadKbps),
      limits.disableUpload,
    );
  }

  private downloadLimitBps(): number {
    return kbpsToBps(this.effectiveLimits().downloadKbps);
  }

  // ── Capacity / start ────────────────────────────────────────────────

  private capacity(): number {
    return this.state.scheduler.maxConcurrent > 0
      ? this.state.scheduler.maxConcurrent
      : 0;
  }

  private async requestStart(id: string): Promise<void> {
    const record = this.record(id);
    if (!record) return;
    if (record.status.kind === "completed") {
      throw new Error("Download is already completed");
    }
    if (isActiveRecord(record)) return;
    const cap = this.capacity();
    let active = 0;
    for (const other of this.records.values()) {
      if (other.id !== record.id && isActiveRecord(other)) active += 1;
    }
    if (cap > 0 && active >= cap) {
      record.status = { kind: "queued" };
      record.queuePosition = active;
      record.downloadSpeed = 0;
      record.uploadSpeed = 0;
      this.requested.add(record.id);
      this.markDirty();
      this.persistNow();
      this.emitProgress(true);
      return;
    }
    this.requested.delete(record.id);
    record.queuePosition = undefined;
    await this.startRecord(record.id);
  }

  private async startRecord(id: string): Promise<void> {
    const record = this.record(id);
    if (!record) return;
    if (record.status.kind === "completed" || record.status.kind === "seeding") return;
    if (record.kind === "direct") {
      await this.startDirect(record.id);
    } else if (record.kind === "torrent") {
      await this.startTorrent(record.id);
    } else {
      await this.startDebrid(record.id);
    }
  }

  private nextGeneration(id: string): number {
    const next = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, next);
    return next;
  }

  private isCurrent(id: string, generation: number): boolean {
    return (this.generations.get(id) ?? 0) === generation;
  }

  private abortWorker(id: string): void {
    this.workers.get(id)?.controller.abort();
    this.workers.delete(id);
  }

  // ── Direct downloads ────────────────────────────────────────────────

  private async startDirect(id: string): Promise<void> {
    const record = this.record(id);
    if (!record) return;
    if (record.sourceUri.startsWith("magnet:")) {
      this.fail(record, "Direct download has a magnet source — cannot restart.");
      return;
    }
    const generation = this.nextGeneration(record.id);
    const controller = new AbortController();
    this.workers.set(record.id, { controller, generation });
    const previous = this.workerRuns.get(record.id);
    record.status = { kind: "downloading" };
    record.downloadSpeed = 0;
    record.uploadSpeed = 0;
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);

    const run = (async () => {
      await previous?.catch(() => undefined);
      if (!this.isCurrent(record.id, generation) || controller.signal.aborted) return;
      try {
        await ensureDiskSpace(path.dirname(record.savePath), record.totalSize);
      } catch (error) {
        if (this.isCurrent(record.id, generation)) this.fail(record, statusMessage(error));
        return;
      }

      const candidates = [record.sourceUri, ...(record.uris ?? [])].filter(Boolean);
      let lastError: unknown = null;
      for (const url of candidates) {
        if (!this.isCurrent(record.id, generation) || controller.signal.aborted) return;
        try {
          const headers: Record<string, string> = {};
          for (const [name, value] of record.extraHeaders ?? []) headers[name] = value;
          const result = await streamToFile({
            url,
            destination: record.savePath,
            headers,
            referer: record.referer,
            signal: controller.signal,
            rateLimitBps: () => this.downloadLimitBps(),
            onProgress: (bytes, total) => {
              if (!this.isCurrent(record.id, generation)) return;
              record.downloaded = bytes;
              if (total !== null) record.totalSize = total;
              if (record.files[0]) {
                const file = record.files[0];
                file.downloaded = bytes;
                if (total !== null) file.size = total;
                file.progress = fileProgress(file.size, bytes);
              }
              record.progress = record.totalSize
                ? Math.min(1, bytes / record.totalSize)
                : null;
              this.markDirty();
              this.emitProgress();
            },
          });
          if (!this.isCurrent(record.id, generation)) return;
          try {
            await verifyFileChecksum(result.path, record.checksums);
          } catch (error) {
            removeDownloadFile(record.savePath);
            if (this.isCurrent(record.id, generation)) {
              this.fail(record, statusMessage(error));
            }
            return;
          }
          this.finishTransfer(record, result.bytes, result.total);
          return;
        } catch (error) {
          if (!this.isCurrent(record.id, generation) || controller.signal.aborted) return;
          lastError = error;
        }
      }
      if (this.isCurrent(record.id, generation)) {
        this.fail(record, `Download failed: ${statusMessage(lastError)}`);
      }
    })().finally(() => {
      if (this.workers.get(record.id)?.generation === generation) {
        this.workers.delete(record.id);
      }
    });
    this.workerRuns.set(record.id, run);
  }

  private finishTransfer(record: DownloadRecord, bytes: number, total: number | null): void {
    const size = total ?? bytes;
    record.downloaded = bytes;
    record.totalSize = size > 0 ? size : record.totalSize;
    record.progress = 1;
    record.downloadSpeed = 0;
    record.uploadSpeed = 0;
    record.completedAt = unixNow();
    record.status = { kind: "completed" };
    if (record.files[0]) {
      record.files[0].size = size;
      record.files[0].downloaded = bytes;
      record.files[0].progress = 1;
      record.files[0].selected = true;
    }
    recordHistory(record);
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
    void this.runPostActions(record, true);
  }

  private fail(record: DownloadRecord, message: string): void {
    if (record.status.kind === "removed" || record.status.kind === "completed") return;
    record.status = { kind: "error", message };
    record.downloadSpeed = 0;
    record.uploadSpeed = 0;
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
    void this.runPostActions(record, false);
  }

  // ── Debrid downloads ────────────────────────────────────────────────

  private credentialsFor(id: string): DebridCredentials | null {
    const specific = this.debridParams.get(id);
    if (specific && specific.provider && specific.apikey) return specific;
    if (this.defaultDebridProvider && this.defaultDebridKey) {
      return { provider: this.defaultDebridProvider, apikey: this.defaultDebridKey };
    }
    return null;
  }

  private async startDebrid(id: string): Promise<void> {
    const record = this.record(id);
    if (!record) return;
    const credentials = this.credentialsFor(record.id);
    if (!credentials) {
      this.fail(
        record,
        "Debrid credentials are no longer available (app restarted). Remove this download and add it again.",
      );
      return;
    }
    let provider;
    try {
      provider = debridProvider(credentials.provider);
    } catch (error) {
      this.fail(record, statusMessage(error));
      return;
    }
    const generation = this.nextGeneration(record.id);
    const controller = new AbortController();
    this.workers.set(record.id, { controller, generation });
    const previous = this.workerRuns.get(record.id);
    record.status = { kind: "fetchingMetadata" };
    record.downloadSpeed = 0;
    record.uploadSpeed = 0;
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);

    const run = (async () => {
      await previous?.catch(() => undefined);
      if (!this.isCurrent(record.id, generation) || controller.signal.aborted) return;
      try {
        await this.resolveDebridFiles(record, provider, credentials, generation, controller.signal);
      } catch (error) {
        if (!this.isCurrent(record.id, generation) || controller.signal.aborted) return;
        this.fail(record, statusMessage(error));
      }
    })().finally(() => {
      if (this.workers.get(record.id)?.generation === generation) {
        this.workers.delete(record.id);
      }
    });
    this.workerRuns.set(record.id, run);
  }

  private async resolveDebridFiles(
    record: DownloadRecord,
    provider: ReturnType<typeof debridProvider>,
    credentials: DebridCredentials,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    let transferId = record.debridTransferId ?? "";
    if (!transferId) {
      const upload = await provider.uploadMagnet(credentials.apikey, record.magnetUri ?? record.sourceUri);
      transferId = upload.id;
      record.debridTransferId = transferId;
      record.debridCached = upload.cached;
      this.markDirty();
      this.emitProgress(true);
    }

    let status = await provider.getStatus(credentials.apikey, transferId);
    let failures = 0;
    while (status.status !== "ready") {
      if (
        !this.isCurrent(record.id, generation) ||
        signal.aborted ||
        record.status.kind === "paused" ||
        record.status.kind === "error"
      ) {
        return;
      }
      if (status.status === "error") {
        throw new Error(status.errorMessage || "Debrid download error");
      }
      record.progress = status.progress > 0 ? Math.min(0.99, status.progress / 100) : record.progress;
      record.status = { kind: "downloading" };
      this.markDirty();
      this.emitProgress();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      try {
        status = await provider.getStatus(credentials.apikey, transferId);
        failures = 0;
      } catch (error) {
        failures += 1;
        if (failures >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, 10_000 * failures)));
      }
    }

    if (status.files.length === 0) {
      throw new Error("No download links returned by debrid");
    }

    // Name + de-duplicate every file, keeping the FULL list so `onlyFiles`
    // indices stay aligned across pause/resume.
    const used = new Set<string>();
    const resolved: DebridResolvedFile[] = status.files.map((file) => {
      const baseName = file.name.trim()
        ? sanitizeRelPath(file.name)
        : filenameFromUrl(file.link || "");
      return { ...file, name: uniquify(baseName, used) };
    });
    const onlyFiles = record.onlyFiles && record.onlyFiles.length > 0 ? record.onlyFiles : null;
    const selectedSet = onlyFiles ? new Set(onlyFiles) : null;
    const selectedFiles = resolved.filter((_, index) => !selectedSet || selectedSet.has(index));
    if (selectedFiles.length === 0) {
      throw new Error(
        "The selected file list is empty — remove and re-add this download with files selected.",
      );
    }
    const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const recordName =
      selectedFiles.length === 1
        ? selectedFiles[0].name
        : sanitizeFilename(status.name ?? "") || "debrid_download";

    record.name = recordName;
    record.totalSize = total > 0 ? total : (status.magnetSize ?? null);
    record.files = resolved.map((file, index) => ({
      name: file.name,
      size: file.size,
      downloaded: 0,
      progress: 0,
      selected: !selectedSet || selectedSet.has(index),
    }));
    record.magnetUri = record.magnetUri ?? record.sourceUri;
    record.status = { kind: "downloading" };
    record.progress = 0;
    this.markDirty();
    this.emitProgress(true);

    try {
      await ensureDiskSpace(record.savePath, record.totalSize);
    } catch (error) {
      throw error;
    }

    await this.downloadDebridFiles(record, provider, credentials, transferId, resolved, selectedSet, generation, signal);
  }

  private async downloadDebridFiles(
    record: DownloadRecord,
    provider: ReturnType<typeof debridProvider>,
    credentials: DebridCredentials,
    transferId: string,
    resolved: DebridResolvedFile[],
    selectedSet: Set<number> | null,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    let completedBytes = 0;
    for (let index = 0; index < resolved.length; index += 1) {
      if (selectedSet && !selectedSet.has(index)) continue;
      if (!this.isCurrent(record.id, generation) || signal.aborted) return;
      const file = resolved[index];
      const fileRecord = record.files[index];
      const target = path.resolve(record.savePath, file.name);
      const base = path.resolve(record.savePath);
      if (target !== base && !target.startsWith(base + path.sep)) {
        throw new Error(`Unsafe file path in debrid listing: ${file.name}`);
      }

      // Skip a file that already landed (pause → resume / app restart).
      try {
        const stats = await fs.promises.stat(target);
        if (file.size > 0 && stats.size >= file.size) {
          completedBytes += stats.size;
          record.downloaded = completedBytes;
          if (fileRecord) {
            fileRecord.downloaded = stats.size;
            fileRecord.progress = 1;
          }
          continue;
        }
      } catch {
        /* not on disk yet */
      }

      const url = await resolveFileUrl(provider, credentials.apikey, transferId, file);
      if (!this.isCurrent(record.id, generation) || signal.aborted) return;
      const seed = completedBytes;
      try {
        const result = await streamToFile({
          url,
          destination: target,
          signal,
          rateLimitBps: () => this.downloadLimitBps(),
          onProgress: (bytes) => {
            if (!this.isCurrent(record.id, generation)) return;
            record.downloaded = seed + bytes;
            if (fileRecord) {
              fileRecord.downloaded = bytes;
              fileRecord.progress = fileProgress(fileRecord.size || file.size, bytes);
            }
            record.progress = record.totalSize
              ? Math.min(1, record.downloaded / record.totalSize)
              : null;
            this.markDirty();
            this.emitProgress();
          },
        });
        completedBytes += result.bytes;
        record.downloaded = completedBytes;
        if (fileRecord) {
          fileRecord.downloaded = result.bytes;
          if (result.bytes > 0) fileRecord.size = Math.max(fileRecord.size, result.bytes);
          fileRecord.progress = 1;
        }
      } catch (error) {
        if (!this.isCurrent(record.id, generation) || signal.aborted) return;
        throw new Error(`Failed to download ${file.name}: ${statusMessage(error)}`);
      }
    }
    if (!this.isCurrent(record.id, generation) || signal.aborted) return;
    this.finishTransfer(record, record.downloaded, record.totalSize);
  }

  // ── Torrents ────────────────────────────────────────────────────────

  private async startTorrent(id: string): Promise<void> {
    const record = this.record(id);
    if (!record) return;
    if (!record.sourceUri) {
      this.fail(record, "This download has no source URI");
      return;
    }
    const wasSeeding = record.status.kind === "seeding";
    const generation = this.nextGeneration(record.id);
    if (!wasSeeding) {
      record.status = { kind: "fetchingMetadata" };
      record.downloadSpeed = 0;
    }
    this.markDirty();
    this.emitProgress(true);

    try {
      const snapshot = await this.torrent.add(record.id, record.sourceUri, record.savePath, {
        listOnly: false,
        onlyFiles: record.onlyFiles,
        referer: record.referer,
      });
      if (snapshot && snapshot.files.length > 0) {
        this.handleTorrentMetadata(record.id, {
          infoHash: snapshot.infoHash,
          name: snapshot.name,
          length: snapshot.length,
          files: snapshot.files.map((file) => ({ name: file.path, size: file.length })),
        });
      }
      this.torrent.resume(record.id);
      if (this.isCurrent(record.id, generation)) {
        if (wasSeeding) {
          record.status = { kind: "seeding" };
        } else if (record.status.kind !== "paused") {
          record.status =
            record.files.length > 0 ? { kind: "downloading" } : { kind: "fetchingMetadata" };
        }
        this.markDirty();
        this.persistNow();
        this.emitProgress(true);
      }
    } catch (error) {
      if (this.isCurrent(record.id, generation)) this.fail(record, statusMessage(error));
    }
  }

  private handleTorrentMetadata(
    id: string,
    info: { infoHash: string; name: string; length: number; files: Array<{ name: string; size: number }> },
  ): void {
    const record = this.record(id);
    if (!record) return;
    const newId = frontendIdFromBtihHex(info.infoHash);
    if (newId && newId !== record.id && !this.records.has(newId)) {
      const oldId = record.id;
      this.records.delete(oldId);
      record.id = newId;
      this.records.set(newId, record);
      this.aliases.set(oldId, newId);
      this.torrent.rekey(oldId, newId);
    }

    record.name = info.name || record.name;
    record.magnetUri = this.torrent.magnetFor(record.id) ?? record.magnetUri;
    const onlyFiles = record.onlyFiles && record.onlyFiles.length > 0 ? record.onlyFiles : null;
    const selectedSet = onlyFiles ? new Set(onlyFiles) : null;
    record.files = info.files.map((file, index) => ({
      name: file.name,
      size: file.size,
      downloaded: record.files[index]?.downloaded ?? 0,
      progress: record.files[index]?.progress ?? 0,
      selected: !selectedSet || selectedSet.has(index),
    }));
    const selectedTotal = info.files.reduce(
      (sum, file, index) => sum + (!selectedSet || selectedSet.has(index) ? file.size : 0),
      0,
    );
    record.totalSize = selectedTotal > 0 ? selectedTotal : info.length;
    if (record.status.kind === "fetchingMetadata") record.status = { kind: "downloading" };

    if (record.totalSize && record.totalSize > 0) {
      void ensureDiskSpace(record.savePath, record.totalSize).catch((error: unknown) => {
        this.fail(record, statusMessage(error));
      });
    }
    this.markDirty();
    this.emitProgress(true);
  }

  private handleTorrentError(id: string, message: string): void {
    const record = this.record(id);
    if (!record) return;
    if (record.status.kind === "paused" || record.status.kind === "removed") return;
    this.fail(record, `Torrent error: ${message}`);
  }

  private handleTorrentDone(id: string): void {
    const record = this.record(id);
    if (!record) return;
    if (
      record.status.kind === "completed" ||
      record.status.kind === "seeding" ||
      record.status.kind === "paused" ||
      record.status.kind === "error"
    ) {
      return;
    }
    this.finishTorrent(record);
  }

  private finishTorrent(record: DownloadRecord): void {
    record.completedAt = unixNow();
    record.downloaded = record.totalSize ?? record.downloaded;
    record.progress = 1;
    record.downloadSpeed = 0;
    const seed = record.shouldSeed ?? this.state.seedAfterComplete;
    record.shouldSeed = seed;
    record.status = seed ? { kind: "seeding" } : { kind: "completed" };
    recordHistory(record);
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
    if (!seed) void this.torrent.stop(record.id);
    void this.runPostActions(record, true);
  }

  // ── Post-download actions ───────────────────────────────────────────

  private async runPostActions(record: DownloadRecord, success: boolean): Promise<void> {
    if (this.postActionRan.has(record.id)) return;
    const actions = record.postActions ?? this.state.settings.postActions;
    if (!actions || actions.length === 0) return;
    this.postActionRan.add(record.id);
    const notes: string[] = [];
    for (const action of actions) {
      const applies = success ? action.onSuccess : action.onFailure;
      if (!applies) continue;
      try {
        if (action.kind === "openFolder") {
          const target =
            action.path ||
            (record.kind === "direct"
              ? path.dirname(record.savePath)
              : record.savePath);
          const error = await shell.openPath(target);
          if (error) notes.push(`open folder failed: ${error}`);
          else notes.push(`opened ${target}`);
        } else {
          if (!this.state.settings.installerOptIn) {
            notes.push("installer launch skipped (not enabled in settings)");
            continue;
          }
          const target = action.path || this.findInstaller(record);
          if (!target) {
            notes.push("installer not found");
            continue;
          }
          const answer = await dialog.showMessageBox({
            type: "question",
            title: "Run downloaded installer?",
            message: `Run ${path.basename(target)}?`,
            detail: target,
            buttons: ["Run", "Cancel"],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          });
          if (answer.response === 0) {
            const error = await shell.openPath(target);
            notes.push(error ? `installer launch failed: ${error}` : `launched ${target}`);
          } else {
            notes.push("installer launch declined");
          }
        }
      } catch (error) {
        notes.push(statusMessage(error));
      }
    }
    if (notes.length > 0) {
      record.postActionStatus = notes.join("; ");
      this.markDirty();
      this.persistIfNeeded(true);
      this.emitProgress(true);
    }
  }

  private findInstaller(record: DownloadRecord): string | null {
    const extensions = [".exe", ".msi"];
    for (const file of record.files) {
      if (!extensions.some((ext) => file.name.toLowerCase().endsWith(ext))) continue;
      const target =
        record.kind === "direct"
          ? record.savePath
          : path.resolve(record.savePath, file.name);
      if (fs.existsSync(target)) return target;
    }
    return null;
  }

  // ── Public API: creation ────────────────────────────────────────────

  async createDirect(options: AddDirectOptions): Promise<DownloadRecord> {
    const savePath = normalizePath(options.savePath);
    if (!savePath) {
      throw new Error("No download folder selected. Please pick a folder before starting a download.");
    }
    const filename = sanitizeFilename(path.basename(savePath) || "direct_download");
    const target = path.join(path.dirname(savePath), filename);
    const record: DownloadRecord = {
      id: options.id,
      kind: "direct",
      name: filename,
      sourceUri: options.url,
      savePath: target,
      downloaded: 0,
      totalSize: null,
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      status: { kind: "queued" },
      gameId: options.gameId ?? null,
      gamePoster: options.gamePoster ?? undefined,
      sourceName: options.sourceName,
      addedAt: unixNow(),
      files: [
        { name: filename, size: 0, downloaded: 0, progress: 0, selected: true },
      ],
      autoExtract: options.autoExtract ?? false,
      extracted: false,
      uris: options.uris && options.uris.length > 0 ? options.uris : undefined,
      referer: options.referer ?? undefined,
      extraHeaders: extraHeadersToRecord(options.extraHeaders),
      checksums: normalizeChecksums(options.checksums),
      postActions: options.postActions ?? undefined,
      priority: 0,
      uploaded: 0,
    };
    this.insert(record);
    await this.requestStart(record.id);
    return this.record(record.id) ?? record;
  }

  async createDebrid(options: AddDebridOptions): Promise<DownloadRecord> {
    const savePath = normalizePath(options.savePath);
    if (!savePath) {
      throw new Error("No download folder selected. Please pick a folder before starting a download.");
    }
    const record: DownloadRecord = {
      id: options.id,
      kind: "debrid",
      name: `Debrid: ${options.id}`,
      sourceUri: options.magnet,
      savePath,
      downloaded: 0,
      totalSize: null,
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      status: { kind: "queued" },
      gameId: options.gameId ?? null,
      gamePoster: options.gamePoster ?? undefined,
      sourceName: `${options.sourceName} (Debrid)`,
      addedAt: unixNow(),
      files: [],
      autoExtract: options.autoExtract ?? false,
      extracted: false,
      magnetUri: options.magnet,
      onlyFiles:
        options.onlyFiles && options.onlyFiles.length > 0 ? options.onlyFiles : undefined,
      postActions: options.postActions ?? undefined,
      priority: 0,
      uploaded: 0,
    };
    const provider = options.provider.trim();
    const apikey = options.apikey.trim();
    if (!provider || provider === "none") {
      throw new Error("No debrid provider configured — pick one in Settings → Downloads.");
    }
    if (!apikey) {
      throw new Error("No debrid API key configured — add one in Settings → Downloads.");
    }
    this.debridParams.set(record.id, { provider, apikey });
    this.defaultDebridProvider = provider;
    this.defaultDebridKey = apikey;
    this.insert(record);
    await this.requestStart(record.id);
    return this.record(record.id) ?? record;
  }

  async createTorrent(options: AddTorrentOptions): Promise<DownloadRecord> {
    const savePath = normalizePath(options.savePath);
    if (!savePath) {
      throw new Error("No download folder selected. Please pick a folder before starting a download.");
    }
    const source = options.magnetUri.trim();
    const local = /^[a-zA-Z]:[\\/]/.test(source) || source.startsWith("/");
    if (
      !source.startsWith("magnet:") &&
      !source.startsWith("http://") &&
      !source.startsWith("https://") &&
      !local &&
      !source.endsWith(".torrent")
    ) {
      throw new Error(
        "Source URI must be a magnet: link, a .torrent file path, or an http(s):// torrent URL",
      );
    }

    // A magnet carries its infohash, so the real record id is known up front.
    const btih = btihFromMagnet(source);
    const stableId = btih ? frontendIdFromBtihHex(btih) : null;
    const id = stableId ?? `dl_pending_${unixNow()}_${Math.floor(Math.random() * 1_000_000)}`;

    const existing = stableId ? this.records.get(stableId) : null;
    if (existing) {
      // Re-adding a known torrent refreshes metadata only while it is not
      // actively transferring.
      if (!isActiveRecord(existing)) {
        existing.savePath = savePath;
        existing.gameId = options.gameId ?? null;
        existing.gamePoster = options.gamePoster ?? undefined;
        existing.sourceName = options.sourceName;
        existing.autoExtract = options.autoExtract ?? false;
        existing.referer = options.referer ?? undefined;
        existing.postActions = options.postActions ?? undefined;
        existing.postActionStatus = undefined;
      }
      this.markDirty();
      this.emitProgress(true);
      return existing;
    }

    const record: DownloadRecord = {
      id,
      kind: "torrent",
      name: PENDING_METADATA_NAME,
      sourceUri: source,
      savePath,
      downloaded: 0,
      totalSize: null,
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      status: { kind: options.listOnly ? "paused" : "queued" },
      gameId: options.gameId ?? null,
      gamePoster: options.gamePoster ?? undefined,
      sourceName: options.sourceName,
      addedAt: unixNow(),
      files: [],
      autoExtract: options.autoExtract ?? false,
      extracted: false,
      referer: options.referer ?? undefined,
      magnetUri: source.startsWith("magnet:") ? source : undefined,
      postActions: options.postActions ?? undefined,
      priority: 0,
      uploaded: 0,
    };
    this.insert(record);

    if (options.listOnly) {
      try {
        const snapshot = await this.torrent.add(record.id, source, savePath, {
          listOnly: true,
          referer: options.referer,
        });
        if (snapshot && snapshot.files.length > 0) {
          this.handleTorrentMetadata(record.id, {
            infoHash: snapshot.infoHash,
            name: snapshot.name,
            length: snapshot.length,
            files: snapshot.files.map((file) => ({ name: file.path, size: file.length })),
          });
        }
        record.status = { kind: "paused" };
      } catch (error) {
        this.records.delete(record.id);
        this.markDirty();
        this.persistNow();
        this.emitProgress(true);
        throw error instanceof TorrentEngineUnavailableError
          ? error
          : new Error(`Failed to add torrent: ${statusMessage(error)}`);
      }
      this.markDirty();
      this.persistNow();
      this.emitProgress(true);
      return this.record(record.id) ?? record;
    }

    await this.requestStart(record.id);
    return this.record(record.id) ?? record;
  }

  private insert(record: DownloadRecord): void {
    this.records.set(record.id, record);
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
  }

  // ── Public API: lifecycle ───────────────────────────────────────────

  async pause(id: string): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    if (record.status.kind === "completed") return;
    if (record.status.kind === "seeding") {
      // "Seed only while downloading": pausing a seeding torrent stops the
      // uploads and drops it back to completed (the files stay on disk).
      // `download_set_seeding` is the explicit toggle for the same transition.
      record.status = { kind: "completed" };
      record.shouldSeed = false;
      record.downloadSpeed = 0;
      record.uploadSpeed = 0;
      this.abortWorker(record.id);
      await this.torrent.stop(record.id);
      this.markDirty();
      this.persistNow();
      this.emitProgress(true);
      return;
    }
    record.status = { kind: "paused" };
    record.downloadSpeed = 0;
    record.uploadSpeed = 0;
    this.abortWorker(record.id);
    if (record.kind === "torrent") this.torrent.pause(record.id);
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
  }

  async resume(id: string): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    if (isActiveRecord(record)) return;
    if (record.status.kind === "completed" || record.status.kind === "seeding") {
      throw new Error("Download is already completed");
    }
    await this.requestStart(record.id);
  }

  async remove(id: string, deleteFiles: boolean): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    this.abortWorker(record.id);
    if (record.kind === "torrent") await this.torrent.stop(record.id);
    this.debridParams.delete(record.id);
    this.records.delete(record.id);
    this.aliases.delete(record.id);
    this.samples.delete(record.id);
    this.stallSince.delete(record.id);
    this.automationPaused.delete(record.id);
    this.requested.delete(record.id);

    const historyRecord: DownloadRecord = { ...record };
    if (record.status.kind !== "completed" && record.status.kind !== "seeding") {
      historyRecord.status = { kind: "removed" };
    }
    recordHistory(historyRecord);

    if (deleteFiles) {
      try {
        this.deleteFiles(record);
      } catch (error) {
        console.warn(`[downloads] failed to delete files for ${record.id}:`, error);
      }
    }
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
  }

  private deleteFiles(record: DownloadRecord): void {
    if (record.kind === "direct") {
      removeDownloadFile(record.savePath);
      return;
    }
    const root = path.resolve(record.savePath);
    for (const file of record.files) {
      const target = path.resolve(root, sanitizeRelPath(file.name));
      if (target.startsWith(root + path.sep)) removeDownloadFile(target);
    }
    const torrentRoot = path.resolve(root, sanitizeFilename(record.name));
    if (torrentRoot !== root && torrentRoot.startsWith(root + path.sep)) {
      try {
        fs.rmSync(torrentRoot, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  /**
   * Point a direct download at a new URL (mirror switch / refreshed link).
   * The stale `.part` is dropped because its bytes belong to the old URL; a
   * running worker is stopped and restarted against the new source.
   */
  async updateDirectUrl(id: string, newUrl: string): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error("Download not found");
    if (record.kind !== "direct") {
      throw new Error("Only direct downloads can change their URL");
    }
    const changed = record.sourceUri !== newUrl;
    const wasRunning =
      record.status.kind === "downloading" || record.status.kind === "error";
    if (changed) {
      record.sourceUri = newUrl;
      try {
        fs.rmSync(`${record.savePath}.part`, { force: true });
      } catch {
        /* best effort */
      }
    }
    if (record.status.kind === "downloading") {
      this.abortWorker(record.id);
      record.status = { kind: "paused" };
      record.downloadSpeed = 0;
    }
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
    if (wasRunning) await this.requestStart(record.id);
  }

  async retry(id: string): Promise<void> {    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    if (record.status.kind !== "error") return;
    this.postActionRan.delete(record.id);
    record.status = { kind: "queued" };
    record.downloadSpeed = 0;
    record.uploadSpeed = 0;
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
    await this.requestStart(record.id);
  }

  async retryAll(): Promise<number> {
    const ids = [...this.records.values()]
      .filter((record) => record.status.kind === "error")
      .map((record) => record.id);
    for (const id of ids) await this.retry(id);
    return ids.length;
  }

  async pauseAll(): Promise<number> {
    let affected = 0;
    for (const record of [...this.records.values()]) {
      if (
        record.status.kind === "downloading" ||
        record.status.kind === "fetchingMetadata" ||
        record.status.kind === "queued"
      ) {
        await this.pause(record.id);
        affected += 1;
      }
    }
    return affected;
  }

  async resumeAll(): Promise<number> {
    const paused = [...this.records.values()]
      .filter((record) => record.status.kind === "paused")
      .sort((a, b) => a.addedAt - b.addedAt);
    for (const record of paused) await this.requestStart(record.id);
    return paused.length;
  }

  async updateOnlyFiles(id: string, onlyFiles: number[], kind: "torrent" | "debrid"): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    if (kind === "debrid" && record.kind !== "debrid") {
      throw new Error("Only debrid downloads support this file-selection command");
    }
    for (const index of onlyFiles) {
      if (index < 0 || index >= record.files.length) {
        throw new Error(`Invalid file index ${index}`);
      }
    }
    if (record.kind === "debrid" && isActiveRecord(record)) {
      await this.pause(record.id);
    }
    record.onlyFiles = onlyFiles;
    for (let index = 0; index < record.files.length; index += 1) {
      record.files[index].selected = onlyFiles.includes(index);
    }
    const selectedTotal = record.files
      .filter((file) => file.selected)
      .reduce((sum, file) => sum + file.size, 0);
    if (selectedTotal > 0) record.totalSize = selectedTotal;
    if (record.kind === "torrent") this.torrent.selectFiles(record.id, onlyFiles);
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
  }

  async startSelected(
    id: string,
    onlyFiles: number[],
    autoExtract: boolean,
    postActions: DownloadRecord["postActions"],
  ): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    if (!record.savePath.trim()) {
      record.status = {
        kind: "error",
        message:
          "Save folder missing — please remove and re-add this download with a folder selected.",
      };
      this.markDirty();
      this.emitProgress(true);
      throw new Error("Download has no save folder.");
    }
    record.onlyFiles = onlyFiles;
    record.autoExtract = autoExtract;
    record.postActions = postActions ?? undefined;
    record.addedAt = unixNow();
    record.status = { kind: "queued" };
    for (const [index, file] of record.files.entries()) {
      file.selected = onlyFiles.includes(index);
    }
    const selectedTotal = record.files
      .filter((file) => file.selected)
      .reduce((sum, file) => sum + file.size, 0);
    if (selectedTotal > 0) record.totalSize = selectedTotal;
    this.torrent.selectFiles(record.id, onlyFiles);
    this.markDirty();
    this.persistNow();
    await this.requestStart(record.id);
  }

  async setSchedule(id: string, startAt: number | null): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    record.scheduledStartAt = startAt ?? undefined;
    const now = unixNow();
    const due = startAt === null || startAt <= now;
    const startable = record.status.kind === "paused" || record.status.kind === "queued";
    if (!due && startable) {
      // A future start time parks the download in the queue so the scheduler
      // (and the Scheduled tab) can pick it up when the time arrives; leaving
      // it paused made the schedule a silent no-op.
      record.status = { kind: "queued" };
      record.queuePosition = undefined;
      record.downloadSpeed = 0;
      record.uploadSpeed = 0;
      this.markDirty();
      this.persistNow();
      this.emitProgress(true);
      return;
    }
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
    if (due && startable) await this.requestStart(record.id);
  }

  async setPriority(id: string, priority: number): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    record.priority = Math.round(priority);
    this.markDirty();
    this.persistNow();
    this.emitProgress(true);
  }

  async setSeeding(id: string, seed: boolean): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    if (!seed) {
      if (record.status.kind !== "seeding") return;
      record.status = { kind: "completed" };
      record.shouldSeed = false;
      record.uploadSpeed = 0;
      await this.torrent.stop(record.id);
      this.markDirty();
      this.persistNow();
      this.emitProgress(true);
      return;
    }
    if (record.kind !== "torrent") throw new Error("Only torrents can seed");
    if (record.status.kind !== "completed") {
      throw new Error("Only completed torrents can start seeding");
    }
    if (!record.sourceUri) throw new Error("This download has no source URI");
    record.status = { kind: "seeding" };
    record.shouldSeed = true;
    this.markDirty();
    this.emitProgress(true);
    try {
      await this.torrent.add(record.id, record.sourceUri, record.savePath, {
        listOnly: false,
        onlyFiles: record.onlyFiles,
        referer: record.referer,
      });
      this.torrent.resume(record.id);
      this.markDirty();
      this.persistNow();
      this.emitProgress(true);
    } catch (error) {
      record.status = { kind: "completed" };
      record.shouldSeed = false;
      this.markDirty();
      this.emitProgress(true);
      throw new Error(`Failed to start seeding: ${statusMessage(error)}`);
    }
  }

  setSeedConfig(enabled: boolean): void {
    this.state = updateState((state) => ({ ...state, seedAfterComplete: enabled }));
  }

  setSeedLimits(ratio: number, minutes: number): void {
    const normalizedRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
    const normalizedMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
    this.state = updateState((state) => ({
      ...state,
      seedRatioLimit: normalizedRatio,
      seedTimeLimitMinutes: normalizedMinutes,
    }));
  }

  // ── Public API: settings / scheduler ────────────────────────────────

  getSettings(): DownloadSettings {
    return this.state.settings;
  }

  setSettings(settings: DownloadSettings): DownloadSettings {
    const normalized: DownloadSettings = {
      multiConnection: Boolean(settings.multiConnection),
      segmentCount: Math.min(16, Math.max(1, Math.round(settings.segmentCount))),
      installerOptIn: Boolean(settings.installerOptIn),
      postActions: Array.isArray(settings.postActions) ? settings.postActions : [],
    };
    this.state = updateState((state) => ({ ...state, settings: normalized }));
    return normalized;
  }

  getScheduler(): SchedulerConfig {
    return this.state.scheduler;
  }

  setScheduler(config: SchedulerConfig): void {
    this.state = updateState((state) => ({ ...state, scheduler: config }));
    this.lastAppliedLimits = "";
    this.applySpeedLimits();
    this.emitProgress(true);
  }

  getSpeedLimits(): SpeedLimitSettings {
    return this.state.speedLimits;
  }

  setSpeedLimits(limits: SpeedLimitSettings): void {
    const normalized: SpeedLimitSettings = {
      downloadKbps:
        limits.downloadKbps && limits.downloadKbps > 0 ? Math.round(limits.downloadKbps) : null,
      uploadKbps:
        limits.uploadKbps && limits.uploadKbps > 0 ? Math.round(limits.uploadKbps) : null,
      disableUpload: Boolean(limits.disableUpload),
    };
    this.state = updateState((state) => ({ ...state, speedLimits: normalized }));
    this.lastAppliedLimits = "";
    this.applySpeedLimits();
  }

  getTransport(): boolean {
    return this.state.transportUtp;
  }

  setTransport(utp: boolean): void {
    this.state = updateState((state) => ({ ...state, transportUtp: utp }));
    this.torrent.setUtpPreferred(utp);
  }

  setDebridConfig(provider: string, apikey: string): void {
    const prov = provider.trim();
    const key = apikey.trim();
    this.defaultDebridProvider = prov === "" || prov === "none" ? "" : prov;
    this.defaultDebridKey = key === "" ? null : key;
    this.state = updateState((state) => ({
      ...state,
      debridProvider: this.defaultDebridProvider || "none",
    }));
    if (this.defaultDebridKey) {
      void this.resumeDebridWaitingForCredentials();
    }
  }

  getDebridProvider(): string {
    return this.state.debridProvider;
  }

  private async resumeDebridWaitingForCredentials(): Promise<void> {
    for (const record of [...this.records.values()]) {
      if (record.kind !== "debrid") continue;
      const status = record.status;
      if (status.kind !== "error") continue;
      if (!status.message.toLowerCase().includes("credentials")) continue;
      record.status = { kind: "queued" };
      await this.requestStart(record.id);
    }
  }

  setDebridKey(apikey: string | null): void {
    writeDebridKey(apikey);
    this.defaultDebridKey = apikey?.trim() || null;
  }

  getDebridKey(): string | null {
    return readDebridKey();
  }

  /** Ask the debrid module whether a magnet is cached, recording probes. */
  async checkDebridCache(provider: string, apikey: string, magnet: string): Promise<{ cached: boolean }> {
    const client = debridProvider(provider);
    const result = await client.checkCache(apikey, magnet);
    if (result.probeId) this.recordProbeId(result.probeId);
    return { cached: result.cached };
  }

  async listDebridFiles(provider: string, apikey: string, magnet: string) {
    const client = debridProvider(provider);
    const result = await client.listMagnetFiles(apikey, magnet);
    if (result.probeId) this.recordProbeId(result.probeId);
    return result;
  }

  /** Probe magnets AllDebrid refused to delete, retried by the settings UI. */
  private recordProbeId(id: string): void {
    this.state = updateState((state) => ({
      ...state,
      allDebridProbeIds: Array.from(new Set([...state.allDebridProbeIds, id])),
    }));
  }

  async cleanupProbes(provider: string, apikey: string): Promise<number> {
    if (provider.trim().toLowerCase() !== "alldebrid") return 0;
    const client = debridProvider("alldebrid");
    if (!client.deleteTransfer) return 0;
    const inUse = new Set(
      [...this.records.values()]
        .filter((record) => record.kind === "debrid")
        .map((record) => record.debridTransferId)
        .filter((id): id is string => Boolean(id)),
    );
    let deleted = 0;
    const remaining: string[] = [];
    for (const id of this.state.allDebridProbeIds) {
      if (inUse.has(id)) {
        remaining.push(id);
        continue;
      }
      try {
        await client.deleteTransfer(apikey, id);
        deleted += 1;
      } catch (error) {
        const lower = statusMessage(error).toLowerCase();
        if (!lower.includes("invalid") && !lower.includes("not found")) {
          remaining.push(id);
          console.warn(`[alldebrid] cleanup could not delete probe magnet ${id}:`, error);
        }
      }
    }
    this.state = updateState((state) => ({ ...state, allDebridProbeIds: remaining }));
    return deleted;
  }

  // ── Public API: reads ───────────────────────────────────────────────

  history(): DownloadHistoryRow[] {
    return listHistory();
  }

  clearHistory(): number {
    return clearHistory();
  }

  async torrentDetail(id: string): Promise<TorrentDetail> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    if (record.kind !== "torrent") {
      throw new Error("Torrent details are only available for torrents.");
    }
    const snapshot = this.torrent.snapshot(record.id);
    if (!snapshot) throw new Error("This torrent is not active in the engine.");
    const wires = snapshot.wires;
    const breakdown: TorrentPeerBreakdown = {
      live: snapshot.peers,
      liveTcp: snapshot.peers,
      liveUtp: 0,
      queued: snapshot.seeds,
      connecting: 0,
      dead: 0,
      seen: snapshot.peers + snapshot.seeds,
      etaSecs: snapshot.timeRemaining,
      averagePieceMs: null,
    };
    const peerList: TorrentPeerInfo[] = wires.map((wire) => ({
      address:
        wire.remoteAddress && wire.remotePort
          ? `${wire.remoteAddress}:${wire.remotePort}`
          : (wire.remoteAddress ?? "unknown"),
      state: "live",
      client: wire.peerId ?? null,
      connection: wire.type === "utp" ? "utp" : "tcp",
      downloaded: wire.downloaded ?? 0,
      uploaded: wire.uploaded ?? 0,
      pieces: wire.requests?.length ?? 0,
      errors: 0,
    }));
    const started = this.stallSince.get(record.id);
    return {
      id: record.id,
      infoHash: snapshot.infoHash,
      name: snapshot.name || record.name,
      magnetUri: record.magnetUri ?? this.torrent.magnetFor(record.id),
      savePath: record.savePath,
      sourceName: record.sourceName,
      status: record.status,
      totalSize: record.totalSize,
      downloaded: record.downloaded,
      uploaded: record.uploaded ?? 0,
      ratio: record.downloaded > 0 ? (record.uploaded ?? 0) / record.downloaded : 0,
      downloadSpeed: record.downloadSpeed,
      uploadSpeed: record.uploadSpeed,
      peers: record.peers,
      seeds: record.seeds,
      peakSpeed: record.peakSpeed ?? 0,
      addedAt: record.addedAt,
      completedAt: record.completedAt ?? null,
      breakdown,
      peerList,
      trackers: snapshot.trackers,
      files: record.files,
      onlyFiles: record.onlyFiles ?? null,
      stalled: started !== undefined && nowMs() - started >= STALL_AFTER_MS,
    };
  }

  async openFolder(id: string): Promise<void> {
    const record = this.record(id);
    if (!record) throw new Error(`Download not found: ${id}`);
    const target = record.kind === "direct" ? path.dirname(record.savePath) : record.savePath;
    const resolved = fs.existsSync(target)
      ? target
      : fs.existsSync(record.savePath)
        ? record.savePath
        : null;
    if (!resolved) throw new Error("Download folder does not exist yet");
    const error = await shell.openPath(resolved);
    if (error) throw new Error(`Failed to open folder: ${error}`);
  }

  async listTorrentFiles(uri: string, referer?: string | null) {
    return parseTorrentFiles(uri, referer);
  }

  /** Used by the commands module to check the engine before torrent adds. */
  async ensureTorrentEngine(): Promise<void> {
    await this.torrent.probe();
  }

  /** Snapshot used by the settings page / diagnostics. */
  diagnostics(): { active: number; total: number; torrentEngine: boolean } {
    let active = 0;
    for (const record of this.records.values()) if (isActiveRecord(record)) active += 1;
    return { active, total: this.records.size, torrentEngine: this.torrent.isRunning() };
  }

  // Exposed for the command layer without leaking the store object.
  getStateSnapshot(): DownloadsState {
    return this.getState();
  }
}

let managerInstance: DownloadManager | null = null;

export function getDownloadManager(): DownloadManager {
  if (!managerInstance) managerInstance = new DownloadManager();
  return managerInstance;
}


