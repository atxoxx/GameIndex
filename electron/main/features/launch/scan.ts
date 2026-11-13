/**
 * `scan_folders_for_exes` / `cancel_scan_exes`.
 *
 * Ported from `src-tauri/src/media.rs` (`scan_folders_inner`, `ExeScanState`,
 * `ExeScanProgress`). Walks the chosen folders for launchable programs, emits
 * throttled `exe-scan-progress` events (≤ 1 per 80 ms) and stops promptly when
 * cancelled. The walk is async + bounded, so the main process stays responsive.
 */
import { emit } from "../../ipc";
import { normalizePathLower } from "./paths";
import { isSkipName } from "./processes";
import { isLaunchableFile, extensionOf } from "./programFile";
import { walkDirectory } from "./walk";

export interface ExeInfo {
  path: string;
  size: number;
  /** Unix seconds, 0 when the metadata could not be read. */
  modifiedAt: number;
}

export interface ExeScanProgressPayload {
  scanId: string;
  currentFolder: string;
  folderIndex: number;
  totalFolders: number;
  foldersScanned: number;
  filesExamined: number;
  exesFound: number;
  lastFoundExe: string | null;
  done: boolean;
  cancelled: boolean;
}

interface ScanState {
  cancelled: boolean;
  lastEmitAt: number;
  foldersScanned: number;
  filesExamined: number;
  exes: ExeInfo[];
  seen: Set<string>;
  lastFoundExe: string | null;
}

/** Scans currently running, keyed by the renderer's `scanId`. */
const activeScans = new Map<string, ScanState>();

function shouldDescend(name: string): boolean {
  const lower = name.toLowerCase();
  if (name.startsWith(".") || name.startsWith("_") || name.startsWith("$")) return false;
  // Distribution/runtime payloads never contain the game's launch binary and
  // can dominate a large install tree.
  return ![
    "redist",
    "redistributables",
    "vcredist",
    "directx",
    "__installer",
    "dotnet",
  ].includes(lower);
}

function emitProgress(
  scanId: string,
  state: ScanState,
  currentFolder: string,
  folderIndex: number,
  totalFolders: number,
  done: boolean,
  cancelled: boolean,
): void {
  const payload: ExeScanProgressPayload = {
    scanId,
    currentFolder,
    folderIndex,
    totalFolders,
    foldersScanned: state.foldersScanned,
    filesExamined: state.filesExamined,
    exesFound: state.exes.length,
    lastFoundExe: state.lastFoundExe,
    done,
    cancelled,
  };
  emit("exe-scan-progress", payload);
}

/** Throttled progress tick (at most one every 80 ms). */
function maybeEmitProgress(
  scanId: string,
  state: ScanState,
  currentFolder: string,
  folderIndex: number,
  totalFolders: number,
): void {
  const now = Date.now();
  if (now - state.lastEmitAt < 80) return;
  state.lastEmitAt = now;
  emitProgress(scanId, state, currentFolder, folderIndex, totalFolders, false, false);
}

/**
 * Scan every folder for launchable programs. Returns the discovered programs
 * sorted by path (stable run to run); an empty array is a valid result.
 */
export async function scanFoldersForExes(
  folderPaths: string[],
  scanId?: string | null,
): Promise<ExeInfo[]> {
  const id = scanId && scanId.trim()
    ? scanId.trim()
    : `scan-${Date.now()}`;
  const state: ScanState = {
    cancelled: false,
    lastEmitAt: 0,
    foldersScanned: 0,
    filesExamined: 0,
    exes: [],
    seen: new Set(),
    lastFoundExe: null,
  };
  activeScans.set(id, state);

  const folders = Array.isArray(folderPaths)
    ? folderPaths.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
  const totalFolders = folders.length;

  emitProgress(id, state, folders[0] ?? "", totalFolders > 0 ? 1 : 0, totalFolders, false, false);

  let exes: ExeInfo[] = [];
  try {
    for (let index = 0; index < folders.length; index += 1) {
      if (state.cancelled) break;
      const folder = folders[index];
      const folderIndex = index + 1;
      const walk = await walkDirectory(folder, {
        maxDepth: 25,
        shouldDescend,
        isCancelled: () => state.cancelled,
        onFile: async (filePath, size, mtimeMs, _depth, executable) => {
          if (state.cancelled) return;
          const name = filePath.replace(/^.*[\\/]/, "");
          if (name.startsWith(".")) {
            maybeEmitProgress(id, state, folder, folderIndex, totalFolders);
            return;
          }
          const extension = extensionOf(filePath);

          if (!(await isLaunchableFile(filePath, executable))) {
            maybeEmitProgress(id, state, folder, folderIndex, totalFolders);
            return;
          }

          const stem = extension ? name.slice(0, Math.max(0, name.lastIndexOf("."))) : name;
          if (isSkipName(stem)) {
            maybeEmitProgress(id, state, folder, folderIndex, totalFolders);
            return;
          }
          const key = normalizePathLower(filePath);
          if (state.seen.has(key)) return;
          state.seen.add(key);

          state.exes.push({ path: filePath, size, modifiedAt: Math.floor(mtimeMs / 1000) });
          state.lastFoundExe = filePath;
          state.lastEmitAt = Date.now();
          emitProgress(id, state, folder, folderIndex, totalFolders, false, false);
        },
      });
      state.foldersScanned += walk.foldersScanned;
      state.filesExamined += walk.filesExamined;
    }
    exes = [...state.exes].sort((a, b) => a.path.localeCompare(b.path));
  } finally {
    emitProgress(id, state, "", totalFolders, totalFolders, true, state.cancelled);
    activeScans.delete(id);
  }
  return exes;
}

/** Cancel one scan, or every running scan when `scanId` is omitted. */
export function cancelExeScans(scanId?: string | null): void {
  if (scanId && scanId.trim()) {
    const state = activeScans.get(scanId.trim());
    if (state) state.cancelled = true;
    return;
  }
  for (const state of activeScans.values()) state.cancelled = true;
}

/** True while a scan with this id is running (diagnostics/tests). */
export function isScanRunning(scanId: string): boolean {
  return activeScans.has(scanId);
}
