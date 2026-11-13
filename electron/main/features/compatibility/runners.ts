/**
 * Downloadable compatibility-runner catalogue + installer.
 *
 * Ported from `src-tauri/src/compatibility/runners.rs`. The download view in
 * Settings → Compatibility lists GitHub releases for GE-Proton, CachyOS,
 * Proton-EM, Wine-GE, Kron4ek and Soda, then downloads the matching archive
 * into Steam's `compatibilitytools.d` (Proton) or GameIndex's Wine runners
 * directory. Progress is streamed to the renderer as
 * `runner-install-progress`, the same event the old build emitted.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { emit } from "../../ipc";
import { downloadToFile, httpJson } from "../../lib/http";
import { isSafeArchiveEntry } from "../emulators/naming";
import { listRunners } from "./platform";
import { RUNNER_SOURCES, runnerAssetMatches } from "./runnerCatalog";
import type {
  CompatibilityRunner,
  RemoteRunnerRelease,
  RunnerInstallProgress,
} from "./types";

const runFile = promisify(execFile);

const CACHE_TTL_MS = 15 * 60 * 1000;
const releaseCache = new Map<string, { fetchedAt: number; releases: RemoteRunnerRelease[] }>();

interface GithubAsset {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
}

interface GithubRelease {
  tag_name?: unknown;
  name?: unknown;
  published_at?: unknown;
  body?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isReleaseInstalled(
  runners: CompatibilityRunner[],
  tag: string,
  name: string,
): boolean {
  const tagLower = tag.toLowerCase();
  const nameLower = name.toLowerCase();
  return runners.some((runner) => {
    const runnerName = runner.name.toLowerCase();
    const runnerPath = runner.path.toLowerCase();
    return (
      (!!runner.version && runner.version.toLowerCase() === tagLower) ||
      runnerName.includes(tagLower) ||
      runnerPath.includes(tagLower) ||
      runnerName === nameLower
    );
  });
}

/** GitHub releases for one source, cached for 15 minutes. */
export async function fetchAvailableRunners(
  sourceRaw: string,
  forceRefresh = false,
): Promise<RemoteRunnerRelease[]> {
  const source = sourceRaw.trim().toLowerCase();
  const config = RUNNER_SOURCES[source];
  if (!config) throw new Error(`Unknown runner source: ${sourceRaw}`);

  const cached = releaseCache.get(source);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.releases;
  }

  const url = `https://api.github.com/repos/${config.repo}/releases?per_page=25`;
  const releases = await httpJson<GithubRelease[]>(url, {
    timeoutMs: 15_000,
    headers: { Accept: "application/vnd.github.v3+json" },
  });

  const installed = await listRunners().catch(() => [] as CompatibilityRunner[]);
  const mapped: RemoteRunnerRelease[] = [];
  for (const release of Array.isArray(releases) ? releases : []) {
    const tag = text(release.tag_name);
    if (!tag) continue;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets
      .map((entry) => entry as GithubAsset)
      .find((entry) => runnerAssetMatches(source, text(entry.name)));
    if (!asset) continue;
    const downloadUrl = text(asset.browser_download_url);
    const filename = text(asset.name);
    if (!downloadUrl || !filename) continue;
    const name = text(release.name) || tag;
    const publishedAt = text(release.published_at);
    mapped.push({
      id: `${source}-${tag}`,
      source,
      tag,
      name,
      releaseDate: publishedAt,
      publishedAt,
      downloadUrl,
      filename,
      sizeBytes: typeof asset.size === "number" ? asset.size : null,
      targetType: config.targetType,
      isInstalled: isReleaseInstalled(installed, tag, name),
      body: text(release.body) || null,
      htmlUrl: text(release.html_url) || undefined,
    });
  }

  releaseCache.set(source, { fetchedAt: Date.now(), releases: mapped });
  return mapped;
}

// ── Installation ─────────────────────────────────────────────────────

interface ActiveInstall {
  controller: AbortController;
  cancelled: boolean;
}

const activeInstalls = new Map<string, ActiveInstall>();

function homeDir(): string {
  return process.env.HOME || os.homedir();
}

/** Steam `compatibilitytools.d`, preferring an existing Steam root. */
export function steamCompatibilityToolsDir(): string {
  const home = homeDir();
  const candidates = [
    path.join(home, ".steam", "root", "compatibilitytools.d"),
    path.join(home, ".local", "share", "Steam", "compatibilitytools.d"),
    path.join(home, ".steam", "steam", "compatibilitytools.d"),
    path.join(
      home,
      ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam", "compatibilitytools.d",
    ),
  ];
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory() || fs.statSync(path.dirname(dir)).isDirectory()) {
        return dir;
      }
    } catch {
      /* try the next root */
    }
  }
  return path.join(home, ".local", "share", "Steam", "compatibilitytools.d");
}

/** GameIndex-managed Wine runner directory (scanned by `listRunners`). */
export function gameIndexWineRunnersDir(): string {
  return path.join(homeDir(), ".local", "share", "GameIndex", "runners", "wine");
}

function targetDirectory(targetType: string): string {
  const normalized = targetType.trim().toLowerCase();
  return normalized === "proton" || normalized === "steam_compat_tool"
    ? steamCompatibilityToolsDir()
    : gameIndexWineRunnersDir();
}

function emitProgress(progress: RunnerInstallProgress): void {
  emit("runner-install-progress", progress);
}

function safeFilename(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_") || "runner-download";
}

/** Recursively mark runner binaries executable after extraction. */
export function ensureRunnerPermissions(root: string): void {
  if (process.platform === "win32") return;
  const binaries = new Set(["proton", "wine", "wine64", "wineserver", "wineboot"]);
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const inBin = full.split(path.sep).includes("bin");
      if (!inBin && !binaries.has(entry.name)) continue;
      try {
        fs.chmodSync(full, 0o755);
      } catch {
        /* best-effort on read-only images */
      }
    }
  };
  walk(root, 0);
}

async function extractRunnerArchive(archive: string, destination: string): Promise<void> {
  await fsp.mkdir(destination, { recursive: true });
  const lower = archive.toLowerCase();
  if (lower.endsWith(".zip")) {
    let zip: AdmZip;
    try {
      zip = new AdmZip(archive);
    } catch (error) {
      throw new Error(
        `Could not read archive ${path.basename(archive)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (!isSafeArchiveEntry(entry.entryName)) {
        throw new Error(
          "Unsafe archive: an entry uses a path outside the install folder (path traversal).",
        );
      }
    }
    for (const entry of entries) {
      const target = path.join(destination, ...entry.entryName.replace(/\\/g, "/").split("/"));
      if (entry.isDirectory) {
        await fsp.mkdir(target, { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, entry.getData());
      }
    }
    return;
  }

  if (
    !(
      lower.endsWith(".tar") ||
      lower.endsWith(".tar.gz") ||
      lower.endsWith(".tgz") ||
      lower.endsWith(".tar.xz") ||
      lower.endsWith(".txz") ||
      lower.endsWith(".tar.zst") ||
      lower.endsWith(".tar.bz2")
    )
  ) {
    throw new Error(
      `Unsupported archive type ${path.extname(archive) || "(none)"} — use .tar.xz, .tar.gz or .zip.`,
    );
  }

  try {
    await runFile("tar", ["-xf", archive, "-C", destination], { maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not extract ${path.basename(archive)}: ${message}`);
  }
}

/** Download + extract one catalogue release. */
export async function installCompatibilityRunner(input: {
  downloadUrl: string;
  filename: string;
  runnerName: string;
  targetType: string;
}): Promise<null> {
  const runnerName = input.runnerName.trim() || input.filename;
  const url = input.downloadUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Runner download URL must be http(s)");
  }
  const destination = targetDirectory(input.targetType);
  const tempDir = path.join(destination, ".temp_downloads");
  const tempFile = path.join(
    tempDir,
    `download_${Date.now()}_${safeFilename(input.filename)}`,
  );
  await fsp.mkdir(tempDir, { recursive: true });

  const controller = new AbortController();
  const active: ActiveInstall = { controller, cancelled: false };
  activeInstalls.set(runnerName, active);
  const base: Omit<RunnerInstallProgress, "status" | "downloadedBytes" | "totalBytes" | "percent" | "speedBytesPerSec" | "error"> = {
    runnerName,
  };

  emitProgress({
    ...base,
    status: "downloading",
    downloadedBytes: 0,
    totalBytes: null,
    percent: 0,
    speedBytesPerSec: 0,
    error: null,
  });

  let lastEmit = Date.now();
  let lastBytes = 0;

  try {
    await downloadToFile(url, tempFile, {
      timeoutMs: 30 * 60 * 1000,
      signal: controller.signal,
      onProgress: (bytes, total) => {
        const now = Date.now();
        if (now - lastEmit < 200 && (total === null || bytes < total)) return;
        const elapsed = Math.max(1, now - lastEmit) / 1000;
        const speed = Math.max(0, (bytes - lastBytes) / elapsed);
        lastEmit = now;
        lastBytes = bytes;
        emitProgress({
          ...base,
          status: "downloading",
          downloadedBytes: bytes,
          totalBytes: total,
          percent: total && total > 0 ? Math.min(100, (bytes / total) * 100) : 0,
          speedBytesPerSec: speed,
          error: null,
        });
      },
    });

    if (active.cancelled) {
      throw new Error("Download cancelled by user");
    }

    emitProgress({
      ...base,
      status: "extracting",
      downloadedBytes: lastBytes,
      totalBytes: null,
      percent: 100,
      speedBytesPerSec: 0,
      error: null,
    });

    await extractRunnerArchive(tempFile, destination);
    ensureRunnerPermissions(destination);

    emitProgress({
      ...base,
      status: "completed",
      downloadedBytes: lastBytes,
      totalBytes: null,
      percent: 100,
      speedBytesPerSec: 0,
      error: null,
    });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled =
      active.cancelled ||
      message.toLowerCase().includes("cancel") ||
      message.toLowerCase().includes("abort");
    emitProgress({
      ...base,
      status: cancelled ? "cancelled" : "failed",
      downloadedBytes: lastBytes,
      totalBytes: null,
      percent: 0,
      speedBytesPerSec: 0,
      error: cancelled ? null : message,
    });
    throw error;
  } finally {
    activeInstalls.delete(runnerName);
    await fsp.rm(tempFile, { force: true }).catch(() => undefined);
  }
}

/** Abort a running install; safe when nothing is running. */
export function cancelRunnerInstall(runnerName: string): null {
  const active = activeInstalls.get(runnerName.trim());
  if (active) {
    active.cancelled = true;
    active.controller.abort();
    activeInstalls.delete(runnerName.trim());
  }
  return null;
}

function archiveStem(archive: string): string {
  const base = path.basename(archive);
  return base
    .replace(/\.(tar\.gz|tar\.xz|tar\.zst|tar\.bz2|tgz|txz|zip|tar)$/i, "")
    .trim();
}

/** Install a runner from a user-picked local archive; returns its name. */
export async function installRunnerFromArchive(
  archivePath: string,
  targetType: string,
): Promise<string> {
  const archive = archivePath.trim();
  if (!archive) throw new Error("An archive path is required");
  const stat = await fsp.stat(archive).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error(`Archive not found: ${archive}`);
  const destination = targetDirectory(targetType);
  emitProgress({
    runnerName: archiveStem(archive) || path.basename(archive),
    status: "extracting",
    downloadedBytes: 0,
    totalBytes: null,
    percent: 100,
    speedBytesPerSec: 0,
    error: null,
  });
  await extractRunnerArchive(archive, destination);
  ensureRunnerPermissions(destination);
  const name = archiveStem(archive) || path.basename(archive);
  emitProgress({
    runnerName: name,
    status: "completed",
    downloadedBytes: 0,
    totalBytes: null,
    percent: 100,
    speedBytesPerSec: 0,
    error: null,
  });
  return name;
}
