import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import { toWatcherRefs } from "./useWatcherIndex";

/** Fingerprint of the last ref set successfully handed to the Rust
 *  watcher index; `null` until the first push. */
let lastSentFingerprint: string | null = null;

/**
 * Stable fingerprint over just the fields the Rust watcher matches on.
 * Any change here — a new exe path, Steam app id, platform — must trigger
 * a rebuild; name/artwork/metadata changes must not.
 */
export function watcherFingerprint(refs: ReturnType<typeof toWatcherRefs>): string {
  return refs
    .map((r) =>
      [r.gameId, r.exePath, r.steamAppId ?? "", r.platform, r.emulatorId ?? "", r.gameName].join(
        "\u0001"
      )
    )
    .join("\u0002");
}

/**
 * Push the watcher process index, but only when the matching refs actually
 * changed. `rebuild_watcher_index` re-reads every Steam manifest on the
 * Rust side, and metadata enrichment fires rebuilds constantly without
 * touching any of the matched fields, so dedupe on the fingerprint here.
 *
 * The fingerprint is recorded before the invoke resolves so concurrent
 * calls with the same refs coalesce. A rejected push clears it again, so
 * the next call re-pushes that same set — nothing else ever writes the
 * Rust index, so a transient failure would otherwise leave it stale until
 * a matched field changes or the app restarts. There is no retry timer;
 * the function only runs when a mutation or mount calls it.
 */
export function syncWatcherIndex(games: Game[], untrackedIds?: Set<string>): void {
  const refs = toWatcherRefs(games, untrackedIds);
  const fingerprint = watcherFingerprint(refs);
  if (fingerprint === lastSentFingerprint) return;

  lastSentFingerprint = fingerprint;
  invoke("rebuild_watcher_index", { games: refs }).catch((err) => {
    lastSentFingerprint = null;
    console.error("Failed to rebuild watcher index:", err);
  });
}
