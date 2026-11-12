/**
 * Backend command registration.
 *
 * `registerCommandHandlers` installs the real Node/TypeScript implementations,
 * then fills every name in `COMMAND_CATALOG` that is still unhandled with a
 * stub that rejects with a clear message. Stubs are registered last and never
 * override an existing handler, so a feature can be ported incrementally by
 * adding a handler here (or in a sibling module) without touching the catalog.
 */
import { app, shell } from "electron";
import { hasCommand, registerCommands, registerCommand, type CommandHandler } from "../ipc";
import { getAllAppSettings, setAppSetting } from "../state/appSettings";
import { getSurfaces } from "../surfaces";
import { COMMAND_CATALOG } from "./commandCatalog";

/** Implemented commands, grouped by concern. Extend as features are ported. */
import { settingsCommands } from "./settings";
import { libraryCommands } from "./library";
import { overlayCommands } from "./overlay";
import { sessionCommands } from "./sessions";
import { noteCommands } from "./notes";
import { shelfCommands } from "./shelves";
import { wishlistCommands } from "./wishlist";
import { savesCommands } from "./saves";
import { setupCommands } from "./setup";
import { systemCommands } from "./system";
import { fileCommands } from "./files";
import { diagnosticsCommands } from "./diagnostics";
import { registerLaunchCommands } from "./launch";
import { registerStoreCommands } from "./stores";
import { registerMetadataCommands } from "./metadata";
import { registerDownloadCommands } from "./downloads";
import { registerIntegrationCommands } from "./integrations";
import { registerMo2Commands } from "./mo2";
import { registerCompatibilityCommands } from "./compatibility";
import { registerPluginCommands } from "./plugins";
import { registerAchievementCommands } from "./achievements";

export function registerCommandHandlers(): void {
  registerCommands(settingsCommands, { override: true });
  registerCommands(libraryCommands, { override: true });
  registerCommands(sessionCommands, { override: true });
  registerCommands(noteCommands, { override: true });
  registerCommands(shelfCommands, { override: true });
  registerCommands(wishlistCommands, { override: true });
  registerCommands(savesCommands, { override: true });
  registerCommands(setupCommands, { override: true });
  registerCommands(systemCommands, { override: true });
  registerCommands(fileCommands, { override: true });
  registerCommands(overlayCommands, { override: true });
  registerCommands(surfaceCommands, { override: true });
  // Feature workstreams register their own modules before the stub layer runs.
  registerLaunchCommands();
  registerStoreCommands();
  registerMetadataCommands();
  registerDownloadCommands();
  registerCommands(diagnosticsCommands, { override: true });
  registerIntegrationCommands();
  registerMo2Commands();
  registerCompatibilityCommands();
  registerPluginCommands();
  registerAchievementCommands();
  registerStubCommands();
}

/** Window/shell helpers every build needs, independent of the library store. */
const surfaceCommands: Record<string, CommandHandler> = {
  open_folder: (args) => {
    const target = String(args.path ?? args.rootPath ?? "");
    if (target) shell.showItemInFolder(target);
    return null;
  },
  open_url: async (args) => {
    const url = String(args.url ?? "");
    if (url) await shell.openExternal(url);
    return null;
  },
  open_path: async (args) => {
    const target = String(args.path ?? "");
    if (target) {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    }
    return null;
  },
  restore_main_window: () => {
    getSurfaces().revealMainWindow();
    return null;
  },
  close_splashscreen: () => {
    getSurfaces().closeSplashscreen();
    return null;
  },
  open_launch_splash: (args) => {
    getSurfaces().openLaunchSplash(args);
    return null;
  },
  close_launch_splash: () => {
    getSurfaces().closeLaunchSplash();
    return null;
  },
  show_launch_splash_window: () => {
    getSurfaces().showLaunchSplashWindow();
    return null;
  },
  get_launch_splash_state: () => getSurfaces().getLaunchSplashState(),
  retry_launch_splash: () => {
    getSurfaces().retryLaunchSplash();
    return null;
  },
  open_game_detail_window: (args) => {
    getSurfaces().openDetailWindow(String(args.route ?? "/library"), args.title as string | undefined);
    return null;
  },
  get_theme: () => String(getAllAppSettings().theme ?? "dark"),
  get_accent_color: () => String(getAllAppSettings().accent_color ?? ""),
  get_adaptive_palette: () => getAllAppSettings().adaptive_palette ?? null,
  get_language: () => String(getAllAppSettings().language ?? "en"),
  set_theme: (args) => {
    getSurfaces().applyTheme(String(args.theme ?? "dark"));
    return null;
  },
  set_accent_color: (args) => {
    getSurfaces().applyAccentColor(String(args.accent ?? ""));
    return null;
  },
  set_adaptive_palette: (args) => {
    setAppSetting("adaptive_palette", args.palette ?? null);
    return null;
  },
  set_language: (args) => {
    setAppSetting("language", String(args.language ?? "en"));
    return null;
  },
  set_startup_splash_enabled: (args) => {
    setAppSetting("startup_splash", Boolean(args.enabled));
    return null;
  },
  set_close_to_tray_enabled: (args) => {
    getSurfaces().setCloseToTray(Boolean(args.enabled));
    return null;
  },
  set_minimize_on_launch_enabled: (args) => {
    setAppSetting("minimize_on_launch", Boolean(args.enabled));
    return null;
  },
  set_restore_on_exit_enabled: (args) => {
    setAppSetting("restore_on_exit", Boolean(args.enabled));
    return null;
  },
  set_disable_elevation_prompts: (args) => {
    setAppSetting("disable_elevation_prompts", Boolean(args.enabled));
    return null;
  },
  set_discord_presence_enabled: (args) => {
    setAppSetting("discord_presence", Boolean(args.enabled));
    return null;
  },
  set_local_achievements_enabled: (args) => {
    setAppSetting("local_achievements", Boolean(args.enabled));
    return null;
  },
  set_autostart_enabled: (args) => {
    const enabled = Boolean(args.enabled);
    setAppSetting("autostart", enabled);
    if (process.platform === "linux") return null;
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
    return null;
  },
  updater_install_info: () => ({
    target: "windows-x86_64",
    mode: "installer",
    currentVersion: app.getVersion(),
  }),
  portable_update_apply: () => {
    getSurfaces().quit();
    return null;
  },
  portable_update_cancel: () => null,
};

/**
 * Register a rejecting stub for every catalog name that no real handler took.
 * The message is what the renderer sees, so keep it actionable.
 */
/** Names answered only by the generic rejecting stub (for diagnostics/UI). */
const stubbedCommands = new Set<string>();

export function getStubbedCommandNames(): string[] {
  return [...stubbedCommands].sort();
}

function registerStubCommands(): void {
  for (const name of COMMAND_CATALOG) {
    if (hasCommand(name)) continue;
    stubbedCommands.add(name);
    registerCommand(name, () => {
      throw new Error(
        `[gameindex] "${name}" is not implemented in the Electron build yet`,
      );
    });
  }
}
