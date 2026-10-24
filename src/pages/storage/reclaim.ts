/**
 * Types and pure helpers for the Storage page's maintenance history.
 *
 * The durable copy lives in the `kv` domain (see `src-tauri/src/storage_history.rs`)
 * — this module only shapes and summarises it, so the chart math is testable
 * without a Tauri runtime.
 */

export type ReclaimKind = "uninstall" | "delete";

export interface ReclaimEvent {
  id: string;
  /** ISO-8601 timestamp. */
  at: string;
  kind: ReclaimKind | string;
  bytes: number;
  count: number;
  /** Game name for a single removal; null for a batch. */
  label?: string | null;
}

export interface SizeSnapshot {
  at: string;
  bytes: number;
  games: number;
}

export interface StorageHistory {
  events: ReclaimEvent[];
  snapshots: SizeSnapshot[];
}

export const EMPTY_HISTORY: StorageHistory = { events: [], snapshots: [] };

const DAY_MS = 86_400_000;

function parse(iso: string | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

/** Bytes freed by every recorded removal, optionally since a cutoff. */
export function totalReclaimed(history: StorageHistory, since?: number): number {
  return history.events.reduce((sum, event) => {
    const at = parse(event.at);
    if (at == null) return sum;
    if (since != null && at < since) return sum;
    return sum + (event.bytes || 0);
  }, 0);
}

/** Start of the current calendar month, local time. */
export function startOfMonth(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** Bytes freed since the first of the current month. */
export function reclaimedThisMonth(
  history: StorageHistory,
  now: number = Date.now(),
): number {
  return totalReclaimed(history, startOfMonth(now));
}

export interface MonthlyReclaim {
  /** `YYYY-MM`, stable as a React key. */
  key: string;
  /** Localised short month label, e.g. "Aug". */
  label: string;
  bytes: number;
}

/**
 * Bytes freed per calendar month for the last `months` months, oldest first.
 * Months with no removals are present with zero so the chart keeps an even
 * rhythm instead of collapsing gaps.
 */
export function monthlyReclaim(
  history: StorageHistory,
  months = 6,
  now: number = Date.now(),
  locale?: string,
): MonthlyReclaim[] {
  const buckets: MonthlyReclaim[] = [];
  const cursor = new Date(now);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  cursor.setMonth(cursor.getMonth() - (months - 1));

  for (let i = 0; i < months; i += 1) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({
      key,
      label: cursor.toLocaleString(locale, { month: "short" }),
      bytes: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const index = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const event of history.events) {
    const at = parse(event.at);
    if (at == null) continue;
    const date = new Date(at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = index.get(key);
    if (bucket) bucket.bytes += event.bytes || 0;
  }

  return buckets;
}

export interface LibraryTrend {
  /** Signed byte change between the first and last snapshot. */
  delta: number;
  /** Share change, 0 when there is nothing to compare against. */
  deltaPct: number;
  first: SizeSnapshot | null;
  last: SizeSnapshot | null;
}

/** How much the library grew (positive) or shrank (negative) over the
 *  sampled window. */
export function libraryTrend(history: StorageHistory): LibraryTrend {
  const snapshots = history.snapshots
    .filter((snapshot) => Number.isFinite(parse(snapshot.at)))
    .slice()
    .sort((a, b) => (parse(a.at) ?? 0) - (parse(b.at) ?? 0));

  if (snapshots.length < 2) {
    return { delta: 0, deltaPct: 0, first: snapshots[0] ?? null, last: snapshots[0] ?? null };
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const delta = last.bytes - first.bytes;
  return {
    delta,
    deltaPct: first.bytes > 0 ? (delta / first.bytes) * 100 : 0,
    first,
    last,
  };
}

/** True when the newest snapshot is older than `minDays`. Drives the weekly
 *  sample the page writes on mount, so launches do not spam the table. */
export function needsSnapshot(
  history: StorageHistory,
  now: number = Date.now(),
  minDays = 7,
): boolean {
  let newest = 0;
  for (const snapshot of history.snapshots) {
    const at = parse(snapshot.at);
    if (at != null && at > newest) newest = at;
  }
  if (newest === 0) return true;
  return now - newest >= minDays * DAY_MS;
}
