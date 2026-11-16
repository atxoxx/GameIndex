/**
 * In-app update commands.
 *
 * `electron-updater` handles installed bundles (NSIS, AppImage); the portable
 * Windows build stages a new executable and swaps it on exit. The renderer only
 * sees a stable command surface, mirroring the old Tauri updater plugin.
 */
import { registerCommands, type CommandHandler } from "../ipc";
import {
  applyPortableUpdate,
  checkForUpdates,
  downloadUpdate,
  getUpdaterInstallInfo,
  installUpdate,
} from "../features/updater";

const updaterCommands: Record<string, CommandHandler> = {
  /** How this build receives updates (dev, nsis, portable, appimage, deb). */
  updater_install_info: () => getUpdaterInstallInfo(),

  /** Ask the matching feed whether a newer version exists. */
  updater_check: () => checkForUpdates(),

  /** Download the installer through electron-updater (progress via events). */
  updater_download: async () => {
    await downloadUpdate();
    return null;
  },

  /** Quit and install the downloaded NSIS/AppImage update. */
  updater_install: () => {
    installUpdate();
    return null;
  },

  /** Swap the staged portable executable and relaunch. */
  portable_update_apply: async (args) => {
    const stagedPath = typeof args.stagedPath === "string" ? args.stagedPath : "";
    await applyPortableUpdate(stagedPath, args.relaunch !== false);
    return null;
  },
};

export function registerUpdaterCommands(): void {
  registerCommands(updaterCommands, { override: true });
}
