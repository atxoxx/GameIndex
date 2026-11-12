/**
 * Shared shapes for the store-integration workstream.
 *
 * Everything here is main-process only: the renderer never sees these
 * interfaces directly. Commands translate them into the exact DTOs the React
 * call sites expect (see `commands/stores.ts`).
 */

/** Stores this workstream can read locally (no account required). */
export type StoreId =
  | "steam"
  | "epic"
  | "gog"
  | "uplay"
  | "rockstar"
  | "ea"
  | "battlenet"
  | "itch"
  | "xbox"
  | "humble";

/** Player-facing platform label stored on `Game.platform`. */
export const STORE_PLATFORMS: Record<StoreId, string> = {
  steam: "Steam",
  epic: "Epic",
  gog: "GOG",
  uplay: "Ubisoft Connect",
  rockstar: "Rockstar",
  ea: "EA",
  battlenet: "Battle.net",
  itch: "itch.io",
  xbox: "Xbox",
  humble: "Humble",
};

/** One game installation discovered on disk. */
export interface DetectedInstall {
  store: StoreId;
  /** Store-scoped identity: Steam appid, GOG product id, Epic app name, … */
  storeId: string;
  name: string;
  /** Absolute install directory, when the store records one. */
  installDir: string | null;
  /** Absolute launchable executable, when one could be resolved. */
  exePath: string | null;
  /** Install size in bytes, read from the store manifest when it exposes one. */
  sizeBytes?: number;
  /** Epic catalog namespace (also used to build the game id). */
  namespace?: string;
  /** Epic catalog item id. */
  catalogItemId?: string;
  /** True when the store reports the install as settled/playable. */
  installed: boolean;
  /** Extra store-specific identifiers persisted on the Game row. */
  extra?: Record<string, string | number | boolean | undefined>;
}

/** What one scanner found, including what it probed (for diagnostics). */
export interface StoreScanResult {
  store: StoreId;
  /** True when the store's local data source exists on this machine. */
  available: boolean;
  installs: DetectedInstall[];
  /** Paths/registry keys the scanner looked at, in probe order. */
  probed: string[];
  errors: string[];
}

export interface ScanReport {
  startedAt: number;
  finishedAt: number;
  stores: StoreScanResult[];
  /** Every installed game across every store, de-duplicated by store id. */
  installs: DetectedInstall[];
}

export interface ImportSummary {
  created: number;
  updated: number;
  unchanged: number;
  /** Ids of rows created or updated (for the scan report). */
  ids: string[];
}

/** Command argument helpers shared by every store command. */
export function argString(
  args: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return "";
}

export function argNumber(
  args: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = args[key];
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function argBool(
  args: Record<string, unknown>,
  ...keys: string[]
): boolean | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

export function argStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function argNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const n = typeof item === "number" ? item : Number(item);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
