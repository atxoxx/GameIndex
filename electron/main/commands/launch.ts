/**
 * Launching games, process watching and play-session lifecycle.
 *
 * Workstream: `launch`. See `STUBS_BY_AREA.md` → "launch" and
 * `ARCHITECTURE.md` for the rules. Reference: `git show HEAD:src-tauri/src/launcher.rs`,
 * `game_watcher/`, `steam_game_watcher.rs`, `sessions.rs`.
 *
 * Implemented here:
 *
 *   launch_game · force_close_game · rebuild_watcher_index
 *   scan_folders_for_exes · cancel_scan_exes
 *   move_game_install · uninstall_game
 *
 * Everything else in the launch bucket belongs to another domain and stays
 * stubbed: `scan_orphaned_artwork` (artwork store), `scan_emulator_roms` and
 * `import_emulators_config` (emulator DB).
 */
import { registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import { installLaunchLifecycle } from "../features/launch/watcher";
import { cancelMoveGame } from "../features/launch/move";
import { moveGameInstall, uninstallGame } from "../features/launch/move";
import { cancelExeScans, scanFoldersForExes } from "../features/launch/scan";
import { forceCloseGame } from "../features/launch/forceClose";
import { launchGame } from "../features/launch/launchGame";
import { rebuildWatcherIndex } from "../features/launch/watcher";
import type { GameRefInput } from "../features/launch/types";

function readGameRefs(args: CommandArgs): GameRefInput[] {
  const raw = args.games;
  if (!Array.isArray(raw)) return [];
  const refs: GameRefInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const gameId = typeof value.gameId === "string" ? value.gameId : "";
    if (!gameId) continue;
    const steamAppId =
      typeof value.steamAppId === "number" && Number.isFinite(value.steamAppId)
        ? value.steamAppId
        : null;
    refs.push({
      gameId,
      gameName: typeof value.gameName === "string" ? value.gameName : "",
      platform: typeof value.platform === "string" ? value.platform : "",
      exePath: typeof value.exePath === "string" ? value.exePath : "",
      steamAppId,
      installed: value.installed !== false,
      emulatorId: typeof value.emulatorId === "string" ? value.emulatorId : null,
    });
  }
  return refs;
}

export const launchCommands: Record<string, CommandHandler> = {
  launch_game: (args) => launchGame(args),

  force_close_game: (args) => forceCloseGame(String(args.gameId ?? "")),

  rebuild_watcher_index: async (args) => {
    await rebuildWatcherIndex(readGameRefs(args));
    return null;
  },

  scan_folders_for_exes: (args) => {
    const folders = Array.isArray(args.folderPaths)
      ? args.folderPaths.filter((entry): entry is string => typeof entry === "string")
      : [];
    const scanId = typeof args.scanId === "string" ? args.scanId : null;
    return scanFoldersForExes(folders, scanId);
  },

  cancel_scan_exes: (args) => {
    const scanId = typeof args.scanId === "string" ? args.scanId : null;
    // A move can be cancelled through the same stored flag: the renderer's
    // scan id namespace is free, and `move:<gameId>` is the documented form.
    if (scanId && scanId.startsWith("move:")) {
      cancelMoveGame(scanId.slice("move:".length));
      return null;
    }
    cancelExeScans(scanId);
    return null;
  },

  move_game_install: (args) =>
    moveGameInstall(
      String(args.gameId ?? ""),
      String(args.fromRoot ?? ""),
      String(args.destDir ?? ""),
    ),

  uninstall_game: (args) => uninstallGame(String(args.rootPath ?? "")),
};

export function registerLaunchCommands(): void {
  installLaunchLifecycle();
  registerCommands(launchCommands, { override: true });
}
