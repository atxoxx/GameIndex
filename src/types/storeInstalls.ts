/**
 * Store-side install progress, mirroring `store_installs::StoreInstall` in
 * the Rust backend. These describe work a store client is doing right now —
 * GameIndex never owns these transfers, it only watches them.
 */

export type StoreInstallSource = "steam" | "epic";

export type StoreInstallState = "downloading" | "installing" | "pending";

export interface StoreInstall {
  /** Stable identity for the transfer: `steam:<appid>` / `epic:<app>`. */
  key: string;
  /** Library game this belongs to. */
  gameId: string;
  source: StoreInstallSource;
  appId: string;
  title: string;
  state: StoreInstallState;
  percent: number | null;
  downloaded: number | null;
  total: number | null;
  /** Bytes per second, derived from the store's own byte counter. */
  speed: number | null;
  /** Seconds remaining, when both a total and a rate are known. */
  eta: number | null;
}

export interface StoreInstallFinished {
  gameId: string;
  title: string;
  source: StoreInstallSource;
}

/** Where the user can actually pause or cancel the transfer. */
export const STORE_QUEUE_URLS: Record<StoreInstallSource, string> = {
  steam: "steam://open/downloads",
  epic: "com.epicgames.launcher://apps",
};
