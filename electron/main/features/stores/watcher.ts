/**
 * Store transfer + install-state watcher.
 *
 * Port of `src-tauri/src/store_installs/` (Steam appmanifest phase detection,
 * Epic `.item` manifests, speed/ETA tracking, throttled progress events) and
 * the `steam-install-changed` transition scan in
 * `src-tauri/src/game_watcher/steam_install.rs`.
 *
 * Cost control (straight from the Rust module):
 *   • idle cadence is slow; only an active transfer speeds the loop up;
 *   • a settled Steam manifest is re-read only when its file stamp changes;
 *   • only AppIDs the library knows are ever reported.
 *
 * Events (exact names the renderer listens for):
 *   `store-install-progress`  → StoreInstall[] snapshot, emitted on change
 *   `store-install-finished`  → { gameId, title, source }
 *   `steam-install-changed`   → { appId, installed, exePath? }
 */
import fs from "node:fs";
import path from "node:path";
import { emit } from "../../ipc";
import { listGames } from "../../state/libraryStore";
import { epicManifestsDir, parseEpicItem } from "./epic";
import { measureFolder, resolveExecutable } from "./exe";
import { steamManifestPaths, steamManifestFor } from "./steam";
import { parseAppManifest, STEAM_FLAG_FULLY_INSTALLED, STEAM_FLAG_UPDATE_PAUSED } from "./vdf";

export type InstallState = "downloading" | "installing" | "pending";

export interface StoreInstall {
  key: string;
  gameId: string;
  source: "steam" | "epic";
  appId: string;
  title: string;
  state: InstallState;
  percent: number | null;
  downloaded: number | null;
  total: number | null;
  speed: number | null;
  eta: number | null;
}

export interface FinishedInstall {
  gameId: string;
  title: string;
  source: "steam" | "epic";
}

const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 30_000;
const PENDING_GIVE_UP_MS = 120_000;
const EPIC_MEASURE_BUDGET = 4_000;

interface Target {
  gameId: string;
  title: string;
  installed: boolean;
  steamAppId?: number;
  epicNamespace?: string;
  epicCatalogItemId?: string;
}

interface Tracker {
  lastBytes: number | null;
  lastAt: number;
  rate: number;
  seeded: boolean;
  pendingSince: number | null;
}

interface SteamCacheEntry {
  mtimeMs: number;
  size: number;
  phase: Phase;
}

type Phase =
  | { kind: "downloading"; done: number; total: number }
  | { kind: "installing"; done: number; total: number }
  | { kind: "waiting" }
  | { kind: "completed" }
  | { kind: "idle" };

let latest: StoreInstall[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let started = false;

const trackers = new Map<string, Tracker>();
const steamCache = new Map<number, SteamCacheEntry>();
const previousKeys = new Set<string>();
/** AppIDs whose uninstall has already been announced. */
const missingReported = new Set<number>();

function loadTargets(): Target[] {
  return listGames().flatMap((game) => {
    const target: Target = {
      gameId: game.id,
      title: game.name,
      installed: Boolean(game.installed),
      steamAppId:
        typeof game.steamAppId === "number" && Number.isFinite(game.steamAppId)
          ? game.steamAppId
          : undefined,
      epicNamespace: game.epicNamespace,
      epicCatalogItemId: game.epicCatalogItemId,
    };
    if (target.steamAppId === undefined && !target.epicNamespace) return [];
    return [target];
  });
}

function percent(done: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(99, Math.max(0, (done / total) * 100));
}

function phaseOf(manifest: ReturnType<typeof parseAppManifest>): Phase {
  if (!manifest) return { kind: "waiting" };
  const flags = manifest.stateFlags ?? 0;
  const toDownload = manifest.bytesToDownload ?? 0;
  const downloaded = manifest.bytesDownloaded ?? 0;
  const toStage = manifest.bytesToStage ?? 0;
  const staged = manifest.bytesStaged ?? 0;

  if ((flags & STEAM_FLAG_UPDATE_PAUSED) !== 0) return { kind: "idle" };
  if (toDownload > downloaded && downloaded > 0) {
    return { kind: "downloading", done: downloaded, total: toDownload };
  }
  if (toStage > staged && staged > 0) {
    return { kind: "installing", done: staged, total: toStage };
  }
  if (
    (flags & STEAM_FLAG_FULLY_INSTALLED) !== 0 &&
    toDownload === downloaded &&
    toStage === staged
  ) {
    return { kind: "completed" };
  }
  return { kind: "waiting" };
}

interface CollectResult {
  live: StoreInstall[];
  finished: FinishedInstall[];
}

async function collectSteam(targets: Map<number, Target>): Promise<CollectResult> {
  const live: StoreInstall[] = [];
  const finished: FinishedInstall[] = [];
  const paths = await steamManifestPaths();
  if (!paths) return { live, finished };

  const seen = new Set<number>();
  for (const [appId, manifestPath] of paths) {
    const target = targets.get(appId);
    if (!target) continue;
    seen.add(appId);

    let stamp: { mtimeMs: number; size: number } | null = null;
    try {
      const stat = await fs.promises.stat(manifestPath);
      stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      continue;
    }

    const cached = steamCache.get(appId);
    const needsRead =
      !cached ||
      cached.mtimeMs !== stamp.mtimeMs ||
      cached.size !== stamp.size ||
      cached.phase.kind !== "completed";

    if (needsRead) {
      try {
        const raw = await fs.promises.readFile(manifestPath, "utf8");
        const manifest = parseAppManifest(raw, appId);
        // A half-written manifest is normal while Steam works; keep the
        // previous parse and try again next pass.
        if (manifest) steamCache.set(appId, { ...stamp, phase: phaseOf(manifest) });
      } catch {
        continue;
      }
    }

    const entry = steamCache.get(appId);
    if (!entry) continue;

    const key = `steam:${appId}`;
    const wasLive = previousKeys.has(key);

    switch (entry.phase.kind) {
      case "completed":
        if (wasLive) {
          finished.push({ gameId: target.gameId, title: target.title, source: "steam" });
        }
        break;
      case "idle":
        break;
      case "downloading":
      case "installing":
        live.push({
          key,
          gameId: target.gameId,
          source: "steam",
          appId: String(appId),
          title: target.title,
          state: entry.phase.kind,
          percent: percent(entry.phase.done, entry.phase.total),
          downloaded: entry.phase.done,
          total: entry.phase.total,
          speed: null,
          eta: null,
        });
        break;
      case "waiting":
        // An installed game with a queued-but-not-started update stays silent;
        // otherwise the manifest means a fresh install was queued.
        if (!target.installed) {
          live.push({
            key,
            gameId: target.gameId,
            source: "steam",
            appId: String(appId),
            title: target.title,
            state: "pending",
            percent: null,
            downloaded: null,
            total: null,
            speed: null,
            eta: null,
          });
        }
        break;
      default:
        break;
    }
  }

  // Drop cache entries for manifests Steam removed.
  for (const appId of [...steamCache.keys()]) {
    if (!seen.has(appId)) steamCache.delete(appId);
  }

  return { live, finished };
}

async function collectEpic(targets: Target[]): Promise<CollectResult> {
  const live: StoreInstall[] = [];
  const finished: FinishedInstall[] = [];
  const dir = epicManifestsDir();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { live, finished };
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".item")) continue;
    const file = path.join(dir, entry.name);
    let manifest: ReturnType<typeof parseEpicItem>;
    try {
      manifest = parseEpicItem(await fs.promises.readFile(file, "utf8"), file);
    } catch {
      continue;
    }
    if (!manifest || !manifest.catalogNamespace || !manifest.catalogItemId) continue;

    const target = targets.find(
      (candidate) =>
        candidate.epicNamespace === manifest.catalogNamespace &&
        candidate.epicCatalogItemId === manifest.catalogItemId,
    );
    if (!target) continue;

    const key = `epic:${manifest.appName}`;
    if (!manifest.incomplete) {
      if (previousKeys.has(key)) {
        finished.push({ gameId: target.gameId, title: target.title, source: "epic" });
      }
      continue;
    }

    const total = manifest.installSize ?? 0;
    let stagedBytes: number | null = null;
    if (manifest.stagingLocation) {
      const measured = await measureFolder(manifest.stagingLocation, EPIC_MEASURE_BUDGET);
      stagedBytes = measured && measured > 0 ? measured : null;
    }
    const installDirExists = manifest.installLocation
      ? fs.existsSync(manifest.installLocation)
      : false;

    const state: InstallState =
      stagedBytes !== null ? "downloading" : installDirExists ? "installing" : "pending";

    live.push({
      key,
      gameId: target.gameId,
      source: "epic",
      appId: manifest.appName,
      title: target.title,
      state,
      percent: stagedBytes !== null ? percent(stagedBytes, total) : null,
      downloaded: stagedBytes,
      total: total > 0 ? total : null,
      speed: null,
      eta: null,
    });
  }

  return { live, finished };
}

/** Apply speed/ETA tracking and drop transfers that never started. */
function decorate(
  live: StoreInstall[],
  now: number,
): { live: StoreInstall[]; giveUp: Set<string> } {
  const giveUp = new Set<string>();
  for (const entry of live) {
    let tracker = trackers.get(entry.key);
    if (!tracker) {
      tracker = {
        lastBytes: null,
        lastAt: now,
        rate: 0,
        seeded: false,
        pendingSince: null,
      };
      trackers.set(entry.key, tracker);
    }

    if (entry.downloaded !== null) {
      if (!tracker.seeded) {
        tracker.lastBytes = entry.downloaded;
        tracker.seeded = true;
      } else if (tracker.lastBytes !== null) {
        const elapsed = Math.max(0.001, (now - tracker.lastAt) / 1000);
        const delta = entry.downloaded - tracker.lastBytes;
        if (delta >= 0) {
          const sample = delta / elapsed;
          tracker.rate = tracker.rate === 0 ? sample : tracker.rate * 0.7 + sample * 0.3;
        }
        tracker.lastBytes = entry.downloaded;
      }
    }
    tracker.lastAt = now;

    entry.speed = tracker.rate > 0 ? tracker.rate : null;
    entry.eta =
      entry.state === "downloading" &&
      entry.total !== null &&
      entry.downloaded !== null &&
      tracker.rate > 0
        ? Math.max(0, Math.round((entry.total - entry.downloaded) / tracker.rate))
        : null;

    if (entry.state === "pending") {
      tracker.pendingSince ??= now;
      if (now - tracker.pendingSince >= PENDING_GIVE_UP_MS) giveUp.add(entry.key);
    } else {
      tracker.pendingSince = null;
    }
  }
  return { live, giveUp };
}

/**
 * Steam install transitions for library games. Seeded from the library's own
 * `installed` flags, so an install/uninstall made while the app was closed is
 * announced on the first pass (Rust `reconciled_baseline`).
 */
async function detectSteamTransitions(): Promise<void> {
  const paths = await steamManifestPaths();
  if (!paths) return; // Steam absent: keep the baseline, announce nothing.

  const targets = loadTargets();
  const libraryByAppId = new Map<number, Target>();
  for (const target of targets) {
    if (target.steamAppId !== undefined) libraryByAppId.set(target.steamAppId, target);
  }

  const observed = new Map<number, boolean>();
  for (const [appId, manifestPath] of paths) {
    let fullyInstalled = true;
    try {
      const raw = await fs.promises.readFile(manifestPath, "utf8");
      const manifest = parseAppManifest(raw, appId);
      fullyInstalled = manifest ? manifest.fullyInstalled : true;
    } catch {
      fullyInstalled = true; // unreadable → assume installed (Rust behaviour)
    }
    observed.set(appId, fullyInstalled);
  }

  // Baseline: observed disk state, then the library's flags for games with no
  // manifest. A library row that says installed but whose manifest vanished is
  // exactly the closed-app uninstall this exists to catch.
  const baseline = new Map(observed);
  for (const [appId, target] of libraryByAppId) {
    if (target.installed) {
      if (!baseline.has(appId)) baseline.set(appId, true);
    } else {
      baseline.delete(appId);
    }
  }

  for (const [appId, fullyInstalled] of observed) {
    if (!fullyInstalled) continue;
    if (baseline.get(appId) === true) continue;
    if (!libraryByAppId.has(appId)) continue;
    const target = libraryByAppId.get(appId);
    if (!target) continue;
    const exePath = await resolveSteamExe(appId, target.title);
    emit("steam-install-changed", { appId, installed: true, exePath });
  }

  for (const [appId, target] of libraryByAppId) {
    if (observed.has(appId)) {
      missingReported.delete(appId);
      continue;
    }
    if (!target.installed) continue;
    if (missingReported.has(appId)) continue;
    missingReported.add(appId);
    emit("steam-install-changed", { appId, installed: false });
  }
}

async function resolveSteamExe(appId: number, title: string): Promise<string | undefined> {
  const manifest = await steamManifestFor(appId);
  if (!manifest) return undefined;
  try {
    if (!(await fs.promises.stat(manifest.installPath)).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const exe = await resolveExecutable(manifest.installPath, title || manifest.name);
  return exe ?? undefined;
}

async function pass(): Promise<void> {
  const targets = loadTargets();
  const steamTargets = new Map<number, Target>();
  for (const target of targets) {
    if (target.steamAppId !== undefined) steamTargets.set(target.steamAppId, target);
  }

  const [steam, epic] = await Promise.all([
    collectSteam(steamTargets),
    collectEpic(targets.filter((target) => target.epicNamespace)),
  ]);

  const now = Date.now();
  const combined = [...steam.live, ...epic.live];
  const { live, giveUp } = decorate(combined, now);
  const filtered = live.filter((entry) => !giveUp.has(entry.key));
  filtered.sort((a, b) => a.key.localeCompare(b.key));

  const changed =
    filtered.length !== latest.length ||
    filtered.some((entry, index) => {
      const previous = latest[index];
      return (
        !previous ||
        previous.key !== entry.key ||
        previous.state !== entry.state ||
        previous.percent !== entry.percent ||
        previous.gameId !== entry.gameId
      );
    });

  if (changed) {
    latest = filtered;
    emit("store-install-progress", filtered);
  }

  for (const finished of [...steam.finished, ...epic.finished]) {
    emit("store-install-finished", finished);
  }

  const liveKeys = new Set(filtered.map((entry) => entry.key));
  previousKeys.clear();
  for (const key of liveKeys) previousKeys.add(key);
  for (const key of [...trackers.keys()]) {
    if (!liveKeys.has(key)) trackers.delete(key);
  }

  await detectSteamTransitions();
}

async function loop(): Promise<void> {
  if (!running) return;
  timer = null;
  try {
    await pass();
  } catch (error) {
    console.error(
      "[store-installs] scan failed:",
      error instanceof Error ? error.message : error,
    );
  }
  if (!running) return;
  const delay = latest.length > 0 ? FAST_POLL_MS : SLOW_POLL_MS;
  timer = setTimeout(() => {
    void loop();
  }, delay);
  timer.unref?.();
}

/** Start the watcher (idempotent). Safe to call before the first window exists. */
export function startStoreWatchers(): void {
  if (started) return;
  started = true;
  running = true;
  // Seed the first pass off the boot path so app startup is never delayed.
  setTimeout(() => {
    void loop();
  }, 3_000).unref?.();
}

export function stopStoreWatchers(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** `store_installs_list`: current snapshot, seeds the UI on mount. */
export function storeInstallsSnapshot(): StoreInstall[] {
  return latest;
}

/** `store_installs_scan_now`: run a pass immediately. */
export function nudgeStoreInstalls(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!running) {
    running = true;
    started = true;
  }
  void loop();
}
