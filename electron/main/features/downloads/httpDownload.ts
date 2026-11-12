/**
 * Direct HTTP streaming with resume support (the Rust `downloads/http.rs`
 * worker, reduced to the behaviour the UI depends on).
 *
 * `lib/http.ts`'s `downloadToFile` is the shared one-shot helper, but it
 * cannot resume a `.part` file and it deletes the partial on cancel. The
 * download engine needs both, so this module streams with:
 *   - `<dest>.part` temp file, resumed via a `Range: bytes=N-` request,
 *   - abort support that keeps the partial (pause → resume),
 *   - a global token-bucket speed limit shared by every active transfer,
 *   - an idle watchdog so a wedged connection fails instead of hanging.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_USER_AGENT } from "../../lib/http";

export interface StreamDownloadOptions {
  url: string;
  /** Final target path; the partial lives next to it as `<dest>.part`. */
  destination: string;
  headers?: Record<string, string>;
  referer?: string | null;
  signal: AbortSignal;
  onProgress: (bytes: number, total: number | null) => void;
  /** Current global limit in bytes/sec; 0/null = unlimited. */
  rateLimitBps: () => number;
  idleTimeoutMs?: number;
}

export interface StreamDownloadResult {
  path: string;
  bytes: number;
  total: number | null;
  contentType: string | null;
}

const MIN_FREE_BYTES = 64 * 1024 * 1024;

function parseTotal(contentRange: string | null, contentLength: string | null): number | null {
  if (contentRange) {
    const match = /\/\s*(\d+)\s*$/.exec(contentRange);
    if (match) {
      const total = Number(match[1]);
      if (Number.isFinite(total) && total > 0) return total;
    }
  }
  if (contentLength) {
    const total = Number(contentLength);
    if (Number.isFinite(total) && total > 0) return total;
  }
  return null;
}

/** Sleep helper that rejects promptly when the download is cancelled. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Download cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("Download cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Shared across transfers: one global download-rate budget. */
class RateGate {
  private windowStart = 0;
  private used = 0;

  async consume(bytes: number, limit: () => number, signal: AbortSignal): Promise<void> {
    const rate = limit();
    if (rate <= 0) return;
    for (;;) {
      const now = Date.now();
      if (now - this.windowStart >= 1_000) {
        this.windowStart = now;
        this.used = 0;
      }
      if (this.used + bytes <= rate) {
        this.used += bytes;
        return;
      }
      await delay(Math.min(200, 1_000 - (now - this.windowStart)), signal);
    }
  }
}

const globalRateGate = new RateGate();

/** Throws a user-facing error when the target volume cannot hold `needed`. */
export async function ensureDiskSpace(directory: string, needed: number | null): Promise<void> {
  await fsp.mkdir(directory, { recursive: true });
  let free = 0;
  try {
    const stats = await fsp.statfs(directory);
    free = Number(stats.bavail) * Number(stats.bsize);
  } catch (error) {
    console.warn(`[downloads] could not read free space for ${directory}:`, error);
    return;
  }
  const required = (needed && needed > 0 ? needed : 0) + MIN_FREE_BYTES;
  if (free > 0 && free < required) {
    const needGb = (required / 1_073_741_824).toFixed(2);
    const freeGb = (free / 1_073_741_824).toFixed(2);
    throw new Error(
      `Not enough disk space in ${directory}: ${freeGb} GB free, about ${needGb} GB needed — free some space or pick another folder.`,
    );
  }
}

/**
 * Stream `url` into `destination`, resuming an existing `.part` when the
 * server honours Range requests. Resolves only after the partial has been
 * renamed to the final path.
 */
export async function streamToFile(
  options: StreamDownloadOptions,
): Promise<StreamDownloadResult> {
  const { url, destination, signal } = options;
  const temp = `${destination}.part`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });

  let existing = 0;
  try {
    existing = (await fsp.stat(temp)).size;
  } catch {
    existing = 0;
  }

  if (signal.aborted) throw new Error("Download cancelled");

  const headers: Record<string, string> = {
    "user-agent": DEFAULT_USER_AGENT,
    accept: "*/*",
    "accept-encoding": "identity",
    ...(options.headers ?? {}),
  };
  if (options.referer) headers.referer = options.referer;
  if (existing > 0) headers.range = `bytes=${existing}-`;

  const internal = new AbortController();
  const onAbort = (): void => internal.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const idleMs = options.idleTimeoutMs ?? 60_000;
  let idleTimer: NodeJS.Timeout | null = null;
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => internal.abort(), idleMs);
  };

  let out: fs.WriteStream | null = null;
  try {
    resetIdle();
    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: internal.signal,
    });

    const isPartial = response.status === 206;
    if (response.status === 416 && existing > 0) {
      // The partial already covers the whole file.
      const total = parseTotal(response.headers.get("content-range"), null);
      if (total !== null && total === existing) {
        await fsp.rename(temp, destination);
        return { path: destination, bytes: existing, total, contentType: null };
      }
    }
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const append = isPartial && existing > 0;
    const startOffset = append ? existing : 0;
    const total = append
      ? parseTotal(response.headers.get("content-range"), null)
      : parseTotal(null, response.headers.get("content-length"));
    let bytes = startOffset;

    out = fs.createWriteStream(temp, { flags: append ? "a" : "w" });
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      resetIdle();
      await globalRateGate.consume(value.byteLength, options.rateLimitBps, signal);
      bytes += value.byteLength;
      options.onProgress(bytes, total);
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => out?.once("drain", () => resolve()));
      }
    }

    await new Promise<void>((resolve, reject) => {
      out?.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    out = null;
    await fsp.rename(temp, destination);
    return {
      path: destination,
      bytes,
      total: total ?? (bytes > 0 ? bytes : null),
      contentType: response.headers.get("content-type"),
    };
  } catch (error) {
    if (signal.aborted) throw new Error("Download cancelled");
    if (internal.signal.aborted) {
      throw new Error(`Download stalled for ${Math.round(idleMs / 1000)}s — retry to resume.`);
    }
    throw error;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    signal.removeEventListener("abort", onAbort);
    if (out) {
      await new Promise<void>((resolve) => out?.end(() => resolve()));
    }
  }
}

/** Delete a download's target + partial (best effort). */
export function removeDownloadFile(target: string): void {
  try {
    fs.rmSync(target, { force: true });
  } catch {
    /* best effort */
  }
  try {
    fs.rmSync(`${target}.part`, { force: true });
  } catch {
    /* best effort */
  }
}

/** True when a path is a file or a folder. */
export function pathExists(target: string): boolean {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}
