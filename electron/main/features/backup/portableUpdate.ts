/**
 * Portable (unpacked) update download.
 *
 * Ported from `src-tauri/src/updater.rs`. The renderer owns the update feed and
 * passes the artifact URL; this module streams it to `%TEMP%`, reports progress
 * over the caller's `Channel`, and verifies the result.
 *
 * Streaming uses the downloads workstream's `streamToFile` rather than
 * `lib/http.ts`'s `downloadToFile`: the portable binary is hundreds of MB and
 * the shared one-shot helper deletes its partial on cancel, so it cannot resume
 * a dropped transfer. `streamToFile` keeps `<dest>.part`, resumes with a
 * `Range` request, and aborts promptly when the cancel command fires.
 */
import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { CommandArgs, CommandContext } from "../../ipc";
import { sendChannel } from "../../ipc";
import { streamToFile } from "../downloads/httpDownload";

/** Tagged events the renderer's `Channel<PortableDownloadEvent>` expects. */
type PortableEvent =
  | { event: "Started"; data?: { contentLength?: number } }
  | { event: "Progress"; data: { downloaded: number; total?: number } }
  | { event: "Finished"; data: null };

let activeController: AbortController | null = null;

/** Abort an in-flight download (wired to `portable_update_cancel`). */
export function cancelPortableUpdate(): boolean {
  if (!activeController || activeController.signal.aborted) return false;
  activeController.abort();
  return true;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function channelIdOf(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as { __giChannel?: unknown }).__giChannel;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return null;
}

function sanitizeFileName(value: string): string {
  const base = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 120) : "";
}

function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const raw = decodeURIComponent(pathname.split("/").pop() ?? "");
    return sanitizeFileName(raw);
  } catch {
    return "";
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export interface PortableStageInfo {
  path: string;
  sizeBytes: number;
  sha256: string;
  /** True when a manifest hash/size was provided and matched. */
  verified: boolean;
}

/**
 * Download the release artifact into the staging folder.
 *
 * Recognized optional arguments (all absent in today's `UpdateContext` call):
 * `sizeBytes`, `sha256`, `fileName`. When a hash is supplied it is verified and
 * a mismatch throws an error containing "verification" (which the UI maps to
 * its localized message).
 */
export async function downloadPortableUpdate(
  args: CommandArgs,
  context: CommandContext,
): Promise<PortableStageInfo> {
  const url = asString(args.url).trim();
  if (!url) throw new Error("An update URL is required");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid update URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid update URL scheme: ${parsed.protocol}`);
  }

  const channelId = channelIdOf(args.onEvent);
  const send = (event: PortableEvent): void => {
    if (channelId === null) return;
    try {
      sendChannel(context.sender, channelId, event);
    } catch (error) {
      console.error("[updater] channel send failed:", error);
    }
  };

  const expectedSize = asOptionalNumber(args.sizeBytes ?? args.size);
  const expectedHash = asString(args.sha256 ?? args.hash)
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
  const stagingRoot = path.join(app.getPath("temp"), "gameindex-update");
  await fsp.mkdir(stagingRoot, { recursive: true });

  const fileName =
    sanitizeFileName(asString(args.fileName)) ||
    fileNameFromUrl(url) ||
    (process.platform === "win32" ? "GameIndex.exe" : "GameIndex-update");
  const destination = path.join(stagingRoot, fileName);

  if (activeController) activeController.abort();
  const controller = new AbortController();
  activeController = controller;

  let started = false;
  let lastSent = 0;
  const onProgress = (bytes: number, total: number | null): void => {
    const resolvedTotal = total ?? expectedSize ?? undefined;
    if (!started) {
      started = true;
      send({
        event: "Started",
        data: resolvedTotal ? { contentLength: resolvedTotal } : undefined,
      });
    }
    const now = Date.now();
    if (now - lastSent < 100) return;
    lastSent = now;
    send({
      event: "Progress",
      data: resolvedTotal ? { downloaded: bytes, total: resolvedTotal } : { downloaded: bytes },
    });
  };

  try {
    await streamToFile({
      url,
      destination,
      signal: controller.signal,
      onProgress,
      rateLimitBps: () => 0,
      headers: { "accept-encoding": "identity" },
      idleTimeoutMs: 60_000,
    });

    const stat = await fsp.stat(destination);
    const sha256 = await sha256File(destination);
    let verified = false;

    if (expectedSize !== null && stat.size !== expectedSize) {
      await fsp.rm(destination, { force: true });
      throw new Error(
        `Update verification failed: expected ${expectedSize} bytes, got ${stat.size}`,
      );
    }
    if (expectedHash) {
      if (sha256 !== expectedHash) {
        await fsp.rm(destination, { force: true });
        throw new Error("Update verification failed: hash mismatch");
      }
      verified = true;
    } else if (expectedSize !== null) {
      verified = true;
    } else if (asString(args.signature)) {
      // `latest.json` carries a minisign signature, which this build has no
      // verifier for. The download still succeeds; the caller is told it was
      // not cryptographically checked instead of pretending otherwise.
      console.warn(
        "[updater] artifact signature present but no minisign verifier is bundled; skipping signature check",
      );
    }

    send({ event: "Finished", data: null });
    return { path: destination, sizeBytes: stat.size, sha256, verified };
  } finally {
    if (activeController === controller) activeController = null;
  }
}
