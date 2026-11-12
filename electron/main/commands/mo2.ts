/**
 * Mods, Mod Organizer 2 and Nexus Mods commands.
 *
 * Workstream: `modsEmu` (`mods_*`, `mo2_*`, `nexus_*`) plus the mod half of
 * `mods_source_*`. Reference implementations:
 *   - `src-tauri/src/mods/mo2.rs`      → features/mo2/*
 *   - `src-tauri/src/mods/mod.rs`      → features/mods/{manage,scan}
 *   - `src-tauri/src/mods/nexus.rs`    → features/mods/nexus.ts
 *   - `src-tauri/src/mods/sources/`    → features/mods/sources.ts
 *
 * Everything the UI reads is persisted in `<userData>/mods.json`; MO2 profile
 * files are edited in place (with backups), matching the Rust behaviour.
 */
import { emit, registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import { getGame } from "../state/libraryStore";
import { steamGameInstallPath } from "../features/launch/steam";
import {
  createProfile as mo2CreateProfile,
  deleteProfile as mo2DeleteProfile,
  getProfileDetails,
  reorderMods as mo2ReorderMods,
  reorderPlugins as mo2ReorderPlugins,
  setModEnabled as mo2SetModEnabled,
  setModsEnabled as mo2SetModsEnabled,
  setPluginEnabled as mo2SetPluginEnabled,
  switchProfile as mo2SwitchProfile,
} from "../features/mo2/profiles";
import { detectMo2Instances, resolveInstanceAt } from "../features/mo2/instances";
import { launchWithMo2 } from "../features/mo2/launch";
import type { Mo2ProfileDetails } from "../features/mo2/types";
import {
  deleteModArtifact,
  detectConflicts,
  healthCheck,
  installArchive,
  listModFiles,
  payloadFor,
  reorderMods,
  setModEnabled,
  undoLast,
  unlinkOnly,
} from "../features/mods/manage";
import * as modsNexus from "../features/mods/nexus";
import {
  deleteRemoteInstall,
  emptySettings,
  getMod,
  getSettings,
  listAllProfiles,
  listModsForGame,
  listProfiles,
  listRemoteInstalls,
  overview as modsOverviewRows,
  replaceModsForGame,
  upsertMod,
  upsertProfile,
  upsertSettings,
  deleteProfile as deleteModProfile,
  deleteSourceLink,
} from "../features/mods/store";
import { scanGame } from "../features/mods/scan";
import {
  browseSource,
  clearSourceLink,
  detectSources,
  detailSource,
  downloadSource,
  latestVersionFor,
  setSourceLink,
  storedDomain,
  versionIsNewer,
} from "../features/mods/sources";
import type { ModProfileRow, ModRow } from "../features/mods/types";
import { fileMd5, isDir, nowSecs } from "../features/mods/util";

// ── Argument helpers ────────────────────────────────────────────────

function text(args: CommandArgs, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function optionalText(args: CommandArgs, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function flag(args: CommandArgs, key: string, fallback = false): boolean {
  const value = args[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringList(args: CommandArgs, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function booleanRecord(args: CommandArgs, key: string): Record<string, boolean> {
  const value = args[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [name, state] of Object.entries(value as Record<string, unknown>)) {
    if (typeof state === "boolean") out[name] = state;
  }
  return out;
}

function steamAppIdText(args: CommandArgs): string | null {
  const value = args.steamAppId;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

// ── Scan cancellation ───────────────────────────────────────────────

const cancels = new Map<string, { cancelled: boolean }>();

function progress(
  gameId: string,
  phase: string,
  filesExamined: number,
  modsFound: number,
  complete: boolean,
): void {
  emit("mods-scan-progress", { gameId, phase, filesExamined, modsFound, complete });
}

async function scanGameCommand(args: CommandArgs): Promise<ReturnType<typeof payloadFor>> {
  const gameId = text(args, "gameId");
  if (!gameId) throw new Error("A game id is required to scan mods");
  let gamePath = text(args, "gamePath");
  let appId = steamAppIdText(args);
  const game = getGame(gameId);
  if (!appId && game && typeof game.steamAppId === "number") appId = String(game.steamAppId);
  if (!gamePath.trim() && game?.path) gamePath = game.path;
  // Steam titles can have no exe path (native Linux binaries); fall back to
  // the appmanifest install dir so scanning still works.
  if (!gamePath.trim() && appId) {
    const parsed = Number.parseInt(appId, 10);
    if (Number.isFinite(parsed)) {
      const installDir = await steamGameInstallPath(parsed);
      if (installDir) gamePath = installDir;
    }
  }
  if (!gamePath.trim()) throw new Error("game folder not found — pick the install folder first");

  const customRoot = getSettings(gameId)?.customRoot ?? null;
  const cancel = { cancelled: false };
  cancels.set(gameId, cancel);
  progress(gameId, "scanning", 0, 0, false);

  try {
    const outcome = await scanGame({
      gameId,
      gamePath,
      steamAppId: appId,
      customRoot,
      isCancelled: () => cancel.cancelled,
      onProgress: (files, mods) => progress(gameId, "scanning", files, mods, false),
    });

    // Reconcile: keep Nexus linkage, notes and Discover provenance.
    const previous = new Map(listModsForGame(gameId).map((row) => [row.id, row]));
    for (const row of outcome.mods) {
      const prev = previous.get(row.id);
      if (!prev) continue;
      row.nexusModId = prev.nexusModId;
      row.nexusDomain = prev.nexusDomain;
      row.latestVersion = prev.latestVersion;
      row.updateAvailable = prev.updateAvailable;
      row.detectedAt = prev.detectedAt;
      row.source = prev.source;
      row.sourceModId = prev.sourceModId;
      row.sourceFileId = prev.sourceFileId;
      row.remoteUrl = prev.remoteUrl;
      if (!row.version) row.version = prev.version;
      if (!row.author) row.author = prev.author;
      if (!row.notes) row.notes = prev.notes;
      if (prev.sizeBytes === row.sizeBytes) row.md5 = prev.md5;
    }

    replaceModsForGame(gameId, outcome.mods);

    const prevSettings = getSettings(gameId);
    upsertSettings({
      gameId,
      ...(outcome.modsRoot ? { modsRoot: outcome.modsRoot } : {}),
      ...(customRoot ? { customRoot } : {}),
      ...(outcome.engines[0] ? { engine: outcome.engines[0] } : {}),
      ...(outcome.pluginsTxt ? { pluginsTxt: outcome.pluginsTxt } : {}),
      ...(prevSettings?.nexusDomain
        ? { nexusDomain: prevSettings.nexusDomain }
        : outcome.nexusDomain
          ? { nexusDomain: outcome.nexusDomain }
          : {}),
      updatedAt: nowSecs(),
    });

    const payload = payloadFor(gameId);
    payload.scanFilesExamined = outcome.filesExamined;
    payload.scanTruncated = outcome.truncated;
    progress(gameId, "complete", outcome.filesExamined, payload.mods.length, true);
    return payload;
  } finally {
    cancels.delete(gameId);
  }
}

// ── Mod enable/update helpers ───────────────────────────────────────

async function runNexusUpdatePass(gameId: string): Promise<void> {
  const key = modsNexus.getApiKey();
  if (!key) return;
  const settings = getSettings(gameId);
  const defaultDomain = settings?.nexusDomain;
  const mods = listModsForGame(gameId);
  let lookups = 0;
  const MAX_LOOKUPS = 40;

  for (const mod of mods) {
    if (mod.engine === "workshop" || lookups >= MAX_LOOKUPS) continue;
    const domain = mod.nexusDomain ?? defaultDomain ?? null;
    if (!domain) continue;
    let changed = false;

    if (!mod.nexusModId && mod.kind !== "folder") {
      if (!mod.md5) {
        const hash = await fileMd5(mod.path);
        if (hash) {
          mod.md5 = hash;
          changed = true;
        }
      }
      if (mod.md5) {
        lookups += 1;
        const hit = await modsNexus.md5Search(key, domain, mod.md5);
        if (hit) {
          mod.nexusModId = hit.modId;
          mod.nexusDomain = domain;
          if (!mod.author && hit.author) mod.author = hit.author;
          if (!mod.version && hit.fileVersion) mod.version = hit.fileVersion;
          if (hit.modName) mod.name = hit.modName;
          changed = true;
        }
      }
    }

    if (mod.nexusModId) {
      lookups += 1;
      const latest = await modsNexus.modLatestVersion(key, domain, mod.nexusModId);
      if (latest) {
        const update = mod.version ? mod.version !== latest : false;
        if (mod.latestVersion !== latest || mod.updateAvailable !== update) {
          mod.latestVersion = latest;
          mod.updateAvailable = update;
          changed = true;
        }
      }
    }

    if (changed) {
      mod.updatedAt = nowSecs();
      upsertMod(mod);
    }
  }
}

/** Non-Nexus sources are not ported; keep Nexus-only update checks honest. */
async function runOtherSourcePass(gameId: string): Promise<void> {
  const mods = listModsForGame(gameId);
  const total = mods.length;
  let done = 0;
  let lookups = 0;
  const MAX_LOOKUPS = 40;
  const domain = storedDomain(gameId);
  for (const mod of mods) {
    done += 1;
    emit("mods-update-progress", {
      gameId,
      done,
      total,
      name: mod.name,
      source: mod.source ?? "nexus",
    });
    if (mod.source !== "nexus" || !mod.sourceModId) continue;
    if (lookups >= MAX_LOOKUPS) continue;
    const sourceDomain = mod.nexusDomain ?? domain;
    if (!sourceDomain) continue;
    lookups += 1;
    try {
      const latest = await latestVersionFor("nexus", sourceDomain, mod.sourceModId);
      if (latest) {
        const update = versionIsNewer(mod.version, latest);
        if (mod.latestVersion !== latest || mod.updateAvailable !== update) {
          mod.latestVersion = latest;
          mod.updateAvailable = update;
          mod.updatedAt = nowSecs();
          upsertMod(mod);
        }
      }
    } catch {
      /* a failed source must not abort the whole check */
    }
  }
}

// ── Command table ───────────────────────────────────────────────────

export const mo2Commands: Record<string, CommandHandler> = {
  // ── Mod Organizer 2 ───────────────────────────────────────────────
  mo2_detect_instances: (args) =>
    detectMo2Instances(text(args, "gamePath"), text(args, "gameName")),

  mo2_resolve_instance: (args) => resolveInstanceAt(text(args, "path")),

  mo2_get_profile_details: async (args): Promise<Mo2ProfileDetails> =>
    getProfileDetails(text(args, "instancePath"), text(args, "profileName")),

  mo2_set_mod_enabled: (args) => {
    mo2SetModEnabled(
      text(args, "instancePath"),
      text(args, "profileName"),
      text(args, "modName"),
      flag(args, "enabled"),
    );
    return null;
  },

  mo2_set_mods_enabled: (args) => {
    mo2SetModsEnabled(
      text(args, "instancePath"),
      text(args, "profileName"),
      booleanRecord(args, "updates"),
    );
    return null;
  },

  mo2_reorder_mods: (args) => {
    mo2ReorderMods(
      text(args, "instancePath"),
      text(args, "profileName"),
      stringList(args, "orderedModNames"),
    );
    return null;
  },

  mo2_set_plugin_enabled: (args) => {
    mo2SetPluginEnabled(
      text(args, "instancePath"),
      text(args, "profileName"),
      text(args, "pluginName"),
      flag(args, "enabled"),
    );
    return null;
  },

  mo2_reorder_plugins: (args) => {
    mo2ReorderPlugins(
      text(args, "instancePath"),
      text(args, "profileName"),
      stringList(args, "orderedPluginNames"),
    );
    return null;
  },

  mo2_switch_profile: (args) => {
    mo2SwitchProfile(text(args, "instancePath"), text(args, "profileName"));
    return null;
  },

  mo2_create_profile: (args) => {
    mo2CreateProfile(
      text(args, "instancePath"),
      text(args, "profileName"),
      optionalText(args, "cloneFrom"),
    );
    return null;
  },

  mo2_delete_profile: (args) => {
    mo2DeleteProfile(text(args, "instancePath"), text(args, "profileName"));
    return null;
  },

  mo2_launch_game: (args) =>
    launchWithMo2({
      gameId: text(args, "gameId"),
      gameName: text(args, "gameName"),
      instancePath: text(args, "instancePath"),
      profileName: text(args, "profileName"),
      executable: text(args, "executable"),
      moExePath: optionalText(args, "moExePath"),
      runAsAdmin: flag(args, "runAsAdmin"),
    }),

  // ── Mod manager ───────────────────────────────────────────────────
  mods_scan_game: (args) => scanGameCommand(args),

  mods_cancel_scan: (args) => {
    const gameId = text(args, "gameId");
    const entry = cancels.get(gameId);
    if (entry) entry.cancelled = true;
    return null;
  },

  mods_list: (args) => payloadFor(text(args, "gameId")),

  mods_set_enabled: (args) => setModEnabled(text(args, "modId"), flag(args, "enabled")),

  mods_reorder: (args) => reorderMods(text(args, "gameId"), stringList(args, "orderedIds")),

  mods_delete: (args) => {
    deleteModArtifact(text(args, "modId"));
    return null;
  },

  mods_unlink: (args) => {
    unlinkOnly(text(args, "modId"));
    return null;
  },

  mods_list_files: (args) => listModFiles(text(args, "modId")),

  mods_conflicts: (args) => detectConflicts(text(args, "gameId")),

  mods_overview: () => {
    // Imported through the store to keep a single source of truth.
    return modsOverviewRows();
  },

  mods_set_nexus_domain: (args) => {
    const gameId = text(args, "gameId");
    const domain = optionalText(args, "domain")?.trim() || null;
    const settings = getSettings(gameId) ?? emptySettings(gameId);
    upsertSettings({ ...settings, gameId, nexusDomain: domain ?? undefined, updatedAt: nowSecs() });
    if (domain) setSourceLink(gameId, "nexus", domain, domain);
    else deleteSourceLink(gameId, "nexus");
    return null;
  },

  mods_set_custom_root: (args) => {
    const gameId = text(args, "gameId");
    const raw = optionalText(args, "path")?.trim() || null;
    if (raw && !isDir(raw)) throw new Error(`'${raw}' is not a folder`);
    const settings = getSettings(gameId) ?? emptySettings(gameId);
    upsertSettings({ ...settings, gameId, customRoot: raw ?? undefined, updatedAt: nowSecs() });
    return null;
  },

  mods_install_archive: (args) => {
    const gameId = text(args, "gameId");
    const settings = getSettings(gameId);
    const destination =
      optionalText(args, "destination")?.trim() ||
      settings?.customRoot ||
      settings?.modsRoot ||
      null;
    if (!destination) throw new Error("install_target_missing: select a mods folder first");
    return installArchive(text(args, "archivePath"), destination);
  },

  mods_undo_last: () => {
    undoLast();
    return null;
  },

  mods_health_check: (args) => healthCheck(text(args, "gameId")),

  mods_profiles_list: (args) => listProfiles(text(args, "gameId")),

  mods_profiles_all: () => listAllProfiles(),

  mods_profile_save: (args) => {
    const raw = args.profile;
    if (!raw || typeof raw !== "object") throw new Error("invalid_profile: profile is required");
    const value = raw as Record<string, unknown>;
    const profile: ModProfileRow = {
      id: typeof value.id === "string" ? value.id : "",
      gameId: typeof value.gameId === "string" ? value.gameId : "",
      name: typeof value.name === "string" ? value.name : "",
      modStates:
        value.modStates && typeof value.modStates === "object"
          ? (value.modStates as Record<string, boolean>)
          : {},
      loadOrder: Array.isArray(value.loadOrder)
        ? value.loadOrder.filter((entry): entry is string => typeof entry === "string")
        : [],
      createdAt: typeof value.createdAt === "number" ? value.createdAt : nowSecs(),
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : nowSecs(),
    };
    if (!profile.id.trim() || !profile.gameId.trim() || !profile.name.trim()) {
      throw new Error("invalid_profile: id, game id, and name are required");
    }
    const valid = new Set(listModsForGame(profile.gameId).map((row) => row.id));
    if (profile.loadOrder.some((id) => !valid.has(id))) {
      throw new Error("invalid_profile: load order contains a mod from another game");
    }
    upsertProfile(profile);
    return null;
  },

  mods_profile_delete: (args) => {
    const profileId = text(args, "profileId");
    if (!profileId.trim()) throw new Error("invalid_profile: profile id is required");
    deleteModProfile(profileId);
    return null;
  },

  mods_check_updates: async (args) => {
    const gameId = text(args, "gameId");
    // Nexus first, but a missing key or a failed lookup must not block the
    // remaining checks (the Rust command swallowed the Nexus error too).
    try {
      await runNexusUpdatePass(gameId);
    } catch (error) {
      console.error("[mods] Nexus update pass failed:", error);
    }
    await runOtherSourcePass(gameId);
    return payloadFor(gameId);
  },

  mods_update_mod: async (args) => {
    const modId = text(args, "modId");
    const mod = getMod(modId);
    if (!mod) throw new Error(`Mod not found: ${modId}`);
    const source = mod.source?.trim();
    if (!source) throw new Error("update_source_missing: this mod has no remote source");
    const remoteId = mod.sourceModId?.trim();
    if (!remoteId) throw new Error("update_source_missing: this mod has no remote id");
    if (source !== "nexus") {
      throw new Error(
        `update_source_missing: ${source} updates are not available in the Electron build yet`,
      );
    }
    const domain = mod.nexusDomain ?? storedDomain(mod.gameId);
    if (!domain) throw new Error("update_source_missing: no Nexus domain for this game");
    const key = modsNexus.getApiKey();
    if (!key) throw new Error("Nexus Mods API key not set — add it in Settings → Mods");

    const detail = await modsNexus.detail(key, domain, remoteId);
    const file = detail.files.find((entry) => entry.isPrimary) ?? detail.files[0];
    if (!file) throw new Error("update_source_missing: the source lists no files");

    const result = await downloadSource({
      gameId: mod.gameId,
      source,
      externalId: domain,
      modId: remoteId,
      fileId: file.id,
      name: mod.name,
      author: mod.author ?? detail.summary.author ?? null,
      version: file.version ?? detail.summary.version ?? null,
      remoteUrl: detail.summary.url,
      destination: null,
    });

    if (result.status === "installed") {
      const latest = file.version ?? detail.summary.version;
      const next: ModRow = {
        ...mod,
        ...(latest ? { latestVersion: latest } : {}),
        updateAvailable: false,
        updatedAt: nowSecs(),
      };
      upsertMod(next);
    }
    return result;
  },

  // ── Nexus ─────────────────────────────────────────────────────────
  nexus_set_api_key: (args) => {
    const key = optionalText(args, "key") ?? optionalText(args, "apiKey") ?? "";
    modsNexus.setApiKey(key);
    return null;
  },

  nexus_get_status: async () => {
    const key = modsNexus.getApiKey();
    if (!key) return { connected: false };
    return modsNexus.validate(key);
  },

  nexus_premium_status: () => modsNexus.isPremiumCached(),

  nexus_check_updates: async (args) => {
    const gameId = text(args, "gameId");
    if (!modsNexus.getApiKey()) {
      throw new Error(
        "Nexus Mods API key not set — add it in Settings → Mods to check for updates",
      );
    }
    await runNexusUpdatePass(gameId);
    return payloadFor(gameId);
  },

  // ── Discover sources ──────────────────────────────────────────────
  mods_sources_detect: (args) =>
    detectSources(text(args, "gameId"), flag(args, "resolve", true)),

  mods_source_status: (args) =>
    detectSources(optionalText(args, "gameId") ?? "", false),

  mods_source_set_credential: (args) => {
    const source = text(args, "source");
    const key = text(args, "key");
    if (source !== "nexus") {
      throw new Error(`${source} does not use an API key`);
    }
    modsNexus.setApiKey(key);
    return null;
  },

  mods_source_set_link: (args) => {
    setSourceLink(
      text(args, "gameId"),
      text(args, "source"),
      text(args, "externalId"),
      optionalText(args, "displayName"),
    );
    return null;
  },

  mods_source_clear_link: (args) => {
    clearSourceLink(text(args, "gameId"), text(args, "source"));
    return null;
  },

  mods_source_browse: (args) =>
    browseSource(
      text(args, "source"),
      text(args, "externalId"),
      text(args, "query"),
      optionalText(args, "sort") ?? "trending",
      typeof args.page === "number" ? args.page : 1,
      typeof args.pageSize === "number" ? Math.min(60, Math.max(1, args.pageSize)) : 24,
    ),

  mods_source_detail: (args) =>
    detailSource(text(args, "source"), text(args, "externalId"), text(args, "modId")),

  mods_source_download: (args) =>
    downloadSource({
      gameId: text(args, "gameId"),
      source: text(args, "source"),
      externalId: text(args, "externalId"),
      modId: text(args, "modId"),
      fileId: optionalText(args, "fileId"),
      name: optionalText(args, "name"),
      author: optionalText(args, "author"),
      version: optionalText(args, "version"),
      remoteUrl: optionalText(args, "remoteUrl"),
      destination: optionalText(args, "destination"),
    }),

  mods_remote_installs: (args) => listRemoteInstalls(text(args, "gameId")),

  mods_remote_install_remove: (args) => {
    deleteRemoteInstall(text(args, "id"));
    return null;
  },
};


export function registerMo2Commands(): void {
  registerCommands(mo2Commands, { override: true });
}
