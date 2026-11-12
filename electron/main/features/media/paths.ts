/**
 * Capture-root registry and path guards for the media commands.
 *
 * The Gallery sends absolute folders the user picked, and the delete action
 * sends a file path that came back from a previous scan. Neither is trusted:
 * listing is only allowed for a real directory that is not a filesystem or
 * profile root, and deletion additionally requires the file to live below a
 * root this process has actually scanned (or a known capture root).
 *
 * Ported from the guards in `src-tauri/src/media.rs` and
 * `src-tauri/src/library_health.rs`, extended with a persisted root list so a
 * renderer bug cannot turn `delete_media_file` into a general delete primitive.
 */
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { userDataPath } from "../../lib/paths";
import { createJsonStore } from "../../state/jsonStore";

export interface MediaFileRef {
  path: string;
  /** Unix seconds; 0 when metadata could not be read. */
  modifiedAt: number;
}

interface MediaRootsDocument {
  version: number;
  roots: string[];
}

const MEDIA_ROOTS_FILE = "media-roots.json";
const MAX_ROOTS = 128;

const rootsStore = createJsonStore<MediaRootsDocument>(
  MEDIA_ROOTS_FILE,
  () => ({ version: 1, roots: [] }),
  (value) => ({
    version: 1,
    roots: Array.isArray(value.roots)
      ? value.roots.filter((entry): entry is string => typeof entry === "string")
      : [],
  }),
);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv"]);

export function isCaptureExtension(extension: string, includeVideo: boolean): boolean {
  const lower = extension.trim().toLowerCase().replace(/^\./, "");
  return IMAGE_EXTENSIONS.has(lower) || (includeVideo && VIDEO_EXTENSIONS.has(lower));
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLowerCase().replace(/\//g, "\\")
    : resolved.replace(/\\/g, "/");
}

export function isInsideRoot(candidate: string, root: string): boolean {
  if (!candidate || !root) return false;
  const child = normalizeForCompare(candidate);
  const parent = normalizeForCompare(root).replace(/[\\/]+$/, "");
  if (!parent) return false;
  if (child === parent) return true;
  return child.startsWith(`${parent}${path.sep === "\\" ? "\\" : "/"}`);
}

function realPathOrResolved(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    try {
      return fs.realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  }
}

function isFilesystemRoot(value: string): boolean {
  const resolved = path.resolve(value);
  return path.parse(resolved).root === resolved;
}

function forbiddenRoots(): string[] {
  const candidates: string[] = [];
  const push = (value: string | undefined | null) => {
    if (value && value.trim()) candidates.push(realPathOrResolved(value));
  };
  try {
    push(app.getPath("userData"));
  } catch {
    push(userDataPath());
  }
  try {
    push(app.getPath("appData"));
  } catch {
    /* not available in the harness */
  }
  try {
    push(app.getPath("temp"));
  } catch {
    /* not available in the harness */
  }
  push(os.homedir());
  push(process.env.SystemRoot);
  push(process.env.ProgramFiles);
  push(process.env["ProgramFiles(x86)"]);
  push(process.env.ProgramW6432);
  return candidates;
}

/** A folder root the Gallery is allowed to scan. */
export function assertListableFolder(folderPath: string): string {
  const raw = folderPath?.trim();
  if (!raw) throw new Error("A folder path is required.");
  if (raw.includes("\0")) throw new Error("Invalid folder path.");
  if (raw.split(/[\\/]+/).includes("..")) {
    throw new Error("Refusing a folder path that traverses upward — pick the folder directly.");
  }
  if (!path.isAbsolute(raw)) throw new Error("Choose an absolute capture folder.");
  const resolved = path.resolve(raw);
  if (isFilesystemRoot(resolved)) {
    throw new Error("Refusing to scan an entire drive — choose a capture folder instead.");
  }
  const forbidden = forbiddenRoots();
  if (forbidden.some((root) => normalizeForCompare(root) === normalizeForCompare(resolved))) {
    throw new Error("Refusing to scan a system or profile folder — choose a capture folder.");
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error("Folder not found — it may have been moved or deleted.");
  }
  if (!stat.isDirectory()) throw new Error("That path is not a folder.");

  // Do not let a normalized ".." walk upward to a parent of a folder the
  // Gallery already scanned: deleting from that parent would widen the root
  // set beyond the user's chosen capture folder.
  for (const root of rootsStore.read().roots) {
    if (normalizeForCompare(root) !== normalizeForCompare(resolved) && isInsideRoot(root, resolved)) {
      throw new Error(
        "Refusing to scan a parent of an existing capture folder — pick the capture folder directly.",
      );
    }
  }

  return realPathOrResolved(resolved);
}

/** Default capture folders plus the ones the user configured in overlay.json. */
function configuredRoots(): string[] {
  const roots: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    roots.push(realPathOrResolved(trimmed));
  };
  try {
    push(path.join(app.getPath("pictures"), "Screenshots"));
  } catch {
    push(path.join(os.homedir(), "Pictures", "Screenshots"));
  }
  try {
    push(path.join(app.getPath("videos"), "Captures"));
  } catch {
    push(path.join(os.homedir(), "Videos", "Captures"));
  }
  try {
    const raw = fs.readFileSync(path.join(app.getPath("userData"), "overlay.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      settings?: { screenshotFolder?: unknown; videoFolder?: unknown };
      screenshotFolder?: unknown;
      videoFolder?: unknown;
    };
    const settings = parsed.settings ?? parsed;
    if (typeof settings.screenshotFolder === "string") push(settings.screenshotFolder);
    if (typeof settings.videoFolder === "string") push(settings.videoFolder);
  } catch {
    /* overlay settings are optional */
  }
  return roots;
}

/** Every root a delete may target, newest registered first. */
export function knownMediaRoots(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of [...rootsStore.read().roots, ...configuredRoots()]) {
    const resolved = realPathOrResolved(root);
    const key = normalizeForCompare(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

/** Remember a folder the Gallery successfully scanned. */
export function registerMediaRoot(folderPath: string): void {
  const resolved = realPathOrResolved(folderPath);
  if (isFilesystemRoot(resolved)) return;
  const key = normalizeForCompare(resolved);
  const doc = rootsStore.read();
  if (doc.roots.some((root) => normalizeForCompare(root) === key)) return;
  const roots = [...doc.roots, resolved].slice(-MAX_ROOTS);
  rootsStore.write({ version: 1, roots });
}

export interface ResolvedCaptureFile {
  /** Real path after symlink resolution. */
  absolutePath: string;
  extension: string;
  sizeBytes: number;
}

/**
 * Resolve a file the Gallery asked to delete. Rejects directories, unknown
 * extensions and paths outside every scanned/configured capture root.
 */
export function resolveCaptureFile(filePath: string): ResolvedCaptureFile {
  const raw = filePath?.trim();
  if (!raw) throw new Error("A capture file path is required.");
  if (raw.includes("\0")) throw new Error("Invalid capture path.");
  if (raw.split(/[\\/]+/).includes("..")) {
    throw new Error("Refusing a capture path that traverses upward.");
  }
  if (!path.isAbsolute(raw)) throw new Error("Capture paths must be absolute.");
  const absolute = realPathOrResolved(path.resolve(raw));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new Error("Capture file not found — it may have been moved or deleted.");
  }
  if (!stat.isFile()) throw new Error("That path is not a file.");
  const extension = path.extname(absolute).replace(/^\./, "").toLowerCase();
  if (!isCaptureExtension(extension, true)) {
    throw new Error("Not a capture file — only images and clips can be deleted.");
  }
  const roots = knownMediaRoots();
  if (!roots.some((root) => isInsideRoot(absolute, root))) {
    throw new Error(
      "Refusing to delete a file outside the configured capture folders — rescan the folder first.",
    );
  }
  return { absolutePath: absolute, extension, sizeBytes: stat.size };
}
