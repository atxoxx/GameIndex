/**
 * Torrent engine backed by WebTorrent.
 *
 * The Rust build used `librqbit`; WebTorrent is the closest Node-native
 * replacement (`webtorrent@3`, ESM-only). The package is loaded with a
 * runtime `import()` because the Electron main bundle is CommonJS — Rollup
 * keeps dynamic imports of externalized dependencies as native `import()`,
 * which Node supports for ESM. When the import fails (packaging mistake,
 * missing optional native module) every torrent command rejects with a
 * precise "torrent engine unavailable" message instead of pretending to
 * download.
 *
 * Capability notes (see the downloads report):
 *  - no fast-resume/session database: on restart the torrent is re-added and
 *    existing files are re-hashed (correct, slower than librqbit),
 *  - uTP only works when the optional `utp-native` module is installed; the
 *    transport preference is stored but TCP is the actual transport,
 *  - file selection uses WebTorrent's piece selection API.
 */
import fs from "node:fs";
import path from "node:path";
import { httpBuffer } from "../../lib/http";
import { clampFileProgress } from "./progress";

/* Minimal structural types for the parts of WebTorrent we touch. */
interface WtFile {
  name: string;
  path: string;
  length: number;
  downloaded: number;
  progress: number;
  select: (priority?: number) => void;
  deselect: () => void;
}

interface WtWire {
  remoteAddress?: string;
  remotePort?: number;
  peerId?: string;
  type?: string;
  downloaded?: number;
  uploaded?: number;
  requests?: unknown[];
}

interface WtTorrent {
  infoHash: string;
  name: string;
  length: number;
  downloaded: number;
  uploaded?: number;
  downloadSpeed: number;
  uploadSpeed: number;
  progress: number;
  numPeers: number;
  done: boolean;
  paused: boolean;
  destroyed: boolean;
  files: WtFile[];
  announce?: string[];
  wires: WtWire[];
  /** torrent-discovery instance (tracker + DHT); not in WebTorrent's typings. */
  discovery?: {
    tracker?: { update?: (opts?: Record<string, unknown>) => void };
  };
  metadata?: Uint8Array | null;
  torrentFile?: Uint8Array | null;
  timeRemaining?: number;
  once(event: string, listener: (...args: never[]) => void): void;
  on(event: string, listener: (...args: never[]) => void): void;
  removeAllListeners(event?: string): void;
  pause(): void;
  resume(): void;
  select(start: number, end: number, priority?: number): void;
  deselect(start: number, end: number): void;
}

interface WtClient {
  torrents: WtTorrent[];
  add(
    torrentId: string | Uint8Array,
    options?: Record<string, unknown>,
    onTorrent?: (torrent: WtTorrent) => void,
  ): WtTorrent;
  remove(torrent: WtTorrent | string, options?: { destroyStore?: boolean }): Promise<void>;
  throttleDownload(rate: number): void;
  throttleUpload(rate: number): void;
  destroy(cb?: () => void): void;
  on(event: string, listener: (...args: never[]) => void): void;
  readonly _peersLength?: number;
}

type WebTorrentConstructor = new (options?: Record<string, unknown>) => WtClient;

export interface TorrentEngineCallbacks {
  onMetadata: (
    recordId: string,
    info: { infoHash: string; name: string; length: number; files: Array<{ name: string; size: number }> },
  ) => void;
  onError: (recordId: string, message: string) => void;
  onDone: (recordId: string) => void;
}

export interface TorrentSnapshot {
  infoHash: string;
  name: string;
  length: number;
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  uploadSpeed: number;
  progress: number;
  peers: number;
  seeds: number;
  done: boolean;
  paused: boolean;
  timeRemaining: number | null;
  files: Array<{
    name: string;
    path: string;
    length: number;
    downloaded: number;
    progress: number;
  }>;
  trackers: string[];
  wires: WtWire[];
}

export class TorrentEngineUnavailableError extends Error {}

let moduleLoad: Promise<WebTorrentConstructor> | null = null;
let moduleLoadError: string | null = null;

/**
 * Load WebTorrent once. The specifier is held in a variable so TypeScript
 * does not require type declarations and Rollup leaves the native `import()`
 * untouched in the CJS output.
 */
async function loadWebTorrent(): Promise<WebTorrentConstructor> {
  if (moduleLoadError) {
    throw new TorrentEngineUnavailableError(
      `Torrent engine unavailable — ${moduleLoadError}`,
    );
  }
  if (!moduleLoad) {
    moduleLoad = (async () => {
      const specifier = "webtorrent";
      const loaded = (await import(specifier)) as {
        default?: WebTorrentConstructor;
        WebTorrent?: WebTorrentConstructor;
      };
      const ctor = loaded.default ?? loaded.WebTorrent;
      if (typeof ctor !== "function") {
        throw new Error("the webtorrent module did not export a client constructor");
      }
      return ctor;
    })().catch((error: unknown) => {
      moduleLoad = null;
      moduleLoadError = error instanceof Error ? error.message : String(error);
      throw new TorrentEngineUnavailableError(
        `Torrent engine unavailable — webtorrent failed to load (${moduleLoadError}). Direct and debrid downloads are unaffected.`,
      );
    });
  }
  return moduleLoad;
}

function waitForMetadata(torrent: WtTorrent, timeoutMs: number): Promise<void> {
  if (torrent.metadata) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(
        new Error(
          "Torrent is taking too long to fetch metadata — your network may be blocking DHT or trackers.",
        ),
      );
    }, timeoutMs);
    torrent.once("metadata", (() => finish()) as never);
    torrent.once("error", ((error: Error) => finish(error)) as never);
  });
}

export class TorrentEngine {
  private client: WtClient | null = null;
  private readonly torrents = new Map<string, WtTorrent>();
  private readonly callbacks: TorrentEngineCallbacks;
  private utpPreferred: boolean;

  constructor(callbacks: TorrentEngineCallbacks, utpPreferred: boolean) {
    this.callbacks = callbacks;
    this.utpPreferred = utpPreferred;
  }

  isRunning(): boolean {
    return this.client !== null;
  }

  /** Whether the module can be imported; used by `torrent_*` handlers. */
  async probe(): Promise<void> {
    await this.ensureClient();
  }

  private async ensureClient(): Promise<WtClient> {
    if (this.client) return this.client;
    const WebTorrent = await loadWebTorrent();
    const client = new WebTorrent({
      // The transport preference is persisted; WebTorrent only honours it
      // when the optional `utp-native` addon is present (it is not shipped).
      utp: this.utpPreferred,
      dht: true,
      tracker: true,
      maxConns: 100,
    });
    // Torrent errors are forwarded per-torrent; client-level errors (DHT or
    // listener problems) must not crash the main process.
    client.on("error", ((error: unknown) => {
      console.error("[downloads] torrent client error:", error);
    }) as never);
    this.client = client;
    this.applySpeedLimitsFromStore();
    return client;
  }

  private applySpeedLimitsFromStore(): void {
    // The manager pushes the effective limits on every scheduler change; the
    // client simply starts unlimited.
    if (!this.client) return;
    this.client.throttleDownload(-1);
    this.client.throttleUpload(-1);
  }

  setUtpPreferred(enabled: boolean): void {
    this.utpPreferred = enabled;
  }

  /** Load a .torrent URL with an optional Referer (anti-hotlink hosts). */
  private async prepareSource(sourceUri: string, referer?: string | null): Promise<string | Uint8Array> {
    const trimmed = sourceUri.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        const headers: Record<string, string> = {};
        if (referer) headers.referer = referer;
        return await httpBuffer(trimmed, { headers, timeoutMs: 60_000 });
      } catch (error) {
        // Let WebTorrent try the URL itself (no referer) before failing.
        console.warn(`[downloads] .torrent prefetch failed, retrying in the engine:`, error);
      }
    }
    return trimmed;
  }

  /**
   * Add a torrent. `listOnly` parks it as soon as metadata lands (no byte
   * transfer) so the file-selection UI can render the list.
   */
  async add(
    recordId: string,
    sourceUri: string,
    savePath: string,
    options: { listOnly: boolean; onlyFiles?: number[]; referer?: string | null },
  ): Promise<TorrentSnapshot | null> {
    const client = await this.ensureClient();
    const existing = this.torrents.get(recordId);
    if (existing && !existing.destroyed) {
      if (!options.listOnly) {
        if (options.onlyFiles && options.onlyFiles.length > 0) {
          this.selectFiles(recordId, options.onlyFiles);
        } else {
          existing.files.forEach((file) => file.select());
        }
        this.resume(recordId);
      }
      return this.snapshot(recordId);
    }

    const source = await this.prepareSource(sourceUri, options.referer);
    await fs.promises.mkdir(savePath, { recursive: true });

    const torrent = client.add(source, {
      path: savePath,
      deselect: options.listOnly || Boolean(options.onlyFiles && options.onlyFiles.length > 0),
      // Pausing at construction prevents metadata fetch; the list-only path
      // keeps the torrent live but fully deselected instead (see below).
      paused: false,
      // Keep files when the record is removed; the manager deletes on demand.
      destroyStoreOnDestroy: false,
    });
    this.torrents.set(recordId, torrent);

    torrent.on("error", ((error: Error) => {
      this.callbacks.onError(recordId, error.message || String(error));
    }) as never);

    const metadataHandler = (): void => {
      const files = torrent.files.map((file) => ({
        name: file.path || file.name,
        size: file.length,
      }));
      this.callbacks.onMetadata(recordId, {
        infoHash: torrent.infoHash,
        name: torrent.name,
        length: torrent.length,
        files,
      });
      if (options.listOnly) {
        // Do NOT pause: WebTorrent drops every peer candidate while a torrent
        // is paused (`_addPeer` ignores them) and only re-announces on the
        // tracker interval, so a paused list-only torrent would resume with an
        // empty swarm. Deselecting every file already guarantees zero bytes.
        torrent.files.forEach((file) => file.deselect());
      } else if (options.onlyFiles && options.onlyFiles.length > 0) {
        this.selectFiles(recordId, options.onlyFiles);
      }
    };
    torrent.once("metadata", metadataHandler as never);
    torrent.on("done", (() => this.callbacks.onDone(recordId)) as never);

    if (options.listOnly) {
      try {
        await waitForMetadata(torrent, 60_000);
      } catch (error) {
        // Keep the torrent alive: the record still shows "fetching
        // metadata" and progress events update the file list when it lands.
        console.warn(`[downloads] list-only metadata timeout for ${recordId}:`, error);
      }
      if (torrent.metadata) {
        torrent.files.forEach((file) => file.deselect());
      }
    } else if (torrent.metadata) {
      metadataHandler();
    }

    return this.snapshot(recordId);
  }

  /** Re-add a persisted torrent after a restart (files are re-verified). */
  async rehydrate(
    recordId: string,
    sourceUri: string,
    savePath: string,
    options: { onlyFiles?: number[]; paused: boolean; referer?: string | null },
  ): Promise<void> {
    await this.add(recordId, sourceUri, savePath, {
      listOnly: false,
      onlyFiles: options.onlyFiles,
      referer: options.referer,
    });
    if (options.paused) this.pause(recordId);
  }

  snapshot(recordId: string): TorrentSnapshot | null {
    const torrent = this.torrents.get(recordId);
    if (!torrent || torrent.destroyed) return null;
    return {
      infoHash: torrent.infoHash,
      name: torrent.name,
      length: torrent.length,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded ?? 0,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      progress: torrent.progress,
      peers: torrent.numPeers,
      // `_peersLength` includes connected + queued peers; the UI's `seeds`
      // column is "known but not connected", matching the Rust semantics.
      seeds: Math.max(0, ((torrent as unknown as { _peersLength?: number })._peersLength ?? 0) - torrent.numPeers),
      done: torrent.done,
      paused: torrent.paused,
      timeRemaining:
        Number.isFinite(torrent.timeRemaining ?? Infinity) && (torrent.timeRemaining ?? 0) > 0
          ? Math.round((torrent.timeRemaining ?? 0) / 1000)
          : null,
      files: torrent.files.map((file) => {
        // Tiny files sharing a piece can report negative bytes; see
        // `progress.ts` and the "-201151 %" bug.
        const clamped = clampFileProgress(file.downloaded, file.length);
        return {
          name: file.path || file.name,
          path: file.path || file.name,
          length: clamped.length,
          downloaded: clamped.downloaded,
          progress: clamped.progress,
        };
      }),
      trackers: torrent.announce ?? [],
      wires: torrent.wires ?? [],
    };
  }

  infoHashFor(recordId: string): string | null {
    const torrent = this.torrents.get(recordId);
    return torrent?.infoHash ?? null;
  }

  magnetFor(recordId: string): string | null {
    const torrent = this.torrents.get(recordId);
    if (!torrent?.infoHash) return null;
    const name = encodeURIComponent(torrent.name ?? "");
    return `magnet:?xt=urn:btih:${torrent.infoHash}&dn=${name}`;
  }

  rekey(oldId: string, newId: string): void {
    if (oldId === newId) return;
    const torrent = this.torrents.get(oldId);
    if (torrent) {
      this.torrents.delete(oldId);
      this.torrents.set(newId, torrent);
    }
  }

  pause(recordId: string): void {
    this.torrents.get(recordId)?.pause();
  }

  resume(recordId: string): void {
    const torrent = this.torrents.get(recordId);
    if (!torrent) return;
    torrent.resume();
    // WebTorrent ignored every peer candidate while the torrent was paused and
    // only re-announces on the tracker's interval (often 30 min). Force one
    // announce so resume actually reconnects to the swarm.
    try {
      torrent.discovery?.tracker?.update?.({});
    } catch (error) {
      console.warn(`[downloads] could not refresh trackers for ${recordId}:`, error);
    }
  }

  selectFiles(recordId: string, onlyFiles: number[]): void {
    const torrent = this.torrents.get(recordId);
    if (!torrent) return;
    const selected = new Set(onlyFiles);
    torrent.files.forEach((file, index) => {
      if (selected.size === 0 || selected.has(index)) file.select();
      else file.deselect();
    });
  }

  setSpeedLimits(downloadBps: number, uploadBps: number, disableUpload: boolean): void {
    if (!this.client) return;
    this.client.throttleDownload(downloadBps > 0 ? downloadBps : -1);
    // WebTorrent cannot hard-disable uploads; 1 B/s is effectively off
    // without suppressing the advertisements librqbit's flag did.
    this.client.throttleUpload(disableUpload ? 1 : uploadBps > 0 ? uploadBps : -1);
  }

  /** Drop the torrent from the engine, keeping every byte on disk. */
  async stop(recordId: string): Promise<void> {
    const torrent = this.torrents.get(recordId);
    if (!torrent) return;
    this.torrents.delete(recordId);
    torrent.removeAllListeners("error");
    try {
      await this.client?.remove(torrent, { destroyStore: false });
    } catch (error) {
      console.warn(`[downloads] failed to remove torrent ${recordId}:`, error);
    }
  }

  async destroy(): Promise<void> {
    this.torrents.clear();
    const client = this.client;
    this.client = null;
    if (!client) return;
    await new Promise<void>((resolve) => {
      try {
        client.destroy(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}

/** Files in a torrent, for `torrent_list_files` without downloading. */
export interface TorrentFileEntry {
  name: string;
  size: number;
}

/**
 * Parse a `.torrent` (local path or http(s) URL) without touching the swarm.
 * Uses `parse-torrent`, a dependency of webtorrent.
 */
export async function parseTorrentFiles(
  uri: string,
  referer?: string | null,
): Promise<TorrentFileEntry[]> {
  const trimmed = uri.trim();
  let bytes: Uint8Array;
  const local = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const headers: Record<string, string> = {};
    if (referer) headers.referer = referer;
    bytes = await httpBuffer(trimmed, { headers, timeoutMs: 60_000 });
  } else if (trimmed.startsWith("file://") || local) {
    const filePath = trimmed.startsWith("file://")
      ? decodeURIComponent(trimmed.slice("file://".length))
      : trimmed;
    bytes = await fs.promises.readFile(filePath);
  } else {
    throw new Error("Source must be a local .torrent path or an http(s) .torrent URL");
  }

  const specifier = "parse-torrent";
  const mod = (await import(specifier)) as {
    // parse-torrent v11's default export is async (it decodes in a microtask);
    // awaiting works for both it and a synchronous future version.
    default?: (input: Uint8Array) => unknown;
  };
  const parse = mod.default;
  if (typeof parse !== "function") throw new Error("parse-torrent failed to load");
  const parsed = (await parse(bytes)) as {
    name?: string;
    files?: Array<{ name?: string; path?: string; length?: number }>;
    length?: number;
  } | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("parse-torrent returned no data for this torrent");
  }
  const files = parsed.files ?? [];
  if (files.length === 0) {
    return [{ name: parsed.name ?? path.basename(trimmed), size: parsed.length ?? 0 }];
  }
  return files.map((file) => ({
    name: file.path ?? file.name ?? "file",
    size: file.length ?? 0,
  }));
}
