/**
 * gameAccentCache — durable persistence for extracted game palettes.
 *
 * Decoding + median-cutting a cover costs a canvas round-trip; persisting the
 * finished palette keyed by artwork URL means a revisit (or an app restart
 * with the same game still running) applies the accent on first paint without
 * re-decoding the image. The in-memory URL cache in `useGameAccent` is the
 * hot path — this is the durable layer beneath it.
 */

/** Structural match of `GameAccentPalette` kept local to avoid an import
 *  cycle with the hook. */
export interface CachedGameAccent {
  primary: string;
  secondary: string;
  deep: string;
}

interface CacheEntry extends CachedGameAccent {
  /** Unix-ms stamp, used to evict the oldest entries first. */
  ts: number;
}

const LS_KEY = "gamelib.accent_palette_cache";
const MAX_ENTRIES = 100;

function readRaw(): Record<string, CacheEntry> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // Private-browsing throws, and a hand-edited/corrupt blob must not
    // crash the hook — treat both as an empty cache.
    return null;
  }
}

function writeRaw(entries: Record<string, CacheEntry>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    /* storage full / unavailable → skip persisting */
  }
}

function isValidEntry(entry: unknown): entry is CacheEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.primary === "string" &&
    typeof e.secondary === "string" &&
    typeof e.deep === "string" &&
    typeof e.ts === "number"
  );
}

/** Read a persisted palette for an artwork URL, or `null` when absent. */
export function readCachedGameAccent(url: string): CachedGameAccent | null {
  if (!url) return null;
  const entries = readRaw();
  if (!entries) return null;
  const entry = entries[url];
  if (!isValidEntry(entry)) return null;
  return { primary: entry.primary, secondary: entry.secondary, deep: entry.deep };
}

/** Persist a palette for an artwork URL, dropping the oldest entries when
 *  the cache exceeds its cap so the storage blob stays bounded. */
export function writeCachedGameAccent(
  url: string,
  palette: CachedGameAccent
): void {
  if (!url) return;
  const entries = readRaw() ?? {};
  entries[url] = { ...palette, ts: Date.now() };

  const keys = Object.keys(entries);
  if (keys.length > MAX_ENTRIES) {
    // Drop oldest-first until back at the cap.
    const sorted = keys.sort(
      (a, b) => (entries[a]?.ts ?? 0) - (entries[b]?.ts ?? 0)
    );
    for (let i = 0; i < sorted.length - MAX_ENTRIES; i++) {
      delete entries[sorted[i]];
    }
  }

  writeRaw(entries);
}