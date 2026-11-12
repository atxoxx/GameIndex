/**
 * Emulators and ROMs: registry, discovery, libraries, ROM saves, BIOS, installs.
 *
 * Workstream: `emulators`. Reference (deleted from the tree, in git):
 * `src-tauri/src/roms.rs`, `emulation.rs`, `emulator_health.rs`,
 * `emulator_install.rs`, `db/emulators.rs`.
 *
 * Every handler is argument normalization plus one call into
 * `features/emulators/**`, which keeps the logic testable outside Electron.
 */
import { registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import { deleteGames, listGames } from "../state/libraryStore";
import { checkAllBios, checkBios } from "../features/emulators/bios";
import { discoverEmulators, discoverRomFolders, healthScan } from "../features/emulators/discovery";
import { listEmulatorDownloads } from "../features/emulators/catalog";
import { finishEmulatorInstall, startEmulatorInstall } from "../features/emulators/install";
import { romLaunchPlan } from "../features/emulators/launchPlan";
import {
  addRomFile,
  findDuplicateRoms,
  recalcRomSizes,
  renameRomFile,
  scanEmulatorRoms,
} from "../features/emulators/library";
import {
  applyRomMetadata,
  enrichEmulatorMetadata,
  identifyRom,
  saveRomProfile,
  scrapeRomMetadata,
} from "../features/emulators/metadata";
import {
  backupSaves,
  deleteSnapshot,
  listSaves,
  listSnapshots,
  restoreSaves,
  savesStatus,
} from "../features/emulators/saves";
import {
  deleteEmulator,
  exportEmulatorsConfig,
  getEmulator,
  importEmulatorsConfig,
  listEmulators,
  saveEmulator,
} from "../features/emulators/store";
import { startRomWatcher } from "../features/emulators/watcher";

function text(args: CommandArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(args: CommandArgs, key: string): string | undefined {
  const value = text(args, key);
  return value.length > 0 ? value : undefined;
}

function flag(args: CommandArgs, key: string, fallback = false): boolean {
  const value = args[key];
  return typeof value === "boolean" ? value : fallback;
}

export const emulatorCommands: Record<string, CommandHandler> = {
  // ── Registry ────────────────────────────────────────────────────────
  list_emulators: () => listEmulators(),

  save_emulator: (args) => saveEmulator(args.emulator),

  delete_emulator: (args) => {
    const id = text(args, "id").trim();
    if (!id) throw new Error("delete_emulator requires an id");
    // Cascade: the Rust command removed every scanned ROM of the emulator.
    const romIds = listGames()
      .filter((game) => game.emulatorId === id)
      .map((game) => game.id);
    if (romIds.length > 0) deleteGames(romIds);
    deleteEmulator(id);
    return null;
  },

  export_emulators_config: () => exportEmulatorsConfig(),

  import_emulators_config: (args) => importEmulatorsConfig(text(args, "json")),

  // ── Discovery ───────────────────────────────────────────────────────
  discover_emulators: () => discoverEmulators(),

  discover_rom_folders: (args) => discoverRomFolders(optionalText(args, "emulatorId")),

  emulator_health_scan: (args) => healthScan(flag(args, "deep")),

  // ── ROM library ─────────────────────────────────────────────────────
  scan_emulator_roms: (args) => {
    const emulatorId = text(args, "emulatorId").trim();
    if (!emulatorId) throw new Error("scan_emulator_roms requires an emulatorId");
    return scanEmulatorRoms(emulatorId);
  },

  add_rom_file: (args) => {
    const emulatorId = text(args, "emulatorId").trim();
    const filePath = text(args, "path").trim();
    if (!emulatorId) throw new Error("add_rom_file requires an emulatorId");
    if (!filePath) throw new Error("add_rom_file requires a path");
    return addRomFile(emulatorId, filePath);
  },

  rename_rom_file: (args) => {
    const gameId = text(args, "gameId").trim();
    if (!gameId) throw new Error("rename_rom_file requires a gameId");
    return renameRomFile(gameId, text(args, "newName"));
  },

  recalc_rom_sizes: (args) => {
    const emulatorId = text(args, "emulatorId").trim();
    if (!emulatorId) throw new Error("recalc_rom_sizes requires an emulatorId");
    return recalcRomSizes(emulatorId);
  },

  find_duplicate_roms: (args) => findDuplicateRoms(optionalText(args, "emulatorId")),

  // ── Identification / metadata ───────────────────────────────────────
  rom_identify: (args) => identifyRom(text(args, "gameId")),

  rom_scrape_metadata: (args) => scrapeRomMetadata(text(args, "gameId")),

  rom_apply_metadata: (args) => applyRomMetadata(text(args, "gameId"), args.patch),

  enrich_emulator_metadata: (args) => {
    const emulatorId = text(args, "emulatorId").trim();
    if (!emulatorId) throw new Error("enrich_emulator_metadata requires an emulatorId");
    return enrichEmulatorMetadata(emulatorId, flag(args, "onlyMissing", true));
  },

  rom_profile_save: (args) => saveRomProfile(text(args, "gameId"), args.profile),

  // ── Launch plan ─────────────────────────────────────────────────────
  rom_launch_plan: (args) => romLaunchPlan(text(args, "gameId")),

  // ── ROM saves ───────────────────────────────────────────────────────
  rom_saves_status: (args) => savesStatus(text(args, "gameId")),
  rom_saves_list: (args) => listSaves(text(args, "gameId")),
  rom_saves_snapshots: (args) => listSnapshots(text(args, "gameId")),
  rom_saves_backup: (args) => backupSaves(text(args, "gameId"), optionalText(args, "name")),
  rom_saves_restore: (args) =>
    restoreSaves(text(args, "gameId"), text(args, "name").trim()),
  rom_saves_delete: async (args) => {
    await deleteSnapshot(text(args, "gameId"), text(args, "name").trim());
    return null;
  },

  // ── BIOS ────────────────────────────────────────────────────────────
  check_bios_status: async (args) => {
    const emulatorId = text(args, "emulatorId").trim();
    const emulator = getEmulator(emulatorId);
    if (!emulator) throw new Error(`Emulator not found: ${emulatorId}`);
    return checkBios(emulator);
  },

  check_all_bios_status: () => checkAllBios(),

  // ── Downloads / install ─────────────────────────────────────────────
  list_emulator_downloads: () => listEmulatorDownloads(),

  start_emulator_install: (args) => {
    const key = text(args, "emulatorKey").trim();
    if (!key) throw new Error("start_emulator_install requires an emulatorKey");
    return startEmulatorInstall(key, text(args, "installDir"));
  },

  finish_emulator_install: (args) => {
    const downloadId = text(args, "downloadId").trim();
    if (!downloadId) throw new Error("finish_emulator_install requires a downloadId");
    return finishEmulatorInstall(downloadId, args.emulator);
  },
};

export function registerEmulatorCommands(): void {
  registerCommands(emulatorCommands, { override: true });
  startRomWatcher();
}
