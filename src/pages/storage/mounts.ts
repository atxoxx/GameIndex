// Mount-table cache for the Storage tab.
//
// The Rust `resolve_mounts` command returns, per path, the real
// filesystem that hosts it (mount point + capacity). Components resolve
// drive labels synchronously via `driveOf()` / `mountPointOf()`, so the
// results are cached in module scope and a `useSyncExternalStore`
// subscription re-renders subscribers once the async lookup lands.
//
// This is what keeps `/run/media/<user>/diskA` and `/run/media/<user>/diskB`
// apart on Linux: the old prefix heuristic collapsed them into one bucket.

import { useSyncExternalStore } from "react";

/** One path resolved to its owning filesystem (mirrors `size::MountUsage`). */
export interface MountUsage {
  path: string;
  mountPoint: string;
  device: string;
  fileSystem: string;
  total: number;
  free: number;
  available: number;
}

let mounts: MountUsage[] = [];
let version = 0;
const listeners = new Set<() => void>();

/** Replace the cached mount table and notify subscribers. Sorted so the
 *  longest mount point wins the prefix check. */
export function publishMounts(next: MountUsage[]): void {
  mounts = [...next]
    .filter((m) => !!m.mountPoint)
    .sort((a, b) => b.mountPoint.length - a.mountPoint.length);
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/** Re-render the caller when the mount table changes. */
export function useMountVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Longest mount-point prefix that contains `path`, or null while the
 *  mount table hasn't been resolved yet. */
export function mountPointOf(path: string | undefined | null): string | null {
  if (!path || mounts.length === 0) return null;
  const target = normalize(path);
  for (const m of mounts) {
    const raw = normalize(m.mountPoint);
    const prefix = raw === "" ? "/" : raw;
    if (prefix === "/" || target === prefix || target.startsWith(`${prefix}/`)) {
      return m.mountPoint;
    }
  }
  return null;
}
