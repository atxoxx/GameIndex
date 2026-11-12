/**
 * Import detected installs into the game library.
 *
 * Stable ids are store-scoped (`steam:<appid>`, `gog:<productId>`,
 * `epic:<appName>`, `uplay:<id>`, `rockstar:<titleId>`, …). A row that already
 * represents the same install is merged, never duplicated:
 *
 *   1. the exact stable id (`steam:440`);
 *   2. the legacy / renderer id form (`steam-440`, `gog-123`, …), because the
 *      renderer's sync flows still create those;
 *   3. the store's own id field (`steamAppId`, `gogGameId`, …);
 *   4. as a last resort, same platform + normalized title (only when the store
 *      has no durable id, e.g. a manifest-less Steam `common/` folder).
 *
 * Merging preserves everything the user owns: art, notes, favourite state,
 * display name, rating. Only the install facts (installed, path, size) and
 * originally-empty fields are written.
 */
import fs from "node:fs";
import type { Game } from "../../../../src/types/game";
import {
  getGame,
  listGames,
  patchGameRecord,
  upsertGames,
} from "../../state/libraryStore";
import { buildNewGame } from "./mapping";
import { normalizeTitle } from "./ownership";
import { STORE_PLATFORMS, type DetectedInstall, type ImportSummary } from "./types";

function normalizePathForCompare(value: string): string {
  return value.replace(/[\\/]+/g, "\\").toLowerCase();
}

function pathExists(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

/** Every id form that may already represent this store install. */
function keyForms(install: DetectedInstall): string[] {
  const storeId = install.storeId.toLowerCase();
  const forms = [
    `${install.store}:${storeId}`,
    `${install.store}-${storeId}`,
  ];
  if (install.store === "epic" && install.namespace && install.catalogItemId) {
    const composite = `${install.namespace}-${install.catalogItemId}`.toLowerCase();
    forms.push(`epic:${composite}`, `epic-${composite}`);
  }
  return forms;
}

function storeFieldMatch(game: Game, install: DetectedInstall): boolean {
  switch (install.store) {
    case "steam": {
      const appId = Number(install.storeId);
      return Number.isFinite(appId) && game.steamAppId === appId;
    }
    case "gog":
      return game.gogGameId === install.storeId;
    case "epic": {
      if (install.namespace && install.catalogItemId) {
        return (
          game.epicNamespace === install.namespace &&
          game.epicCatalogItemId === install.catalogItemId
        );
      }
      return game.id.toLowerCase().includes(install.storeId.toLowerCase());
    }
    case "uplay":
      return game.uplayGameId === install.storeId;
    case "rockstar":
      return game.rockstarTitleId === install.storeId;
    case "humble":
      return game.humbleGameId === install.storeId;
    default:
      return false;
  }
}

/** Sparse patch of install facts, leaving user content untouched. */
function buildPatch(game: Game, install: DetectedInstall): Partial<Game> | null {
  const patch: Partial<Game> = {};
  if (!game.installed && install.installed) patch.installed = true;

  if (install.exePath && normalizePathForCompare(game.path ?? "") !== normalizePathForCompare(install.exePath)) {
    // Keep a user-chosen exe that still exists; replace a blank or stale one.
    if (!game.path || !pathExists(game.path)) patch.path = install.exePath;
  }

  if (!game.name && install.name) patch.name = install.name;

  if (
    install.sizeBytes !== undefined &&
    install.sizeBytes > 0 &&
    game.sizeBytes !== install.sizeBytes
  ) {
    patch.sizeBytes = install.sizeBytes;
    patch.sizeRootPath = install.installDir ?? game.sizeRootPath;
    patch.sizeDetectedAt = new Date().toISOString();
  }

  switch (install.store) {
    case "steam": {
      const appId = Number(install.storeId);
      if (Number.isFinite(appId) && game.steamAppId === undefined) {
        patch.steamAppId = appId;
      }
      break;
    }
    case "epic":
      if (install.namespace && !game.epicNamespace) patch.epicNamespace = install.namespace;
      if (install.catalogItemId && !game.epicCatalogItemId) {
        patch.epicCatalogItemId = install.catalogItemId;
      }
      break;
    case "gog":
      if (!game.gogGameId) patch.gogGameId = install.storeId;
      break;
    case "uplay":
      if (!game.uplayGameId) {
        patch.uplayGameId = install.storeId;
        patch.uplayIsConnect = true;
      }
      break;
    case "rockstar":
      if (!game.rockstarTitleId) patch.rockstarTitleId = install.storeId;
      break;
    case "humble":
      if (!game.humbleGameId) patch.humbleGameId = install.storeId;
      break;
    default:
      break;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function findExisting(
  install: DetectedInstall,
  games: Game[],
  byKey: Map<string, Game>,
): Game | null {
  for (const form of keyForms(install)) {
    const hit = byKey.get(form);
    if (hit) return hit;
  }
  const byField = games.find((game) => storeFieldMatch(game, install));
  if (byField) return byField;

  if (install.installed || !install.exePath) {
    const platform = STORE_PLATFORMS[install.store];
    const wanted = normalizeTitle(install.name);
    if (wanted.length >= 4) {
      const byName = games.find(
        (game) => game.platform === platform && normalizeTitle(game.name) === wanted,
      );
      if (byName) return byName;
    }
  }

  return null;
}

/**
 * Merge every detected install into the library.
 *
 * Only rows that actually changed are written. A row reached through
 * `getGame` is re-read from the store, so concurrent enrichment writes are not
 * clobbered (the store merges keys).
 */
export function importDetectedInstalls(installs: DetectedInstall[]): ImportSummary {
  const created: Game[] = [];
  const summary: ImportSummary = { created: 0, updated: 0, unchanged: 0, ids: [] };

  const games = listGames();
  const byKey = new Map<string, Game>();
  for (const game of games) {
    byKey.set(game.id.toLowerCase(), game);
    if (game.steamAppId !== undefined) {
      byKey.set(`steam:${game.steamAppId}`, game);
      byKey.set(`steam-${game.steamAppId}`, game);
    }
    if (game.gogGameId) {
      byKey.set(`gog:${game.gogGameId}`, game);
      byKey.set(`gog-${game.gogGameId}`, game);
    }
    if (game.epicNamespace && game.epicCatalogItemId) {
      const composite = `${game.epicNamespace}-${game.epicCatalogItemId}`.toLowerCase();
      byKey.set(`epic:${composite}`, game);
      byKey.set(`epic-${composite}`, game);
    }
    if (game.uplayGameId) byKey.set(`uplay:${game.uplayGameId}`, game);
    if (game.rockstarTitleId) byKey.set(`rockstar:${game.rockstarTitleId}`, game);
    if (game.humbleGameId) byKey.set(`humble:${game.humbleGameId}`, game);
  }

  const claimed = new Map<string, Game>();
  for (const install of installs) {
    if (!install.installed) {
      summary.unchanged += 1;
      continue;
    }
    const key = `${install.store}:${install.storeId}`.toLowerCase();
    const existing =
      claimed.get(key) ?? findExisting(install, games, byKey);
    if (existing) {
      claimed.set(key, existing);
      const fresh = getGame(existing.id) ?? existing;
      const patch = buildPatch(fresh, install);
      if (!patch) {
        summary.unchanged += 1;
        continue;
      }
      patchGameRecord(fresh.id, patch);
      summary.updated += 1;
      summary.ids.push(fresh.id);
      continue;
    }

    const game = buildNewGame(install);
    // A previous iteration may already have queued the same stable id.
    if (created.some((row) => row.id === game.id)) {
      summary.unchanged += 1;
      continue;
    }
    created.push(game);
    byKey.set(game.id.toLowerCase(), game);
    claimed.set(key, game);
    summary.created += 1;
    summary.ids.push(game.id);
  }

  if (created.length > 0) {
    upsertGames(created);
  }
  return summary;
}
