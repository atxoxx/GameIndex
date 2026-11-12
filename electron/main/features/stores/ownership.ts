/**
 * Cross-store ownership verification.
 *
 * Port of `src-tauri/src/store_checker.rs`. The Rust struct lived in memory;
 * this port persists the two ownership sets so the DownloadModal's "you own
 * this" pills are correct on the first paint after a restart (the renderer
 * only re-pushes them after a successful sync).
 *
 * Matching strategy is unchanged:
 *   1. local library — exact normalized match, then (query ≥ 4 chars) a
 *      substring match capped at one hit;
 *   2. Steam / Epic — exact store id only. Name-based ownership is never
 *      fabricated; the row explains that the id is needed instead.
 */
import { createSqliteStore } from "../../state/sqliteStore";

export interface StoreOwnership {
  store: string;
  owned: boolean;
  storeGameId: string | null;
  details: string | null;
}

export interface OwnershipResult {
  gameName: string;
  ownedStores: StoreOwnership[];
  isOwnedAnywhere: boolean;
}

interface OwnershipDocument {
  version: number;
  steamAppIds: number[];
  epicOwnedIds: string[];
  updatedAt: string;
}

const ownershipStore = createSqliteStore<OwnershipDocument>({
  domain: "kv",
  document: "store-ownership",
  createDefault: () => ({
    version: 1,
    steamAppIds: [],
    epicOwnedIds: [],
    updatedAt: new Date().toISOString(),
  }),
  normalize: (value) => ({
    version: 1,
    steamAppIds: Array.isArray(value.steamAppIds)
      ? value.steamAppIds.map(Number).filter((id) => Number.isFinite(id))
      : [],
    epicOwnedIds: Array.isArray(value.epicOwnedIds)
      ? value.epicOwnedIds.filter((id): id is string => typeof id === "string")
      : [],
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  }),
});

function steamSet(): Set<number> {
  return new Set(ownershipStore.read().steamAppIds);
}

function epicSet(): Set<string> {
  return new Set(ownershipStore.read().epicOwnedIds);
}

export function setSteamOwned(appIds: number[]): void {
  const unique = [...new Set(appIds.map((id) => Math.trunc(id)))].filter(
    (id) => Number.isFinite(id) && id > 0,
  );
  ownershipStore.update((current) => ({
    ...current,
    steamAppIds: unique,
    updatedAt: new Date().toISOString(),
  }));
}

export function setEpicOwned(ids: string[]): void {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
  ownershipStore.update((current) => ({
    ...current,
    epicOwnedIds: unique,
    updatedAt: new Date().toISOString(),
  }));
}

export function ownedSteamAppIds(): number[] {
  return [...steamSet()];
}

export function ownedEpicIds(): string[] {
  return [...epicSet()];
}

export function isSteamOwned(appId: number): boolean {
  return steamSet().has(appId);
}

export function isEpicOwned(id: string): boolean {
  return epicSet().has(id);
}

/** Normalize a title for comparison: lowercase, alphanumerics only. */
export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function localMatch(
  query: string,
  localLibraryNames: string[],
  original: string,
): StoreOwnership {
  const normalizedQuery = normalizeTitle(query);
  if (!normalizedQuery) {
    return { store: "Local", owned: false, storeGameId: null, details: null };
  }

  for (const name of localLibraryNames) {
    if (normalizeTitle(name) === normalizedQuery) {
      return {
        store: "Local",
        owned: true,
        storeGameId: null,
        details: "In library",
      };
    }
  }

  if (normalizedQuery.length >= 4) {
    for (const name of localLibraryNames) {
      const normalizedName = normalizeTitle(name);
      if (!normalizedName) continue;
      if (
        normalizedName.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedName)
      ) {
        return {
          store: "Local",
          owned: true,
          storeGameId: null,
          details: `Fuzzy match: "${name}"`,
        };
      }
    }
  }

  void original;
  return { store: "Local", owned: false, storeGameId: null, details: null };
}

function steamRow(gameName: string): StoreOwnership {
  return {
    store: "Steam",
    owned: false,
    storeGameId: null,
    details: `Need Steam appid to confirm ownership of "${gameName}"`,
  };
}

function epicRow(gameName: string): StoreOwnership {
  return {
    store: "Epic",
    owned: false,
    storeGameId: null,
    details: `Need Epic catalog id to confirm ownership of "${gameName}"`,
  };
}

export function checkOwnership(
  gameName: string,
  localLibraryNames: string[],
): OwnershipResult {
  const ownedStores: StoreOwnership[] = [
    localMatch(gameName, localLibraryNames, gameName),
    steamRow(gameName),
    epicRow(gameName),
  ];
  return {
    gameName,
    ownedStores,
    isOwnedAnywhere: ownedStores.some((row) => row.owned),
  };
}

export function checkOwnershipForIds(
  gameName: string,
  localLibraryNames: string[],
  steamAppId: number | null,
  epicOwnedId: string | null,
): OwnershipResult {
  const result = checkOwnership(gameName, localLibraryNames);

  if (steamAppId !== null && Number.isFinite(steamAppId)) {
    const row = result.ownedStores.find((entry) => entry.store === "Steam");
    if (row) {
      const owned = isSteamOwned(Math.trunc(steamAppId));
      row.owned = owned;
      row.storeGameId = String(Math.trunc(steamAppId));
      row.details = owned ? "Owned on Steam" : "Not on Steam";
    }
  }

  if (epicOwnedId) {
    const row = result.ownedStores.find((entry) => entry.store === "Epic");
    if (row) {
      const owned = isEpicOwned(epicOwnedId);
      row.owned = owned;
      row.storeGameId = epicOwnedId;
      row.details = owned ? "Owned on Epic" : "Not on Epic";
    }
  }

  result.isOwnedAnywhere = result.ownedStores.some((entry) => entry.owned);
  return result;
}
