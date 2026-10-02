/**
 * Persistence for the map tab's manual lookup, keyed per game.
 *
 * The searched name is remembered so the lookup is restored on remount, and
 * a separate status flag remembers whether that lookup actually matched a
 * map so the detail tab's availability dot survives page changes.
 */

const NAME_PREFIX = "gamelib.map_lookup.";
const STATUS_PREFIX = "gamelib.map_lookup_status.";

export function readPersistedLookup(key: string | undefined): string | null {
  if (!key) return null;
  try {
    const value = localStorage.getItem(NAME_PREFIX + key);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function writePersistedLookup(key: string | undefined, name: string | null): void {
  if (!key) return;
  try {
    if (name && name.trim()) {
      localStorage.setItem(NAME_PREFIX + key, name.trim());
    } else {
      localStorage.removeItem(NAME_PREFIX + key);
    }
  } catch {
    // Storage unavailable — the lookup simply will not persist.
  }
}

export function readPersistedLookupFound(key: string | undefined): boolean | null {
  if (!key) return null;
  try {
    const value = localStorage.getItem(STATUS_PREFIX + key);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writePersistedLookupFound(
  key: string | undefined,
  found: boolean | null
): void {
  if (!key) return;
  try {
    if (found === null) {
      localStorage.removeItem(STATUS_PREFIX + key);
    } else {
      localStorage.setItem(STATUS_PREFIX + key, found ? "1" : "0");
    }
  } catch {
    // Storage unavailable — the status simply will not persist.
  }
}

export function sameLookupName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
