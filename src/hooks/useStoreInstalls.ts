import { useMemo, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { StoreInstall, StoreInstallFinished } from "../types/storeInstalls";

/**
 * Live store-side install progress.
 *
 * A module-level store rather than a provider: the state is global, tiny
 * (a handful of entries), and read from places far apart in the tree —
 * library cards, the game hero, the downloads page. Threading a provider
 * through the documented nesting order to carry it would buy nothing, and
 * `useSyncExternalStore` gives consumers exactly the granularity they need.
 */

let snapshot: StoreInstall[] = [];
const snapshotSubs = new Set<() => void>();
const finishedSubs = new Set<(finished: StoreInstallFinished) => void>();
let wired = false;

function setSnapshot(next: StoreInstall[]) {
  snapshot = next;
  for (const cb of snapshotSubs) cb();
}

/** `invoke`/`listen` throw outside a Tauri webview (plain `npm run dev`). */
function safeListen<T>(event: string, handler: (payload: T) => void) {
  try {
    void listen<T>(event, (e) => handler(e.payload)).catch(() => {});
  } catch {
    // Browser-only preview: progress simply never arrives.
  }
}

function safeInvoke<T>(command: string): Promise<T | null> {
  try {
    return invoke<T>(command).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function wire() {
  if (wired) return;
  wired = true;

  safeListen<StoreInstall[]>("store-install-progress", (payload) => {
    setSnapshot(payload ?? []);
  });
  safeListen<StoreInstallFinished>("store-install-finished", (payload) => {
    if (!payload) return;
    for (const cb of finishedSubs) cb(payload);
  });

  // The event feed only carries changes; seed from the backend so a
  // remount (or a webview reload mid-download) paints immediately.
  void safeInvoke<StoreInstall[]>("store_installs_list").then((list) => {
    if (list) setSnapshot(list);
  });
}

function subscribe(cb: () => void) {
  wire();
  snapshotSubs.add(cb);
  return () => {
    snapshotSubs.delete(cb);
  };
}

function getSnapshot() {
  return snapshot;
}

/** Every store transfer currently in progress. */
export function useStoreInstalls(): StoreInstall[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The transfer belonging to one library game, if any. */
export function useStoreInstallFor(gameId: string | undefined): StoreInstall | null {
  const all = useStoreInstalls();
  return useMemo(() => {
    if (!gameId) return null;
    return all.find((entry) => entry.gameId === gameId) ?? null;
  }, [all, gameId]);
}

/**
 * Finish feed for the one consumer that needs to act on completion
 * (library refresh + toast). Returns an unsubscribe function.
 */
export function subscribeStoreInstallFinished(
  cb: (finished: StoreInstallFinished) => void
): () => void {
  wire();
  finishedSubs.add(cb);
  return () => {
    finishedSubs.delete(cb);
  };
}

/**
 * Ask the backend to scan now instead of waiting out its idle cadence.
 * Called right after an install hand-off so the button turns into a
 * progress bar immediately.
 */
export function nudgeStoreInstallScan(): void {
  void safeInvoke("store_installs_scan_now");
}
