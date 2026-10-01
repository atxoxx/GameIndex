// Derived per-source reliability from the persistent download ledger.
//
// `DownloadContext.history` already records every finished or removed
// download with its `sourceName`, final `status`, and peak speed, so we
// can compute a success rate without any new storage. Small samples are
// treated as unknown rather than reported as a misleading percentage.

import {
  isCompletedStatus,
  isErrorStatus,
  type DownloadHistory,
} from "../../types/download";

/** Below this many recorded attempts a source has no meaningful rate. */
export const MIN_RELIABILITY_SAMPLE = 3;

export interface SourceReliability {
  /** Display name of the source (first spelling seen). */
  sourceName: string;
  /** Total recorded attempts. */
  total: number;
  completed: number;
  failed: number;
  removed: number;
  /** completed / (completed + failed + removed), 0–1. */
  successRate: number;
  /** Average peak download speed across completed downloads (bytes/s). */
  avgPeakSpeed: number;
  /** Most recent attempt (unix seconds). */
  lastUsed: number;
}

interface Accumulator extends SourceReliability {
  speedSum: number;
  speedSamples: number;
}

function keyFor(sourceName: string): string {
  return sourceName.trim().toLowerCase();
}

/**
 * Aggregate reliability per source. Keyed by the lower-cased, trimmed
 * source name so casing/whitespace drift doesn't split a source.
 */
export function computeSourceReliability(
  history: DownloadHistory[],
): Map<string, SourceReliability> {
  const byKey = new Map<string, Accumulator>();

  for (const row of history) {
    const name = (row.sourceName ?? "").trim();
    if (!name) continue;
    const key = keyFor(name);
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        sourceName: name,
        total: 0,
        completed: 0,
        failed: 0,
        removed: 0,
        successRate: 0,
        avgPeakSpeed: 0,
        lastUsed: 0,
        speedSum: 0,
        speedSamples: 0,
      };
      byKey.set(key, acc);
    }

    acc.total += 1;
    if (isCompletedStatus(row.status)) {
      acc.completed += 1;
      if (row.peakSpeed > 0) {
        acc.speedSum += row.peakSpeed;
        acc.speedSamples += 1;
      }
    } else if (isErrorStatus(row.status)) {
      acc.failed += 1;
    } else if (row.status.kind === "removed") {
      acc.removed += 1;
    }

    const when = row.completedAt ?? row.addedAt ?? 0;
    if (when > acc.lastUsed) acc.lastUsed = when;
  }

  const out = new Map<string, SourceReliability>();
  for (const [key, acc] of byKey) {
    const attempts = acc.completed + acc.failed + acc.removed;
    const successRate = attempts > 0 ? acc.completed / attempts : 0;
    out.set(key, {
      sourceName: acc.sourceName,
      total: acc.total,
      completed: acc.completed,
      failed: acc.failed,
      removed: acc.removed,
      successRate,
      avgPeakSpeed: acc.speedSamples > 0 ? acc.speedSum / acc.speedSamples : 0,
      lastUsed: acc.lastUsed,
    });
  }
  return out;
}

/** Look up a source's reliability, ignoring case/whitespace. */
export function getSourceReliability(
  map: Map<string, SourceReliability>,
  sourceName: string,
): SourceReliability | undefined {
  return map.get(keyFor(sourceName));
}

/** True when the sample is large enough to display a rate. */
export function hasReliabilitySample(
  reliability: SourceReliability | undefined,
): reliability is SourceReliability {
  return !!reliability && reliability.total >= MIN_RELIABILITY_SAMPLE;
}
