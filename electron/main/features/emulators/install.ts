/**
 * Downloadable-emulator install pipeline.
 *
 * Ported from `src-tauri/src/emulator_install.rs` (`start_emulator_install`,
 * `resolve_install_dir`, `exe_name_for_download`, `find_executable`,
 * `ensure_executable`) and the `finish_emulator_install` command in
 * `src-tauri/src/emulation.rs`.
 *
 * The download itself goes through the shared download engine
 * (`features/downloads/manager.ts`) so the renderer's install modal can watch
 * the real queue via `download-progress` / `torrent_get_all`. When the manager
 * cannot be created (headless harness, app not ready) the command falls back to
 * `lib/http.ts` `downloadToFile` and returns an already-completed record.
 *
 * Extraction supports **.zip only** (adm-zip). Every catalog .7z build is
 * rejected up front with an actionable message instead of pretending the
 * archive was extracted — this build has no 7-Zip decoder.
 */
import AdmZip from "adm-zip";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { emit } from "../../ipc";
import { downloadToFile } from "../../lib/http";
import { createJsonStore } from "../../state/jsonStore";
import { getDownloadManager } from "../downloads/manager";
import type { DownloadRecord } from "../downloads/types";
import { catalogEntry } from "./catalog";
import { isSafeArchiveEntry } from "./naming";
import { saveEmulator } from "./store";
import type {
  EmulatorInstallSpec,
  EmulatorInstallsDocument,
  EmulatorRow,
} from "./types";

const SPEC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WATCH_INTERVAL_MS = 500;
const WATCH_TIMEOUT_MS = 30 * 60 * 1000;

const installStore = createJsonStore<EmulatorInstallsDocument>(
  "emulator-installs.json",
  () => ({ version: 1, installs: {} }),
  (value) => {
    const raw = value as { installs?: unknown } | null;
    const installs: Record<string, EmulatorInstallSpec> = {};
    const now = Date.now();
    if (raw && raw.installs && typeof raw.installs === "object") {
      for (const [id, entry] of Object.entries(
        raw.installs as Record<string, unknown>,
      )) {
        if (!entry || typeof entry !== "object") continue;
        const spec = entry as EmulatorInstallSpec;
        if (typeof spec.installDir !== "string" || !spec.installDir) continue;
        if (now - (spec.createdAtMs ?? 0) > SPEC_TTL_MS) continue;
        installs[id] = {
          downloadId: id,
          emulatorKey: typeof spec.emulatorKey === "string" ? spec.emulatorKey : "",
          installDir: spec.installDir,
          archivePath: typeof spec.archivePath === "string" ? spec.archivePath : "",
          createdAtMs: typeof spec.createdAtMs === "number" ? spec.createdAtMs : now,
          extracted: spec.extracted === true,
        };
      }
    }
    return { version: 1, installs };
  },
);

function specFor(downloadId: string): EmulatorInstallSpec | null {
  return installStore.read().installs[downloadId] ?? null;
}

function putSpec(spec: EmulatorInstallSpec): void {
  const document = installStore.read();
  document.installs[spec.downloadId] = spec;
  installStore.write(document);
}

function patchSpec(downloadId: string, patch: Partial<EmulatorInstallSpec>): void {
  const spec = specFor(downloadId);
  if (!spec) return;
  putSpec({ ...spec, ...patch });
}

function dropSpec(downloadId: string): void {
  const document = installStore.read();
  if (!document.installs[downloadId]) return;
  delete document.installs[downloadId];
  installStore.write(document);
}

function archiveFileName(url: string, key: string): string {
  const segment = url.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* keep the raw segment */
  }
  if (!decoded) return `${key}.zip`;
  return path.extname(decoded) ? decoded : `${key}.zip`;
}

/** True when the archive can be extracted by this build. */
export function isSupportedArchive(archive: string): boolean {
  return path.extname(archive).toLowerCase() === ".zip";
}

/**
 * Extract a .zip into `destination`. Returns the number of files written.
 * Entry names are validated first so an archive cannot write outside the
 * install directory.
 */
export async function extractArchive(
  archive: string,
  destination: string,
): Promise<number> {
  if (!isSupportedArchive(archive)) {
    throw new Error(
      `Unsupported archive type ${path.extname(archive) || "(none)"} — this build can only extract .zip downloads.`,
    );
  }
  let zip: AdmZip;
  try {
    zip = new AdmZip(archive);
  } catch (error) {
    throw new Error(
      `Could not read archive ${archive}: ${error instanceof Error ? error.message : String(error)}`,
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

  await fsp.mkdir(destination, { recursive: true });
  let written = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.isDirectory) {
      await fsp.mkdir(
        path.join(destination, ...entry.entryName.split("/")),
        { recursive: true },
      );
      continue;
    }
    const target = path.join(destination, ...entry.entryName.replace(/\\/g, "/").split("/"));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.getData());
    written += 1;
    if (index % 8 === 7) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return written;
}

function fileMatchesTarget(nameLower: string, target: string): boolean {
  if (!target) return false;
  if (nameLower === target) return true;
  if (nameLower.endsWith(target)) return true;
  const stem = nameLower.replace(/\.exe$/, "");
  const targetStem = target.replace(/\.exe$/, "");
  return stem === targetStem || stem.startsWith(`${targetStem}-`) || stem.endsWith(`-${targetStem}`);
}

/**
 * Recursively find the launcher under `installDir` (bounded to 6 levels,
 * deterministic sorted walk) with a shallow `.exe` fallback.
 */
export function findExecutable(installDir: string, exeName: string): string | null {
  const wanted = exeName.trim().toLowerCase();
  let fallback: string | null = null;

  const walk = (dir: string, depth: number): string | null => {
    if (depth > 6) return null;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (lower.startsWith(".") || lower.startsWith("__macosx")) continue;
        const hit = walk(full, depth + 1);
        if (hit) return hit;
        continue;
      }
      if (!entry.isFile()) continue;
      if (process.platform === "win32" && !lower.endsWith(".exe")) continue;
      if (fileMatchesTarget(lower, wanted)) return full;
      if (depth <= 2 && !fallback && lower.endsWith(".exe")) fallback = full;
    }
    return null;
  };

  return walk(installDir, 0) ?? fallback;
}

/** Recover the catalog key from an `emu_<key>_<timestamp>` download id. */
function keyFromDownloadId(downloadId: string): string {
  const spec = specFor(downloadId);
  if (spec?.emulatorKey) return spec.emulatorKey;
  if (downloadId.startsWith("emu_")) {
    const rest = downloadId.slice(4);
    const index = rest.lastIndexOf("_");
    if (index > 0) return rest.slice(0, index);
  }
  return "";
}

function installDirFor(downloadId: string): string | null {
  const spec = specFor(downloadId);
  if (spec?.installDir) return spec.installDir;
  try {
    const record = getDownloadManager().record(downloadId);
    if (record?.savePath) return path.dirname(record.savePath);
  } catch {
    /* download manager unavailable (headless) */
  }
  return null;
}

/**
 * Complete an install: find the extracted executable, make sure the ROM folder
 * exists, persist the emulator, and return it with `executablePath` set.
 */
export function finishEmulatorInstall(
  downloadId: string,
  emulatorInput: unknown,
): EmulatorRow {
  const installDir = installDirFor(downloadId);
  if (!installDir) {
    throw new Error(`No install in progress for download '${downloadId}'`);
  }
  const key = keyFromDownloadId(downloadId);
  const entry = key ? catalogEntry(key) : null;
  const exeName =
    entry?.exeName ?? (process.platform === "win32" ? "emulator.exe" : "emulator");
  const executable = findExecutable(installDir, exeName);
  if (!executable) {
    throw new Error(
      "Emulator executable not found after extraction — the archive may have failed to extract. Unpack it manually and point the emulator at its executable.",
    );
  }

  const input = (emulatorInput ?? {}) as Record<string, unknown>;
  const romFolder =
    typeof input.romFolder === "string" && input.romFolder.trim()
      ? input.romFolder.trim()
      : path.join(installDir, "roms");
  fs.mkdirSync(romFolder, { recursive: true });

  const saved = saveEmulator(
    { ...input, executablePath: executable, romFolder },
    { validateExecutable: true },
  );
  dropSpec(downloadId);
  return saved;
}

/** Emit the queue snapshot the install modal listens to. */
function broadcastQueue(): void {
  try {
    const manager = getDownloadManager();
    emit(
      "download-progress",
      manager.list().map((record) => ({
        ...record,
        files: record.files.map((file) => ({ ...file })),
      })),
    );
  } catch {
    /* no queue available */
  }
}

const watched = new Set<string>();

/**
 * Watch one download until the shared engine reports `completed`, extract the
 * archive, and flag the record as extracted so the renderer's install modal
 * proceeds to `finish_emulator_install`.
 */
function watchInstall(downloadId: string): void {
  if (watched.has(downloadId)) return;
  watched.add(downloadId);
  const startedAt = Date.now();

  const timer = setInterval(() => {
    const stop = (): void => {
      clearInterval(timer);
      watched.delete(downloadId);
    };
    let record: DownloadRecord | null = null;
    try {
      record = getDownloadManager().record(downloadId);
    } catch {
      stop();
      return;
    }
    if (!record) {
      stop();
      return;
    }
    if (record.status.kind === "error" || record.status.kind === "removed") {
      stop();
      return;
    }
    if (record.status.kind !== "completed") {
      if (Date.now() - startedAt > WATCH_TIMEOUT_MS) stop();
      return;
    }
    stop();

    const spec = specFor(downloadId);
    const destination = spec?.installDir ?? path.dirname(record.savePath);
    void extractArchive(record.savePath, destination)
      .then(() => {
        patchSpec(downloadId, { extracted: true });
        // The engine's record is the modal's source of truth; flip its
        // `extracted` flag (the manager has no public setter) and re-emit the
        // queue so the renderer advances immediately.
        record.extracted = true;
        broadcastQueue();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        record.status = { kind: "error", message: `Extraction failed: ${message}` };
        record.downloadSpeed = 0;
        record.uploadSpeed = 0;
        broadcastQueue();
        console.error("[emulators] emulator install extraction failed:", error);
      });
  }, WATCH_INTERVAL_MS);
  timer.unref();
}

/**
 * Kick off an emulator install: create the install folder, start the archive
 * download, and return the engine's download record (id starts with `emu_`).
 */
export async function startEmulatorInstall(
  emulatorKey: string,
  installDir: string,
): Promise<DownloadRecord> {
  const entry = catalogEntry(emulatorKey);
  if (!entry) throw new Error(`No downloadable build for '${emulatorKey}'`);
  const target = installDir.trim();
  if (!target) throw new Error("Choose an install folder for the emulator");

  const fileName = archiveFileName(entry.url, entry.key);
  if (!isSupportedArchive(fileName)) {
    throw new Error(
      `${entry.key} is distributed as ${path.extname(fileName) || "an archive"}; this build can only auto-install .zip builds. Download it from ${entry.url}, extract it, then point the emulator at its executable.`,
    );
  }

  await fsp.mkdir(target, { recursive: true });
  const romFolder = path.join(target, "roms");
  await fsp.mkdir(romFolder, { recursive: true });

  const downloadId = `emu_${entry.key}_${Date.now()}`;
  const savePath = path.join(target, fileName);
  putSpec({
    downloadId,
    emulatorKey: entry.key,
    installDir: target,
    archivePath: savePath,
    createdAtMs: Date.now(),
    extracted: false,
  });

  try {
    const manager = getDownloadManager();
    const record = await manager.createDirect({
      id: downloadId,
      url: entry.url,
      savePath,
      sourceName: "Emulator",
      autoExtract: true,
    });
    watchInstall(downloadId);
    return record;
  } catch (error) {
    // Headless / engine-unavailable fallback: fetch the archive directly.
    console.warn("[emulators] falling back to direct download:", error);
    const result = await downloadToFile(entry.url, savePath);
    await extractArchive(savePath, target);
    patchSpec(downloadId, { extracted: true });
    const now = Math.floor(Date.now() / 1000);
    return {
      id: downloadId,
      kind: "direct",
      name: fileName,
      sourceUri: entry.url,
      savePath,
      downloaded: result.bytes,
      totalSize: result.bytes,
      progress: 1,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      status: { kind: "completed" },
      gameId: null,
      sourceName: "Emulator",
      addedAt: now,
      completedAt: now,
      files: [
        { name: fileName, size: result.bytes, downloaded: result.bytes, progress: 1, selected: true },
      ],
      autoExtract: true,
      extracted: true,
    };
  }
}
