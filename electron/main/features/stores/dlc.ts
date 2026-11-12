/**
 * Steam DLC browser.
 *
 * Port of `src-tauri/src/steam/dlc.rs`. The store page supplies the DLC list
 * (names, prices, artwork); local state supplies ownership and installation:
 *   • installed DLC ids come from the base game's `appmanifest` depots;
 *   • ownership comes from the persisted `set_steam_owned` set, plus explicit
 *     user overrides (`steam_toggle_dlc_owned`);
 *   • the watchlist is user-only.
 *
 * Manual overrides and the watchlist live in `steam-dlc.json`. The store
 * response is cached in memory for 6 hours; a store outage falls back to the
 * stale blob so the tab still renders.
 */
import { createSqliteStore } from "../../state/sqliteStore";
import type {
  SteamDlcItem,
  SteamFamilyShareInfo,
  SteamGameDlcsResult,
} from "../../../../src/types/steam";
import { fetchSteamAppDetails } from "./steamApi";
import { isSteamOwned } from "./ownership";
import { steamManifestFor } from "./steam";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_DLCS = 60;
const FETCH_CONCURRENCY = 4;

interface DlcState {
  version: number;
  /** appid → explicit owned override. */
  owned: Record<string, boolean>;
  /** appids on the watchlist. */
  watched: number[];
}

const dlcStore = createSqliteStore<DlcState>({
  domain: "kv",
  document: "steam-dlc",
  createDefault: () => ({ version: 1, owned: {}, watched: [] }),
  normalize: (value) => ({
    version: 1,
    owned: value.owned && typeof value.owned === "object" ? value.owned : {},
    watched: Array.isArray(value.watched)
      ? value.watched.map(Number).filter((id) => Number.isFinite(id))
      : [],
  }),
});

interface CacheEntry {
  at: number;
  dlcs: SteamDlcItem[];
  totalAvailable: number;
}

const cache = new Map<string, CacheEntry>();

function fallbackItem(dlcId: number): SteamDlcItem {
  return {
    appId: dlcId,
    name: `DLC #${dlcId}`,
    headerImage: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${dlcId}/header.jpg`,
    isFree: false,
    isOwned: false,
    isInstalled: false,
    isWatched: false,
  };
}

async function fetchDlcItem(dlcId: number, lang: string): Promise<SteamDlcItem> {
  const details = await fetchSteamAppDetails(dlcId, lang);
  if (!details) return fallbackItem(dlcId);
  const price = details.price_overview;
  return {
    appId: dlcId,
    name: details.name ?? `DLC #${dlcId}`,
    headerImage:
      details.header_image ??
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${dlcId}/header.jpg`,
    priceFormatted: price?.final_formatted,
    initialPriceFormatted: price?.initial_formatted,
    discountPercent: price?.discount_percent,
    finalPriceCents: price?.final,
    initialPriceCents: price?.initial,
    isFree: details.is_free === true || price?.final === 0,
    releaseDate: details.release_date?.date,
    shortDescription: details.short_description,
    isOwned: false,
    isInstalled: false,
    isWatched: false,
  };
}

async function fetchDlcItems(
  ids: number[],
  lang: string,
): Promise<SteamDlcItem[]> {
  const out: SteamDlcItem[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= ids.length) return;
      out[index] = await fetchDlcItem(ids[index], lang);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) }, () => worker()),
  );
  return out.filter((item): item is SteamDlcItem => Boolean(item));
}

export async function getGameDlcs(
  appId: number,
  lang: string,
  forceRefresh: boolean,
): Promise<SteamGameDlcsResult> {
  const cacheKey = `${appId}:${lang}`;
  const cached = cache.get(cacheKey);
  const isFresh = cached && Date.now() - cached.at < CACHE_TTL_MS;

  let dlcs: SteamDlcItem[];
  let totalAvailable = 0;

  if (cached && isFresh && !forceRefresh) {
    dlcs = cached.dlcs.map((item) => ({ ...item }));
    totalAvailable = cached.totalAvailable;
  } else {
    const base = await fetchSteamAppDetails(appId, lang);
    const ids = (base?.dlc ?? []).slice(0, MAX_DLCS);
    totalAvailable = base?.dlc?.length ?? 0;
    dlcs = ids.length > 0 ? await fetchDlcItems(ids, lang) : [];
    cache.set(cacheKey, { at: Date.now(), dlcs, totalAvailable });
  }

  const manifest = await steamManifestFor(appId);
  const installedDlcIds = new Set(manifest?.installedDlcs ?? []);
  const baseInstalled = manifest?.fullyInstalled ?? false;
  const state = dlcStore.read();
  const watched = new Set(state.watched);

  let ownedCount = 0;
  let installedCount = 0;
  const evaluated = dlcs.map((item) => {
    const manual = state.owned[String(item.appId)];
    const owned =
      manual !== undefined
        ? manual
        : installedDlcIds.has(item.appId) ||
          isSteamOwned(item.appId) ||
          (item.isFree && baseInstalled);
    const installed =
      installedDlcIds.has(item.appId) ||
      (baseInstalled && owned) ||
      manifest?.appId === item.appId;
    if (owned) ownedCount += 1;
    if (installed) installedCount += 1;
    return {
      ...item,
      isOwned: owned,
      isInstalled: installed,
      isWatched: watched.has(item.appId),
    };
  });

  return {
    appId,
    totalDlcs: evaluated.length,
    totalAvailable,
    ownedCount,
    installedCount,
    dlcs: evaluated,
    familyShare: await familyShareInfo(appId),
  };
}

export function toggleDlcOwned(dlcAppId: number, owned: boolean): void {
  dlcStore.update((current) => ({
    ...current,
    owned: { ...current.owned, [String(dlcAppId)]: owned },
  }));
}

export function setDlcWatch(dlcAppId: number, watch: boolean): void {
  dlcStore.update((current) => {
    const watched = new Set(current.watched);
    if (watch) watched.add(dlcAppId);
    else watched.delete(dlcAppId);
    return { ...current, watched: [...watched] };
  });
}

export function markDlcsOwned(dlcAppIds: number[], owned: boolean): void {
  dlcStore.update((current) => {
    const next = { ...current.owned };
    for (const id of dlcAppIds) {
      if (Number.isFinite(id)) next[String(id)] = owned;
    }
    return { ...current, owned: next };
  });
}

/**
 * Family-share state for one app. The manifest's `LastOwner` names the owner
 * when Steam downloaded the title from a family member; without a manifest the
 * honest answer is "not shared".
 */
export async function familyShareInfo(appId: number): Promise<SteamFamilyShareInfo> {
  const manifest = await steamManifestFor(appId);
  const owner = manifest?.lastOwner;
  if (!owner || owner === "0") return { isShared: false };
  return { isShared: true, ownerSteamId: owner };
}
