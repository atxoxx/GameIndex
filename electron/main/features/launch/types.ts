/**
 * Shared types for the launch / process-watcher workstream.
 *
 * Payload shapes are the ones the renderer listens for (see
 * `src/context/game/useLaunch.ts`, `useSessions.ts`, `ActivityContext.tsx`,
 * `src/components/Splashscreen.tsx`) and match the retired Rust structs in
 * `src-tauri/src/game_watcher/types.rs`.
 */

/** One library row projected onto what process matching needs. */
export interface GameRefInput {
  gameId: string;
  gameName: string;
  platform: string;
  exePath: string;
  steamAppId?: number | null;
  installed?: boolean;
  /** Scanned ROM rows share their emulator exe; never pass these to the index. */
  emulatorId?: string | null;
}

/** Watcher-index entry (exe + install dir pre-resolved). */
export interface GameRef {
  gameId: string;
  gameName: string;
  platform: string;
  exePath: string | null;
  installDir: string | null;
  steamAppId: number | null;
  installed: boolean;
}

/** Persisted form of the watcher index (`watcher-index.json`). */
export interface WatcherIndexDocument {
  version: number;
  updatedAt: string;
  games: Array<{
    gameId: string;
    gameName: string;
    platform: string;
    exePath: string | null;
    installDir: string | null;
    steamAppId: number | null;
    installed: boolean;
  }>;
}

/** A running OS process as the watcher sees it. */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** Image name only (`Game.exe`), never a path. */
  name: string;
  /** Full path when resolvable, `""` when the OS refused to tell us. */
  exePath: string;
  /** Working set in bytes; 0 when unknown (used only to rank candidates). */
  workingSetBytes: number;
}

export interface CompanionApp {
  path: string;
  arguments?: string | null;
  delayMs: number;
  runAsAdmin?: boolean | null;
}

export interface PostExitScript {
  script: string;
  admin: boolean;
}

// ── Event payloads (exact renderer contract) ────────────────────────
export interface GameStartedPayload {
  gameId: string;
  gameName: string;
  detectedExe?: string;
  pid: number;
}

export interface GameExitPayload {
  gameId: string;
  elapsedSeconds: number;
  finishedAt: number;
  metrics?: Record<string, unknown>;
  remainingGameName?: string;
}

export interface GameFailurePayload {
  gameId: string;
  gameName: string;
  elapsedSeconds: number;
  attached: boolean;
}

export interface GameSessionStatePayload {
  gameId: string;
  gameName: string;
}

export interface GameProgressPayload {
  gameId: string;
  gameName: string;
  elapsedSeconds: number;
}

export interface LaunchProgressPayload {
  gameId: string;
  step: string;
}
