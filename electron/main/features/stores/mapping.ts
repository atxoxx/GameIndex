/**
 * Pure mapping from a detected install to a library `Game` row.
 *
 * Kept free of Electron imports so the scan harness can run under plain Node
 * (and so the mapping is trivially testable).
 */
import type { Game } from "../../../../src/types/game";
import { STORE_PLATFORMS, type DetectedInstall } from "./types";

/** Stable library id for a detected install (`steam:<appid>`, `gog:<id>`, …). */
export function detectedGameId(install: DetectedInstall): string {
  return `${install.store}:${install.storeId}`;
}

export function buildNewGame(install: DetectedInstall): Game {
  const base: Game = {
    id: detectedGameId(install),
    name: install.name,
    path: install.exePath ?? "",
    platform: STORE_PLATFORMS[install.store],
    installed: install.installed,
    playTime: "0h",
    addedAt: Date.now(),
  };

  if (install.sizeBytes !== undefined && install.sizeBytes > 0) {
    base.sizeBytes = install.sizeBytes;
    base.sizeRootPath = install.installDir ?? undefined;
    base.sizeDetectedAt = new Date().toISOString();
  }

  switch (install.store) {
    case "steam": {
      const appId = Number(install.storeId);
      if (Number.isFinite(appId)) base.steamAppId = appId;
      base.storeSource = "steam";
      break;
    }
    case "epic":
      if (install.namespace) base.epicNamespace = install.namespace;
      if (install.catalogItemId) base.epicCatalogItemId = install.catalogItemId;
      break;
    case "gog":
      base.gogGameId = install.storeId;
      break;
    case "uplay":
      base.uplayGameId = install.storeId;
      base.uplayIsConnect = true;
      break;
    case "rockstar":
      base.rockstarTitleId = install.storeId;
      break;
    case "humble":
      base.humbleGameId = install.storeId;
      break;
    default:
      break;
  }

  return base;
}
