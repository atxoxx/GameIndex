/**
 * Beta store integrations (Battle.net, EA app, Xbox, itch.io).
 *
 * These four share one wire protocol with the renderer
 * (`src/pages/settings/useBetaIntegration.ts`): `<key>_is_authenticated`,
 * `<key>_get_settings`, `<key>_save_settings`, `<key>_start_login`,
 * `<key>_sync_library`, `<key>_logout`.
 *
 * Account sign-in for these clients is OAuth/embedded-browser work that the
 * port has not built yet. What *is* real here is the local half: the scanners in
 * `features/stores/misc.ts` read each client's own install database/registry,
 * so "Connect" establishes a local-library session and Sync imports the games
 * actually installed on this PC. Nothing is fabricated: when a client is not
 * detected, connect fails with an actionable message.
 */
import { betaLogout, betaStartLogin } from "./betaAuth";
import { createSqliteStore } from "../../state/sqliteStore";
import {
  scanBattlenet,
  scanEa,
  scanItch,
  scanXbox,
} from "../stores/misc";
import type { DetectedInstall, StoreScanResult } from "../stores/types";

export type BetaKey = "battlenet" | "ea" | "xbox" | "itch";

export const BETA_KEYS: BetaKey[] = ["battlenet", "ea", "xbox", "itch"];

const DISPLAY_NAMES: Record<BetaKey, string> = {
  battlenet: "Battle.net",
  ea: "EA app",
  xbox: "Xbox / Microsoft Store",
  itch: "itch.io",
};

const scanners: Record<BetaKey, () => Promise<StoreScanResult>> = {
  battlenet: scanBattlenet,
  ea: scanEa,
  xbox: scanXbox,
  itch: scanItch,
};

export interface BetaSettings {
  connectAccount: boolean;
  importInstalledGames: boolean;
  importUninstalledGames: boolean;
}

const DEFAULT_SETTINGS: BetaSettings = {
  connectAccount: true,
  importInstalledGames: true,
  importUninstalledGames: true,
};

interface BetaSession {
  username: string;
  loggedInAt: number;
  lastSync?: number;
}

interface BetaRecord {
  session: BetaSession | null;
  settings: BetaSettings;
}

interface BetaDocument {
  stores: Partial<Record<BetaKey, BetaRecord>>;
}

const store = createSqliteStore<BetaDocument>({
  domain: "kv",
  document: "beta-integrations",
  createDefault: () => ({ stores: {} }),
  normalize: (doc) => {
    if (!doc.stores || typeof doc.stores !== "object") doc.stores = {};
    return doc;
  },
});

function record(key: BetaKey): BetaRecord {
  return store.read().stores[key] ?? { session: null, settings: { ...DEFAULT_SETTINGS } };
}

function write(key: BetaKey, next: BetaRecord): void {
  store.update((doc) => {
    doc.stores[key] = next;
    return doc;
  });
}

export function getBetaSettings(key: BetaKey): BetaSettings {
  return { ...DEFAULT_SETTINGS, ...record(key).settings };
}

export function saveBetaSettings(key: BetaKey, patch: unknown): BetaSettings {
  const incoming = (patch ?? {}) as Partial<BetaSettings>;
  const next: BetaSettings = {
    connectAccount:
      typeof incoming.connectAccount === "boolean"
        ? incoming.connectAccount
        : DEFAULT_SETTINGS.connectAccount,
    importInstalledGames:
      typeof incoming.importInstalledGames === "boolean"
        ? incoming.importInstalledGames
        : DEFAULT_SETTINGS.importInstalledGames,
    importUninstalledGames:
      typeof incoming.importUninstalledGames === "boolean"
        ? incoming.importUninstalledGames
        : DEFAULT_SETTINGS.importUninstalledGames,
  };
  write(key, { ...record(key), settings: next });
  return next;
}

export function isBetaAuthenticated(key: BetaKey): boolean {
  return record(key).session !== null;
}

export interface BetaSessionResult {
  username: string;
  loggedInAt: number;
  beta: true;
}

export async function startBetaLogin(key: BetaKey): Promise<BetaSessionResult> {
  const auth = await betaStartLogin(key);
  const now = Math.floor(auth.loggedInAt / 1000);
  const username = `${DISPLAY_NAMES[key]} account`;
  write(key, { ...record(key), session: { username, loggedInAt: now } });
  return { username, loggedInAt: now, beta: true };
}

export function logoutBeta(key: BetaKey): void {
  betaLogout(key);
  write(key, { ...record(key), session: null });
}

export interface BetaSyncedGame {
  id: string;
  title: string;
  storeGameId?: string;
  isInstalled: boolean;
  installPath?: string;
  coverUrl?: string;
  playtimeMinutes?: number;
  lastPlayed?: number;
}

export interface BetaSyncResult {
  success: boolean;
  gamesImported: number;
  gamesSkipped: number;
  errors: string[];
  lastSync: number;
  syncedGames: BetaSyncedGame[];
  note?: string;
}

function toSyncedGame(key: BetaKey, install: DetectedInstall): BetaSyncedGame {
  return {
    id: `${key}-${install.storeId}`,
    title: install.name,
    storeGameId: install.storeId,
    isInstalled: install.installed,
    installPath: install.exePath ?? install.installDir ?? undefined,
  };
}

export async function syncBetaLibrary(key: BetaKey): Promise<BetaSyncResult> {
  const current = record(key);
  if (!current.session) {
    throw new Error(`Connect ${DISPLAY_NAMES[key]} first.`);
  }

  const now = Math.floor(Date.now() / 1000);
  const settings = { ...DEFAULT_SETTINGS, ...current.settings };
  if (!settings.connectAccount) {
    write(key, { ...current, session: { ...current.session, lastSync: now } });
    return {
      success: true,
      gamesImported: 0,
      gamesSkipped: 0,
      errors: [],
      lastSync: now,
      syncedGames: [],
      note: `${DISPLAY_NAMES[key]} is disconnected in Settings.`,
    };
  }

  const scan = await scanners[key]();
  const synced: BetaSyncedGame[] = [];
  let skipped = 0;

  for (const install of scan.installs) {
    if (install.installed && !settings.importInstalledGames) {
      skipped += 1;
      continue;
    }
    if (!install.installed && !settings.importUninstalledGames) {
      skipped += 1;
      continue;
    }
    if (!install.installed && !install.installDir && !install.exePath) {
      // An uninstalled entry with no identity cannot be imported usefully.
      skipped += 1;
      continue;
    }
    synced.push(toSyncedGame(key, install));
  }

  write(key, { ...current, session: { ...current.session, lastSync: now } });

  const errors = [...scan.errors];
  const note =
    scan.installs.length === 0
      ? `No ${DISPLAY_NAMES[key]} games were found on this PC.`
      : "Only locally installed games can be detected without an account sign-in.";

  return {
    success: errors.length === 0,
    gamesImported: synced.length,
    gamesSkipped: skipped,
    errors,
    lastSync: now,
    syncedGames: synced,
    note,
  };
}

/** Command names for one store, matching the renderer's `betaCommand()`. */
export function betaCommandNames(key: BetaKey): string[] {
  return [
    `${key}_is_authenticated`,
    `${key}_get_settings`,
    `${key}_save_settings`,
    `${key}_start_login`,
    `${key}_sync_library`,
    `${key}_logout`,
  ];
}
