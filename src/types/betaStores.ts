/**
 * TypeScript types for the beta store integrations — Battle.net, EA app,
 * Xbox / Microsoft Store and itch.io.
 *
 * These mirror the Rust DTOs in `src-tauri/src/beta_stores/types.rs`.
 * Field names stay camelCase end-to-end because the Rust structs use
 * `#[serde(rename_all = "camelCase")]`.
 *
 * All four stores share one wire shape: only the string key and the
 * display platform differ.
 */

/** Store key — also the IPC command prefix (`<key>_start_login`, …). */
export type BetaStoreKey = "battlenet" | "ea" | "xbox" | "itch";

/** Persistent login marker returned by `<key>_start_login`. */
export interface BetaSession {
  /** Display name when the store exposes one (best-effort). */
  username: string;
  /** Unix seconds at which login completed. */
  loggedInAt: number;
  /** Always true for the beta stores. */
  beta?: boolean;
}

/** Public auth state shape surfaced to the Settings UI. */
export interface BetaAuthState {
  isAuthenticated: boolean;
  username?: string;
  /** Unix seconds of the last successful sync. */
  lastSync?: number;
}

/** User-toggleable settings — mirrors the Rust `BetaSettings` blob. */
export interface BetaSettings {
  /** Master switch — when false, sync imports nothing. */
  connectAccount: boolean;
  /** Import titles detected as installed on this PC. */
  importInstalledGames: boolean;
  /** Import the full owned library, including uninstalled titles. */
  importUninstalledGames: boolean;
}

/** Single synced game entry handed to `addGames(...)`. */
export interface BetaSyncedGame {
  /** Prefixed, persisted game id (`battlenet-…`, `ea-…`, `xbox-…`, `itch-…`). */
  id: string;
  title: string;
  storeGameId?: string;
  isInstalled: boolean;
  installPath?: string;
  coverUrl?: string;
  playtimeMinutes?: number;
  lastPlayed?: number;
}

/** Result of a beta store library sync. */
export interface BetaSyncResult {
  success: boolean;
  gamesImported: number;
  gamesSkipped: number;
  errors: string[];
  lastSync: number;
  syncedGames: BetaSyncedGame[];
  /** Non-fatal caveat shown under the result banner (e.g. installed-only). */
  note?: string;
}
