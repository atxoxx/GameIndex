/**
 * Sync results for the non-Steam stores.
 *
 * These stores cannot be authenticated without a browser flow in this build
 * (GOG/Humble/Epic sign-in are WebView capture flows owned by the surfaces
 * workstream). What the local disk *can* answer — what is installed right
 * now — is returned in the exact DTO shapes the Settings tiles consume, so a
 * sync is useful today and simply reports no owned-but-uninstalled titles.
 *
 * No ownership is ever fabricated: `gamesImported` counts real installs, and
 * the auth-required commands answer with an explicit "not configured" error.
 */
import { createJsonStore } from "../../state/jsonStore";
import type { EpicSyncResult } from "../../../../src/types/epic";
import type { GogSyncResult } from "../../../../src/types/gog";
import type { HumbleSettings, HumbleSyncResult } from "../../../../src/types/humble";
import type { RockstarSyncResult } from "../../../../src/types/rockstar";
import type { UplaySettings, UplaySyncResult } from "../../../../src/types/uplay";
import { gogOwnedFromGalaxyDb, scanGog } from "./gog";
import { scanEpic } from "./epic";
import { scanHumble } from "./misc";
import { detectRockstarClient, scanRockstar } from "./rockstar";
import { detectUplayClient, scanUplay } from "./uplay";
import { unixNow } from "./types";

interface StoreSettingsDocument {
  version: number;
  uplay: UplaySettings;
  humble: HumbleSettings;
}

const settingsStore = createJsonStore<StoreSettingsDocument>(
  "store-settings.json",
  () => ({
    version: 1,
    uplay: { importInstalledGames: true, importUninstalledGames: true },
    humble: {
      connectAccount: false,
      ignoreThirdPartyStoreGames: false,
      importThirdPartyDrmFree: false,
      importGeneralLibrary: true,
      importGameExtras: false,
      importTroveGames: false,
      launchViaHumbleApp: false,
    },
  }),
  (value) => ({
    version: 1,
    uplay: {
      importInstalledGames: value.uplay?.importInstalledGames !== false,
      importUninstalledGames: value.uplay?.importUninstalledGames !== false,
    },
    humble: {
      connectAccount: value.humble?.connectAccount === true,
      ignoreThirdPartyStoreGames: value.humble?.ignoreThirdPartyStoreGames === true,
      importThirdPartyDrmFree: value.humble?.importThirdPartyDrmFree === true,
      importGeneralLibrary: value.humble?.importGeneralLibrary !== false,
      importGameExtras: value.humble?.importGameExtras === true,
      importTroveGames: value.humble?.importTroveGames === true,
      launchViaHumbleApp: value.humble?.launchViaHumbleApp === true,
    },
  }),
);

export function getUplaySettings(): UplaySettings {
  return settingsStore.read().uplay;
}

export function saveUplaySettings(settings: UplaySettings): UplaySettings {
  const normalized: UplaySettings = {
    importInstalledGames: settings?.importInstalledGames !== false,
    importUninstalledGames: settings?.importUninstalledGames !== false,
  };
  settingsStore.update((current) => ({ ...current, uplay: normalized }));
  return normalized;
}

export function getHumbleSettings(): HumbleSettings {
  return settingsStore.read().humble;
}

export function saveHumbleSettings(settings: HumbleSettings): HumbleSettings {
  const current = settingsStore.read().humble;
  const normalized: HumbleSettings = {
    connectAccount: settings?.connectAccount === true,
    ignoreThirdPartyStoreGames:
      settings?.ignoreThirdPartyStoreGames ?? current.ignoreThirdPartyStoreGames,
    importThirdPartyDrmFree:
      settings?.importThirdPartyDrmFree ?? current.importThirdPartyDrmFree,
    importGeneralLibrary: settings?.importGeneralLibrary !== false,
    importGameExtras: settings?.importGameExtras === true,
    importTroveGames: settings?.importTroveGames === true,
    launchViaHumbleApp: settings?.launchViaHumbleApp === true,
  };
  settingsStore.update((store) => ({ ...store, humble: normalized }));
  return normalized;
}

/** `gog_sync_library`: local installs (registry + Galaxy DB) with owned titles when the DB allows. */
export async function syncGogLibrary(): Promise<GogSyncResult> {
  const scan = await scanGog();
  const installedById = new Map(
    scan.installs.map((install) => [install.storeId, install] as const),
  );
  const owned = await gogOwnedFromGalaxyDb();
  const errors = [...scan.errors];

  if (!scan.available) {
    errors.push(
      "GOG is not installed on this machine — install GOG Galaxy or a GOG game, then sync again.",
    );
  }

  const syncedGames: GogSyncResult["syncedGames"] = [];
  const seen = new Set<string>();

  for (const entry of owned) {
    if (seen.has(entry.gameId)) continue;
    seen.add(entry.gameId);
    const installed = installedById.get(entry.gameId);
    syncedGames.push({
      id: `gog-${entry.gameId}`,
      title: installed?.name ?? entry.title,
      gogGameId: entry.gameId,
      isInstalled: Boolean(installed),
      installPath: installed?.exePath ?? undefined,
      installDir: installed?.installDir ?? undefined,
      sizeBytes: installed?.sizeBytes,
      sizeRootPath: installed?.installDir ?? undefined,
    });
  }

  for (const install of scan.installs) {
    if (seen.has(install.storeId)) continue;
    seen.add(install.storeId);
    syncedGames.push({
      id: `gog-${install.storeId}`,
      title: install.name,
      gogGameId: install.storeId,
      isInstalled: true,
      installPath: install.exePath ?? undefined,
      installDir: install.installDir ?? undefined,
      sizeBytes: install.sizeBytes,
      sizeRootPath: install.installDir ?? undefined,
    });
  }

  return {
    success: true,
    gamesImported: scan.installs.length,
    gamesSkipped: 0,
    errors,
    lastSync: unixNow(),
    syncedGames,
  };
}

/** `epic_sync_library`: installs recovered from Epic's `.item` manifests. */
export async function syncEpicLibrary(): Promise<EpicSyncResult> {
  const scan = await scanEpic();
  const errors = [...scan.errors];
  if (!scan.available) {
    errors.push(
      "Epic Games Launcher is not installed on this machine — install it, then sync again.",
    );
  } else if (scan.installs.length === 0) {
    errors.push(
      "No Epic game installs were found — Epic's manifests list only engine components on this machine.",
    );
  }

  return {
    success: true,
    gamesImported: scan.installs.length,
    gamesSkipped: 0,
    errors,
    lastSync: unixNow(),
    syncedGames: scan.installs.map((install) => ({
      id: `epic-${install.namespace ?? "unknown"}-${install.catalogItemId ?? install.storeId}`,
      title: install.name,
      namespace: install.namespace ?? "",
      catalogItemId: install.catalogItemId ?? "",
      isInstalled: install.installed,
      installPath: install.exePath ?? undefined,
      sizeBytes: install.sizeBytes,
      sizeRootPath: install.installDir ?? undefined,
    })),
  };
}

/** `uplay_sync_library`: registry installs + the client probe. */
export async function syncUplayLibrary(): Promise<UplaySyncResult> {
  const settings = getUplaySettings();
  const client = await detectUplayClient();
  const scan = settings.importInstalledGames ? await scanUplay() : await scanUplay();
  const errors = [...scan.errors];
  if (!client.clientInstalled) {
    errors.push(
      "Ubisoft Connect is not installed — install the client, sign in once, then sync again.",
    );
  }

  const syncedGames: UplaySyncResult["syncedGames"] = [];
  for (const install of scan.installs) {
    syncedGames.push({
      id: `uplay-${install.storeId}`,
      title: install.name,
      uplayId: install.storeId,
      isInstalled: true,
      installDir: install.installDir ?? undefined,
      sizeBytes: install.sizeBytes,
      sizeRootPath: install.installDir ?? undefined,
    });
  }

  return {
    success: true,
    gamesImported: syncedGames.length,
    gamesSkipped: 0,
    errors,
    lastSync: unixNow(),
    clientInstalled: client.clientInstalled,
    clientPath: client.clientPath,
    syncedGames,
  };
}

/** `rockstar_sync_library`: pure local scan (no cloud library exists). */
export async function syncRockstarLibrary(): Promise<RockstarSyncResult> {
  const client = await detectRockstarClient();
  const scan = await scanRockstar();
  const errors = [...scan.errors];
  if (!client.clientInstalled) {
    errors.push(
      "Rockstar Games Launcher is not installed — install it, then sync again.",
    );
  }

  return {
    success: true,
    gamesImported: scan.installs.length,
    gamesSkipped: 0,
    errors,
    lastSync: unixNow(),
    clientInstalled: client.clientInstalled,
    clientPath: client.clientPath,
    syncedGames: scan.installs.map((install) => ({
      id: `rockstar-${install.storeId}`,
      title: install.name,
      titleId: install.storeId,
      isInstalled: true,
      installPath: install.exePath ?? undefined,
      installDir: install.installDir ?? undefined,
      sizeBytes: install.sizeBytes,
      sizeRootPath: install.installDir ?? undefined,
    })),
  };
}

/** `humble_sync_library`: Humble App installs (orders need the browser flow). */
export async function syncHumbleLibrary(): Promise<HumbleSyncResult> {
  const settings = getHumbleSettings();
  const scan = await scanHumble();
  const errors = [...scan.errors];
  if (!scan.available) {
    errors.push(
      "The Humble App is not installed — install it and sign in to import your Humble library.",
    );
  }
  if (!settings.connectAccount) {
    errors.push(
      "Humble account sync is disabled in Humble settings — enable “Connect account” to import orders.",
    );
  }

  const syncedGames: HumbleSyncResult["syncedGames"] = scan.installs.map((install) => ({
    id: `humble-${install.storeId}`,
    title: install.name,
    humbleGameId: install.storeId,
    isTrove: false,
    isInstalled: true,
    installPath: install.exePath ?? undefined,
    installDir: install.installDir ?? undefined,
    sizeBytes: install.sizeBytes,
    sizeRootPath: install.installDir ?? undefined,
    isExtra: false,
  }));

  return {
    success: true,
    gamesImported: syncedGames.length,
    gamesSkipped: 0,
    errors,
    lastSync: unixNow(),
    syncedGames,
  };
}

/** Stable error text for every browser-flow store login. */
export const AUTH_FLOW_UNAVAILABLE =
  "This sign-in needs the embedded browser window, which is not available in the Electron build yet. " +
  "Use Steam (API key) for owned-game sync, or rely on local install detection.";
