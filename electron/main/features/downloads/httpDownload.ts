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
import { createHash } from "node:crypto";
import path from "node:path";
import { DEFAULT_USER_AGENT } from "../../lib/http";
import type { ChecksumSpec } from "./types";

export type { ChecksumSpec };

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
  let expectedTotal: number | null = null;
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
    expectedTotal = total;
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
    // Some hosts close a keep-alive socket while we are still draining a
    // throttled response; undici reports `terminated` even though every
    // advertised byte reached the `.part`. That is a complete transfer.
    if (expectedTotal !== null && expectedTotal > 0) {
      // Close the write stream first: Windows refuses to rename an open file.
      if (out) {
        await new Promise<void>((resolve) => out?.end(() => resolve()));
        out = null;
      }
      const size = await fsp
        .stat(temp)
        .then((stats) => stats.size)
        .catch(() => 0);
      if (size >= expectedTotal) {
        await fsp.rename(temp, destination);
        return { path: destination, bytes: size, total: expectedTotal, contentType: null };
      }
    }
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

/** One expected checksum supplied by a plugin result / the renderer. */
const SUPPORTED_HASH_ALGOS: Record<string, "md5" | "sha1" | "sha256" | "sha512"> = {
  md5: "md5",
  sha1: "sha1",
  sha256: "sha256",
  sha512: "sha512",
};

/**
 * Tolerant checksum normalisation: accepts `{algo, value}` rows from a plugin
 * result (algo may be `SHA-256`, `sha256`, …) and drops anything we cannot
 * verify, instead of silently claiming the file is intact.
 */
export function normalizeChecksums(value: unknown): ChecksumSpec[] {
  if (!Array.isArray(value)) return [];
  const out: ChecksumSpec[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const algo = typeof row.algo === "string" ? row.algo.trim().toLowerCase().replace(/[-_\s]/g, "") : "";
    const digest = typeof row.value === "string" ? row.value.trim() : "";
    if (!algo || !digest) continue;
    out.push({ algo, value: digest });
  }
  return out;
}

function hashFile(file: string, algo: "md5" | "sha1" | "sha256" | "sha512"): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algo);
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Verify the first checksum whose algorithm we support. Throws a user-facing
 * error on a mismatch (the caller deletes the corrupt file); returns `null`
 * when no usable checksum was supplied.
 */
export async function verifyFileChecksum(
  file: string,
  checksums: ChecksumSpec[] | null | undefined,
): Promise<{ algo: string; expected: string; actual: string } | null> {
  if (!checksums || checksums.length === 0) return null;
  for (const spec of checksums) {
    const algo = SUPPORTED_HASH_ALGOS[spec.algo] ?? SUPPORTED_HASH_ALGOS[`sha${spec.algo}`];
    if (!algo) continue;
    const actual = await hashFile(file, algo);
    if (actual.toLowerCase() !== spec.value.toLowerCase()) {
      throw new Error(
        `Checksum mismatch (${algo}): expected ${spec.value}, got ${actual}. The file was removed — retry the download.`,
      );
    }
    return { algo, expected: spec.value, actual };
  }
  console.warn(
    `[downloads] no supported checksum algorithm in ${checksums
      .map((spec) => spec.algo)
      .join(", ")} — skipping verification`,
  );
  return null;
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
