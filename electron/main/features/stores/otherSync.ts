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
import { createSqliteStore } from "../../state/sqliteStore";
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
import { epicIsAuthenticated } from "../integrations/epicAuth";
import { gogIsAuthenticated } from "../integrations/gogAuth";
import { fetchEpicLibrary } from "../integrations/epicLibrary";
import { fetchGogLibrary } from "../integrations/gogLibrary";

interface StoreSettingsDocument {
  version: number;
  uplay: UplaySettings;
  humble: HumbleSettings;
}

const settingsStore = createSqliteStore<StoreSettingsDocument>({
  domain: "kv",
  document: "store-settings",
  createDefault: () => ({
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
  normalize: (value) => ({
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
});

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

/** `gog_sync_library`: account library when connected, plus local installs. */
export async function syncGogLibrary(): Promise<GogSyncResult> {
  const scan = await scanGog();
  const installedById = new Map(
    scan.installs.map((install) => [install.storeId, install] as const),
  );
  const errors = [...scan.errors];

  const syncedById = new Map<string, GogSyncResult["syncedGames"][number]>();

  const owned = await gogOwnedFromGalaxyDb();
  for (const entry of owned) {
    syncedById.set(entry.gameId, {
      id: `gog-${entry.gameId}`,
      title: entry.title,
      gogGameId: entry.gameId,
      isInstalled: installedById.has(entry.gameId),
      installPath: installedById.get(entry.gameId)?.exePath ?? undefined,
      installDir: installedById.get(entry.gameId)?.installDir ?? undefined,
      sizeBytes: installedById.get(entry.gameId)?.sizeBytes,
      sizeRootPath: installedById.get(entry.gameId)?.installDir ?? undefined,
    });
  }

  if (gogIsAuthenticated()) {
    try {
      const cloud = await fetchGogLibrary();
      errors.push(...cloud.errors);
      for (const game of cloud.games) {
        const installed = installedById.get(game.gogGameId);
        const local = syncedById.get(game.gogGameId);
        syncedById.set(game.gogGameId, {
          ...local,
          ...game,
          title: game.title || local?.title || `GOG Game ${game.gogGameId}`,
          isInstalled: Boolean(installed),
          installPath: installed?.exePath ?? undefined,
          installDir: installed?.installDir ?? undefined,
          sizeBytes: installed?.sizeBytes,
          sizeRootPath: installed?.installDir ?? undefined,
        });
      }
    } catch (error) {
      errors.push(
        `GOG account library could not be fetched: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else if (!scan.available) {
    errors.push(
      "GOG is not installed and no account is connected — connect your GOG account in Settings to import owned games.",
    );
  }

  for (const install of scan.installs) {
    if (syncedById.has(install.storeId)) continue;
    syncedById.set(install.storeId, {
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

  const syncedGames = [...syncedById.values()];
  return {
    success: true,
    gamesImported: syncedGames.length,
    gamesSkipped: 0,
    errors,
    lastSync: unixNow(),
    syncedGames,
  };
}

/** `epic_sync_library`: account library when connected, plus local installs. */
export async function syncEpicLibrary(): Promise<EpicSyncResult> {
  const scan = await scanEpic();
  const errors = [...scan.errors];
  const syncedById = new Map<string, EpicSyncResult["syncedGames"][number]>();

  for (const install of scan.installs) {
    const key = `${install.namespace ?? ""}:${install.catalogItemId ?? install.storeId}`;
    syncedById.set(key, {
      id: `epic-${install.namespace ?? "unknown"}-${install.catalogItemId ?? install.storeId}`,
      title: install.name,
      namespace: install.namespace ?? "",
      catalogItemId: install.catalogItemId ?? "",
      isInstalled: install.installed,
      installPath: install.exePath ?? undefined,
      sizeBytes: install.sizeBytes,
      sizeRootPath: install.installDir ?? undefined,
    });
  }

  if (epicIsAuthenticated()) {
    try {
      const cloud = await fetchEpicLibrary();
      errors.push(...cloud.errors);
      for (const game of cloud.games) {
        const key = `${game.namespace}:${game.catalogItemId}`;
        const local = syncedById.get(key);
        syncedById.set(key, {
          ...local,
          ...game,
          title: game.title || local?.title || game.catalogItemId,
          isInstalled: Boolean(local?.isInstalled),
          installPath: local?.installPath,
          sizeBytes: local?.sizeBytes,
          sizeRootPath: local?.sizeRootPath,
        });
      }
    } catch (error) {
      errors.push(
        `Epic account library could not be fetched: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else if (!scan.available) {
    errors.push(
      "Epic Games Launcher is not installed and no account is connected — connect your Epic account in Settings to import owned games.",
    );
  }

  const syncedGames = [...syncedById.values()];
  return {
    success: true,
    gamesImported: syncedGames.length,
    gamesSkipped: 0,
    errors,
    lastSync: unixNow(),
    syncedGames,
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
