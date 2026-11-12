/**
 * Local install scan orchestrator.
 *
 * Runs every store scanner with bounded parallelism, isolates failures (one
 * broken store never hides another store's results) and supports cancellation
 * through an `AbortSignal`. No scanner walks a drive root recursively; each
 * one only opens the known store folders/files listed in its module.
 */
import type { DetectedInstall, ScanReport, StoreId, StoreScanResult } from "./types";
import { scanSteam } from "./steam";
import { scanEpic } from "./epic";
import { scanGog } from "./gog";
import { scanUplay } from "./uplay";
import { scanRockstar } from "./rockstar";
import { scanBattlenet, scanEa, scanHumble, scanItch, scanXbox } from "./misc";

type Scanner = () => Promise<StoreScanResult>;

const SCANNERS: Array<{ store: StoreId; run: Scanner }> = [
  { store: "steam", run: scanSteam },
  { store: "epic", run: scanEpic },
  { store: "gog", run: scanGog },
  { store: "uplay", run: scanUplay },
  { store: "rockstar", run: scanRockstar },
  { store: "ea", run: scanEa },
  { store: "battlenet", run: scanBattlenet },
  { store: "itch", run: scanItch },
  { store: "xbox", run: scanXbox },
  { store: "humble", run: scanHumble },
];

const MAX_CONCURRENT = 3;

function emptyResult(store: StoreId, error: string): StoreScanResult {
  return { store, available: false, installs: [], probed: [], errors: [error] };
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** Restrict the scan to some stores (defaults to every scanner). */
  stores?: StoreId[];
}

/** Run every scanner and merge the install list (deduped by store + id). */
export async function scanLocalInstalls(
  options: ScanOptions = {},
): Promise<ScanReport> {
  const startedAt = Date.now();
  const selected = SCANNERS.filter(
    (entry) => !options.stores || options.stores.includes(entry.store),
  );
  const results = new Array<StoreScanResult>(selected.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= selected.length) return;
      if (options.signal?.aborted) {
        results[index] = emptyResult(selected[index].store, "cancelled");
        continue;
      }
      try {
        results[index] = await selected[index].run();
      } catch (error) {
        results[index] = emptyResult(
          selected[index].store,
          `${selected[index].store}: scan failed (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
      // Cancellation checkpoint between stores: scanners themselves are
      // bounded, so this is enough to make the whole scan abandonable.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT, selected.length) }, () => worker()),
  );

  const byKey = new Map<string, DetectedInstall>();
  for (const result of results) {
    for (const install of result.installs) {
      const key = `${install.store}:${install.storeId}`.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, install);
    }
  }

  return {
    startedAt,
    finishedAt: Date.now(),
    stores: results,
    installs: [...byKey.values()],
  };
}

/** Installed games grouped by store, for the settings tiles. */
export function countByStore(report: ScanReport): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const store of report.stores) counts[store.store] = store.installs.length;
  return counts;
}
