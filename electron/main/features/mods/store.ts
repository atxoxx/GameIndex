/**
 * Persisted mod-manager index.
 *
 * The Rust build kept mods in SQLite (`db/mods.rs`). This wave stores the same
 * rows in `<userData>/mods.json` through `state/jsonStore.ts`: one document with
 * the detected mod rows, per-game settings, saved profiles, source links and
 * Discover install history. Row/field names match the DAO exactly.
 */
import { createJsonStore } from "../../state/jsonStore";
import type {
  GameModSettingsRow,
  ModProfileRow,
  ModRemoteInstallRow,
  ModRow,
  ModSourceLinkRow,
  ModsDocument,
  ModsOverviewRow,
} from "./types";
import { nowSecs } from "./util";

function emptyDocument(): ModsDocument {
  return {
    version: 1,
    mods: [],
    settings: {},
    profiles: [],
    sourceLinks: [],
    remoteInstalls: [],
    updatedAt: nowSecs(),
  };
}

function normalizeDocument(value: ModsDocument): ModsDocument {
  return {
    version: typeof value.version === "number" ? value.version : 1,
    mods: Array.isArray(value.mods) ? value.mods : [],
    settings:
      value.settings && typeof value.settings === "object" && !Array.isArray(value.settings)
        ? value.settings
        : {},
    profiles: Array.isArray(value.profiles) ? value.profiles : [],
    sourceLinks: Array.isArray(value.sourceLinks) ? value.sourceLinks : [],
    remoteInstalls: Array.isArray(value.remoteInstalls) ? value.remoteInstalls : [],
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : nowSecs(),
  };
}

export const modsStore = createJsonStore<ModsDocument>("mods.json", emptyDocument, normalizeDocument);

function touch(doc: ModsDocument): ModsDocument {
  return { ...doc, updatedAt: nowSecs() };
}

function compareRows(a: ModRow, b: ModRow): number {
  return a.loadOrder - b.loadOrder || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

export function listModsForGame(gameId: string): ModRow[] {
  return modsStore
    .read()
    .mods.filter((row) => row.gameId === gameId)
    .sort(compareRows);
}

export function listAllMods(): ModRow[] {
  return modsStore
    .read()
    .mods.slice()
    .sort((a, b) => a.gameId.localeCompare(b.gameId) || compareRows(a, b));
}

export function getMod(modId: string): ModRow | null {
  return modsStore.read().mods.find((row) => row.id === modId) ?? null;
}

export function replaceModsForGame(gameId: string, mods: ModRow[]): void {
  modsStore.update((doc) =>
    touch({
      ...doc,
      mods: [...doc.mods.filter((row) => row.gameId !== gameId), ...mods],
    }),
  );
}

export function upsertMod(mod: ModRow): void {
  modsStore.update((doc) => {
    const index = doc.mods.findIndex((row) => row.id === mod.id);
    const mods = doc.mods.slice();
    if (index >= 0) mods[index] = mod;
    else mods.push(mod);
    return touch({ ...doc, mods });
  });
}

export function setLoadOrders(orders: Array<[string, number]>): void {
  if (orders.length === 0) return;
  const lookup = new Map(orders);
  modsStore.update((doc) =>
    touch({
      ...doc,
      mods: doc.mods.map((row) => {
        const order = lookup.get(row.id);
        return order === undefined ? row : { ...row, loadOrder: order, updatedAt: nowSecs() };
      }),
    }),
  );
}

export function deleteMod(modId: string): void {
  modsStore.update((doc) =>
    touch({ ...doc, mods: doc.mods.filter((row) => row.id !== modId) }),
  );
}

export function emptySettings(gameId: string): GameModSettingsRow {
  return { gameId, updatedAt: 0 };
}

export function getSettings(gameId: string): GameModSettingsRow | null {
  return modsStore.read().settings[gameId] ?? null;
}

export function upsertSettings(settings: GameModSettingsRow): void {
  modsStore.update((doc) =>
    touch({ ...doc, settings: { ...doc.settings, [settings.gameId]: settings } }),
  );
}

export function overview(): ModsOverviewRow[] {
  const doc = modsStore.read();
  const grouped = new Map<string, ModRow[]>();
  for (const row of doc.mods) {
    const bucket = grouped.get(row.gameId);
    if (bucket) bucket.push(row);
    else grouped.set(row.gameId, [row]);
  }
  const out: ModsOverviewRow[] = [];
  for (const [gameId, rows] of grouped) {
    const engines: string[] = [];
    for (const row of rows) if (!engines.includes(row.engine)) engines.push(row.engine);
    const totalSize = rows.reduce((sum, row) => sum + (row.sizeBytes ?? 0), 0);
    const settings = doc.settings[gameId];
    out.push({
      gameId,
      total: rows.length,
      enabled: rows.filter((row) => row.enabled).length,
      updates: rows.filter((row) => row.updateAvailable).length,
      engines,
      ...(settings?.modsRoot ? { modsRoot: settings.modsRoot } : {}),
      totalSizeBytes: totalSize,
    });
  }
  return out.sort((a, b) => a.gameId.localeCompare(b.gameId));
}

// ── Profiles ────────────────────────────────────────────────────────

export function listProfiles(gameId: string): ModProfileRow[] {
  return modsStore
    .read()
    .profiles.filter((row) => row.gameId === gameId)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export function listAllProfiles(): ModProfileRow[] {
  return modsStore
    .read()
    .profiles.slice()
    .sort(
      (a, b) => a.gameId.localeCompare(b.gameId) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
}

export function upsertProfile(profile: ModProfileRow): void {
  modsStore.update((doc) => {
    const index = doc.profiles.findIndex((row) => row.id === profile.id);
    const profiles = doc.profiles.slice();
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
    return touch({ ...doc, profiles });
  });
}

export function deleteProfile(profileId: string): void {
  modsStore.update((doc) =>
    touch({ ...doc, profiles: doc.profiles.filter((row) => row.id !== profileId) }),
  );
}

// ── Source links & Discover installs ────────────────────────────────

export function listSourceLinks(gameId: string): ModSourceLinkRow[] {
  return modsStore
    .read()
    .sourceLinks.filter((row) => row.gameId === gameId)
    .sort((a, b) => a.source.localeCompare(b.source));
}

export function upsertSourceLink(link: ModSourceLinkRow): void {
  modsStore.update((doc) => {
    const index = doc.sourceLinks.findIndex(
      (row) => row.gameId === link.gameId && row.source === link.source,
    );
    const sourceLinks = doc.sourceLinks.slice();
    if (index >= 0) sourceLinks[index] = link;
    else sourceLinks.push(link);
    return touch({ ...doc, sourceLinks });
  });
}

export function deleteSourceLink(gameId: string, source: string): void {
  modsStore.update((doc) =>
    touch({
      ...doc,
      sourceLinks: doc.sourceLinks.filter(
        (row) => !(row.gameId === gameId && row.source === source),
      ),
    }),
  );
}

export function listRemoteInstalls(gameId: string): ModRemoteInstallRow[] {
  return modsStore
    .read()
    .remoteInstalls.filter((row) => row.gameId === gameId)
    .sort((a, b) => b.installedAt - a.installedAt);
}

export function insertRemoteInstall(row: ModRemoteInstallRow): void {
  modsStore.update((doc) => {
    const index = doc.remoteInstalls.findIndex((entry) => entry.id === row.id);
    const remoteInstalls = doc.remoteInstalls.slice();
    if (index >= 0) remoteInstalls[index] = row;
    else remoteInstalls.push(row);
    return touch({ ...doc, remoteInstalls });
  });
}

export function deleteRemoteInstall(id: string): void {
  modsStore.update((doc) =>
    touch({ ...doc, remoteInstalls: doc.remoteInstalls.filter((row) => row.id !== id) }),
  );
}
