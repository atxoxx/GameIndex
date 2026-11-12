/**
 * Process watcher: passive game detection + play-session lifecycle.
 *
 * Ported from `src-tauri/src/game_watcher/watcher.rs` and `poll.rs`:
 *
 *  • The library is indexed by exe path, install directory and exe stem.
 *  • Every poll takes an OS process snapshot and (a) keeps tracked sessions
 *    alive / re-attaches launcher hand-offs, (b) claims running processes that
 *    match a library entry, (c) emits the 30 s `game-progress` heartbeat.
 *  • One process = one session: a PID already claimed by a live session can
 *    never fan out into a second (passive) session.
 *
 * Poll cadence: 2 s while a launch is pending or a session is inside its loss
 * grace window, 3 s while a session runs, 15 s while nothing runs but the
 * index is populated (passive detection), and no timer at all when the index is
 * empty — nothing could match, so there is nothing to poll for.
 */
import { app } from "electron";
import { createJsonStore } from "../../state/jsonStore";
import { resolveGameExe } from "./exeResolve";
import {
  exeStemLower,
  baseNameLower,
  getGameRootDir,
  isInsideDir,
  normalizePathLower,
  trimPathSeparators,
} from "./paths";
import {
  isSkipName,
  listProcessBase,
  listProcessesDetailed,
  processNameMatches,
} from "./processes";
import {
  activeSessions,
  attachSession,
  finalizeSession,
  finalizeSessionsOnQuit,
  markSessionLost,
  markSessionRestored,
  runSessionPeriodic,
  type ActiveSession,
} from "./sessions";
import { steamGameInstallPath } from "./steam";
import type { GameRef, GameRefInput, ProcessInfo, WatcherIndexDocument } from "./types";
import { setPollWakeHandler } from "./wake";

/** Pending launch (no process yet) is abandoned after 10 minutes. */
const PENDING_SESSION_TIMEOUT_MS = 600_000;
/** Fast poll while a launch is pending or a session is in its grace window. */
const POLL_INTERVAL_FAST_MS = 2_000;
/** Steady poll while at least one session is running. */
const POLL_INTERVAL_ACTIVE_MS = 3_000;
/** Relaxed poll with no session (passive detection only). */
const POLL_INTERVAL_IDLE_MS = 15_000;
/** Grace before a missing process ends the session. */
const SESSION_LOST_GRACE_MS = 3_000;
/**
 * Longer grace for an app-launched session whose *launcher* exited before the
 * real game appeared (Steam/Uplay hand-off, splash that relaunches). The Rust
 * watcher used 3 s for every case, which could end a legitimately slow
 * hand-off; the extra window only applies to the first 20 s after attach.
 */
const LAUNCHER_HANDOFF_GRACE_MS = 30_000;

const WATCHER_VERSION = 1;

interface WatcherIndex {
  games: GameRef[];
  byPath: Map<string, GameRef[]>;
  byDir: Map<string, GameRef[]>;
  byStem: Map<string, GameRef[]>;
  /** Install dirs, longest first, for unambiguous prefix matching. */
  dirKeys: string[];
}

function emptyIndex(): WatcherIndex {
  return {
    games: [],
    byPath: new Map(),
    byDir: new Map(),
    byStem: new Map(),
    dirKeys: [],
  };
}

const indexStore = createJsonStore<WatcherIndexDocument>(
  "watcher-index.json",
  () => ({ version: WATCHER_VERSION, updatedAt: new Date().toISOString(), games: [] }),
  (doc) => {
    if (!Array.isArray(doc.games)) doc.games = [];
    doc.version = WATCHER_VERSION;
    return doc;
  },
);

let index: WatcherIndex = emptyIndex();
let timer: NodeJS.Timeout | null = null;
let polling = false;
let started = false;
let persistedIndexLoaded = false;

function addToMap<K>(map: Map<K, GameRef[]>, key: K, ref: GameRef): void {
  const list = map.get(key);
  if (list) {
    if (!list.some((entry) => entry.gameId === ref.gameId)) list.push(ref);
    return;
  }
  map.set(key, [ref]);
}

function buildIndexMaps(games: GameRef[]): WatcherIndex {
  const byPath = new Map<string, GameRef[]>();
  const byDir = new Map<string, GameRef[]>();
  const byStem = new Map<string, GameRef[]>();

  for (const game of games) {
    if (game.exePath) {
      const pathKey = normalizePathLower(game.exePath);
      addToMap(byPath, pathKey, game);
      const stem = exeStemLower(game.exePath);
      if (stem) addToMap(byStem, stem, game);
    }
    if (game.installDir) {
      const dirKey = trimPathSeparators(normalizePathLower(game.installDir));
      if (dirKey) addToMap(byDir, dirKey, game);
    }
  }

  const dirKeys = [...byDir.keys()].sort((a, b) => b.length - a.length);
  return { games, byPath, byDir, byStem, dirKeys };
}

async function mapWithLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

/**
 * Turn the renderer's library projection into watcher refs.
 *
 * Steam rows resolve their install dir (and, when the row has no exe path, an
 * exe guess) from the local manifests; every other row derives its install dir
 * from the exe path. ROM rows are dropped: every ROM of one emulator shares the
 * emulator binary, so keeping them would fan one process out into N sessions.
 */
async function buildRefs(inputs: GameRefInput[]): Promise<GameRef[]> {
  const refs: GameRef[] = [];
  const needExe: GameRef[] = [];

  for (const input of inputs) {
    if (input.emulatorId) continue;
    if (!input.gameId) continue;
    const exePath = typeof input.exePath === "string" && input.exePath.trim()
      ? input.exePath.trim()
      : null;
    let installDir = exePath ? getGameRootDir(exePath) : null;

    if (input.platform === "Steam" && input.steamAppId) {
      try {
        const steamDir = await steamGameInstallPath(input.steamAppId);
        if (steamDir) installDir = steamDir;
      } catch {
        /* no usable Steam install — keep the exe-derived dir */
      }
    }

    const ref: GameRef = {
      gameId: input.gameId,
      gameName: input.gameName ?? "",
      platform: input.platform ?? "",
      exePath,
      installDir,
      steamAppId: typeof input.steamAppId === "number" ? input.steamAppId : null,
      installed: input.installed !== false,
    };
    refs.push(ref);
    if (!ref.exePath && ref.installDir) needExe.push(ref);
  }

  // Resolve a missing exe path for at most 25 rows so a huge library cannot
  // stall the index rebuild with a full disk sweep.
  const budget = needExe.slice(0, 25);
  await mapWithLimit(budget, 4, async (ref) => {
    if (!ref.installDir) return;
    try {
      const resolved = await resolveGameExe(ref.installDir, ref.gameName);
      if (resolved) ref.exePath = resolved;
    } catch {
      /* heuristic only — no exe is a valid outcome */
    }
  });

  return refs;
}

function persistIndex(games: GameRef[]): void {
  try {
    indexStore.write({
      version: WATCHER_VERSION,
      updatedAt: new Date().toISOString(),
      games: games.map((game) => ({
        gameId: game.gameId,
        gameName: game.gameName,
        platform: game.platform,
        exePath: game.exePath,
        installDir: game.installDir,
        steamAppId: game.steamAppId,
        installed: game.installed,
      })),
    });
  } catch (error) {
    // A cache that cannot be written is not a functional failure.
    console.error("[launch] could not persist watcher index:", error);
  }
}

function loadPersistedIndex(): void {
  if (persistedIndexLoaded) return;
  persistedIndexLoaded = true;
  if (index.games.length > 0) return;
  let doc: WatcherIndexDocument;
  try {
    doc = indexStore.read();
  } catch {
    return;
  }
  const games: GameRef[] = doc.games
    .filter((game) => game && typeof game.gameId === "string" && game.gameId)
    .map((game) => ({
      gameId: game.gameId,
      gameName: typeof game.gameName === "string" ? game.gameName : "",
      platform: typeof game.platform === "string" ? game.platform : "",
      exePath: game.exePath ?? null,
      installDir: game.installDir ?? null,
      steamAppId: typeof game.steamAppId === "number" ? game.steamAppId : null,
      installed: game.installed !== false,
    }));
  if (games.length > 0) index = buildIndexMaps(games);
}

/** Rebuild the process index from the renderer's library projection. */
export async function rebuildWatcherIndex(inputs: GameRefInput[]): Promise<void> {
  const refs = await buildRefs(Array.isArray(inputs) ? inputs : []);
  index = buildIndexMaps(refs);
  persistedIndexLoaded = true;
  persistIndex(refs);
  ensureWatcherStarted();
  requestPoll(0);
}

/** Start the poll loop (idempotent). Safe to call before any index exists. */
export function ensureWatcherStarted(): void {
  if (started) return;
  started = true;
  setPollWakeHandler(() => requestPoll(0));
  loadPersistedIndex();
}

/** Stop the poll loop (app quit / diagnostics). */
export function stopWatcher(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  started = false;
  setPollWakeHandler(null);
}

/** Schedule the next poll, replacing any pending one. */
export function requestPoll(delayMs: number): void {
  ensureWatcherStarted();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pollOnce();
  }, Math.max(0, delayMs));
  timer.unref?.();
}

function nextDelayMs(): number {
  if (activeSessions.size === 0) {
    return index.games.length === 0 ? -1 : POLL_INTERVAL_IDLE_MS;
  }
  for (const session of activeSessions.values()) {
    if (session.lastPid === 0 || session.lostAt !== null) return POLL_INTERVAL_FAST_MS;
  }
  return POLL_INTERVAL_ACTIVE_MS;
}

function graceMs(session: ActiveSession): number {
  if (!session.launchedByApp) return SESSION_LOST_GRACE_MS;
  // A launcher/bootstrapper/updater exiting usually means "the game is about
  // to appear", not "the game quit": give those hand-offs a longer window.
  const exeName = baseNameLower(session.matchedExe);
  const stem = exeName.includes(".") ? exeName.slice(0, exeName.lastIndexOf(".")) : exeName;
  const looksLikeLauncher = stem !== "" && isSkipName(stem);
  return looksLikeLauncher ? LAUNCHER_HANDOFF_GRACE_MS : SESSION_LOST_GRACE_MS;
}

function largestProcess(processes: ProcessInfo[]): ProcessInfo | null {
  let best: ProcessInfo | null = null;
  for (const process of processes) {
    if (!best || process.workingSetBytes > best.workingSetBytes) best = process;
  }
  return best;
}

function parentDirectories(dir: string, levels: number): string[] {
  const parents: string[] = [];
  let current = dir;
  for (let i = 0; i < levels; i += 1) {
    const index = Math.max(current.lastIndexOf("\\"), current.lastIndexOf("/"));
    if (index <= 0) break;
    current = current.slice(0, index);
    if (!current) break;
    parents.push(trimPathSeparators(current));
  }
  return parents;
}

/**
 * Locate a still-running process for a session whose tracked PID vanished.
 *
 * Priority (mirrors `find_session_process`):
 *  1. same exe stem inside the install dir,
 *  2. any non-helper process inside the install dir (pending launches with an
 *     unknown exe, e.g. a Steam protocol hand-off into a `bin` subfolder),
 *  3. same exe stem under the install dir's parents (publisher launchers whose
 *     games live in a sibling folder),
 *  4. a live descendant of the tracked PID inside the install tree.
 */
function findSessionProcess(
  processes: ProcessInfo[],
  session: ActiveSession,
): ProcessInfo | null {
  const usable = processes.filter(
    (process) =>
      process.pid !== session.lastPid &&
      process.exePath !== "" &&
      !isSkipName(process.name),
  );

  const expectedStem = exeStemLower(session.matchedExe);
  const hasStem = expectedStem !== "" && !isSkipName(expectedStem);
  const dirNorm = session.installDir
    ? trimPathSeparators(normalizePathLower(session.installDir))
    : "";

  const insideDir = dirNorm
    ? usable.filter((process) => isInsideDir(normalizePathLower(process.exePath), dirNorm))
    : [];

  if (hasStem) {
    const stemMatches = insideDir.filter(
      (process) => exeStemLower(process.exePath) === expectedStem,
    );
    if (stemMatches.length > 0) return largestProcess(stemMatches);
  } else if (insideDir.length > 0) {
    return largestProcess(insideDir);
  }

  if (hasStem && dirNorm) {
    for (const parent of parentDirectories(dirNorm, 3)) {
      const matches = usable.filter(
        (process) =>
          exeStemLower(process.exePath) === expectedStem &&
          isInsideDir(normalizePathLower(process.exePath), parent),
      );
      if (matches.length > 0) return largestProcess(matches);
    }
  }

  if (session.lastPid > 0) {
    const descendants = new Set<number>();
    const queue = [session.lastPid];
    while (queue.length > 0) {
      const pid = queue.shift() as number;
      for (const process of processes) {
        if (process.ppid !== pid || descendants.has(process.pid)) continue;
        descendants.add(process.pid);
        queue.push(process.pid);
      }
    }
    const handoff = usable.filter(
      (process) =>
        descendants.has(process.pid) &&
        (!dirNorm || isInsideDir(normalizePathLower(process.exePath), dirNorm)),
    );
    if (handoff.length > 0) return largestProcess(handoff);
  }

  return null;
}

/** Match one running process against the library index. */
function matchProcessToGame(
  process: ProcessInfo,
  tracked: Set<string>,
  claimedPids: Set<number>,
): GameRef | null {
  if (claimedPids.has(process.pid)) return null;
  const pathNorm = process.exePath ? normalizePathLower(process.exePath) : "";

  if (pathNorm) {
    const exact = (index.byPath.get(pathNorm) ?? []).find((ref) => !tracked.has(ref.gameId));
    if (exact) return exact;

    for (const dirKey of index.dirKeys) {
      if (!isInsideDir(pathNorm, dirKey)) continue;
      const match = (index.byDir.get(dirKey) ?? []).find((ref) => !tracked.has(ref.gameId));
      if (match) return match;
    }
  }

  // Weak fallback: name-only match for a game with no install dir at all.
  // Requires an unambiguous stem so two different games can never collide.
  const stem = exeStemLower(process.exePath || process.name);
  if (!stem) return null;
  const sameStem = index.byStem.get(stem) ?? [];
  const candidate = sameStem.filter((ref) => !tracked.has(ref.gameId));
  if (candidate.length !== 1) return null;
  if (candidate[0].installDir) return null;
  return candidate[0];
}

function startPassiveSession(ref: GameRef, process: ProcessInfo): void {
  if (activeSessions.has(ref.gameId)) return;
  const session: ActiveSession = {
    gameId: ref.gameId,
    gameName: ref.gameName,
    platform: ref.platform,
    startedAtMs: Date.now(),
    attachedAtMs: 0,
    lastPid: 0,
    matchedExe: process.exePath || ref.exePath || "",
    installDir: ref.installDir,
    launchedByApp: false,
    lostAt: null,
    postExitScript: null,
    sessionRowId: null,
    metrics: null,
    lastSampleAt: 0,
    lastHeartbeatAt: 0,
    lastWorkingSetBytes: 0,
  };
  activeSessions.set(ref.gameId, session);
  attachSession(session, process);
}

async function trackSessions(base: ProcessInfo[]): Promise<void> {
  if (activeSessions.size === 0) return;
  const byPid = new Map(base.map((process) => [process.pid, process]));
  let detailed: ProcessInfo[] | null = null;
  const detailedSnapshot = async (): Promise<ProcessInfo[]> => {
    if (!detailed) detailed = await listProcessesDetailed();
    return detailed;
  };

  for (const session of [...activeSessions.values()]) {
    if (activeSessions.get(session.gameId) !== session) continue;

    const tracked = session.lastPid > 0 ? byPid.get(session.lastPid) : undefined;
    if (tracked && processNameMatches(tracked, session.matchedExe)) {
      if (tracked.workingSetBytes > 0) session.lastWorkingSetBytes = tracked.workingSetBytes;
      markSessionRestored(session);
      continue;
    }

    // The tracked process is gone (or never existed): look for the real game.
    const processes = await detailedSnapshot();
    const found = findSessionProcess(processes, session);
    if (found) {
      markSessionRestored(session);
      attachSession(session, found);
      continue;
    }

    if (session.lastPid === 0 || session.attachedAtMs === 0) {
      // Pending launch that never produced a process.
      if (Date.now() - session.startedAtMs > PENDING_SESSION_TIMEOUT_MS) {
        console.warn(
          `[launch] ${session.gameName} pending launch timed out after ${
            PENDING_SESSION_TIMEOUT_MS / 60_000
          } min.`,
        );
        await finalizeSession(session.gameId);
      }
      continue;
    }

    if (session.lostAt === null) {
      markSessionLost(session);
    } else if (Date.now() - session.lostAt > graceMs(session)) {
      await finalizeSession(session.gameId);
    }
  }
}

async function detectPassiveGames(base: ProcessInfo[]): Promise<void> {
  if (index.games.length === 0) return;

  const tracked = new Set(activeSessions.keys());
  const claimedPids = new Set<number>();
  for (const session of activeSessions.values()) {
    if (session.lastPid > 0) claimedPids.add(session.lastPid);
  }

  const candidates: ProcessInfo[] = [];
  for (const process of base) {
    if (claimedPids.has(process.pid)) continue;
    if (isSkipName(process.name)) continue;
    const stem = exeStemLower(process.name);
    if (!stem) continue;
    const refs = index.byStem.get(stem);
    if (!refs || refs.length === 0) continue;
    if (refs.every((ref) => tracked.has(ref.gameId))) continue;
    candidates.push(process);
  }
  if (candidates.length === 0) return;

  const detailed = await listProcessesDetailed();
  const byPid = new Map(detailed.map((process) => [process.pid, process]));

  for (const candidate of candidates) {
    const info = byPid.get(candidate.pid) ?? candidate;
    const match = matchProcessToGame(info, tracked, claimedPids);
    if (!match) continue;
    if (activeSessions.has(match.gameId)) continue;
    startPassiveSession(match, info);
    tracked.add(match.gameId);
    claimedPids.add(info.pid);
  }
}

/** Run exactly one poll cycle. */
export async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    ensureWatcherStarted();
    loadPersistedIndex();
    const base = await listProcessBase();
    await trackSessions(base);
    await detectPassiveGames(base);
    runSessionPeriodic(
      (session) => activeSessions.get(session.gameId)?.lastWorkingSetBytes ?? null,
    );
  } catch (error) {
    console.error("[launch] watcher poll failed:", error);
  } finally {
    polling = false;
    const delay = nextDelayMs();
    if (delay < 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return;
    }
    requestPoll(delay);
  }
}

/** Snapshot of the current index, for diagnostics/tests. */
export function watcherSnapshot(): {
  games: GameRef[];
  active: ActiveSession[];
} {
  return { games: [...index.games], active: [...activeSessions.values()] };
}

let lifecycleInstalled = false;

/**
 * Quit wiring: stop polling and close any still-open session row so a game
 * running when the app exits does not leave an unterminated session.
 */
export function installLaunchLifecycle(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  app.on("before-quit", () => {
    stopWatcher();
    finalizeSessionsOnQuit();
  });
}
