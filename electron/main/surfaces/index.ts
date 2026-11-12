/**
 * Surface wiring: one place that knows which windows exist and how they are
 * opened. The command layer consumes `getSurfaces()`.
 */
import { app, nativeTheme } from "electron";
import { emit } from "../ipc";
import { markQuitting } from "../quitState";
import { getAppSetting, setAppSetting } from "../state/appSettings";
import {
  allowMainWindowClose,
  createMainWindow,
  getMainWindow,
  installMainWindowLifecycle,
  revealMainWindow,
} from "./mainWindow";
import { createBootSplash, closeBootSplash, getSplashWindow } from "./splash";
import {
  closeLaunchSplash,
  getLaunchSplashState,
  openLaunchSplash,
  registerLaunchSplashCommands,
  retryLaunchSplash,
  showLaunchSplashWindow,
  updateLaunchSplashStatus,
} from "./launchSplash";
import { openDetailWindow } from "./detailWindow";
import {
  createOverlayWindow,
  getOverlayWindow,
  hideOverlay,
  installOverlay,
  showOverlay,
} from "./overlay";
import {
  destroyTray,
  installTray,
  isCloseToTrayEnabled,
  isTrayAvailable,
  refreshTrayMenu,
  setCloseToTray,
} from "./tray";
import { installEmbeddedWebviews } from "./webviews";
import type { AppSurfaces, LaunchSplashArgs } from "./types";

export type { AppSurfaces, LaunchSplashArgs } from "./types";

let surfaces: AppSurfaces | null = null;

export function getSurfaces(): AppSurfaces {
  if (!surfaces) {
    throw new Error("[surfaces] requested before createSurfaces()");
  }
  return surfaces;
}

const BOOT_SPLASH_FAILSAFE_MS = 12_000;

export async function createSurfaces(): Promise<AppSurfaces> {
  installTray();
  installEmbeddedWebviews();
  installMainWindowLifecycle();
  installOverlay();
  registerLaunchSplashCommands();

  const impl: AppSurfaces = {
    async boot() {
      const startupSplash = Boolean(getAppSetting("startup_splash"));
      if (startupSplash) {
        createBootSplash();
        // Never strand the user behind a splash that failed to load.
        setTimeout(() => {
          if (getSplashWindow()) {
            closeBootSplash();
            revealMainWindow();
          }
        }, BOOT_SPLASH_FAILSAFE_MS);
      }

      const main = createMainWindow();
      // Keep the tray's Show/Hide pair in step with the real window state.
      main.on("show", refreshTrayMenu);
      main.on("hide", refreshTrayMenu);

      if (!startupSplash) {
        if (main.isVisible()) return;
        main.once("ready-to-show", () => {
          if (!main.isDestroyed()) main.show();
        });
        // If the page is already loaded (fast local file), ready-to-show may
        // have fired before we attached the listener.
        if (!main.webContents.isLoading()) main.show();
      }
    },

    getMainWindow,
    revealMainWindow,
    closeSplashscreen() {
      closeBootSplash();
      revealMainWindow();
    },

    openLaunchSplash: (args: LaunchSplashArgs) => openLaunchSplash(args),
    closeLaunchSplash,
    getLaunchSplashState,
    showLaunchSplashWindow,
    retryLaunchSplash,

    openDetailWindow,

    showOverlay,
    hideOverlay,
    getOverlayWindow,

    applyTheme(theme: string) {
      nativeTheme.themeSource =
        theme === "light" ? "light" : theme === "system" ? "system" : "dark";
      setAppSetting("theme", theme);
      emit("theme:changed", theme);
    },

    applyAccentColor(color: string) {
      setAppSetting("accent_color", color);
    },

    setCloseToTray,
    isTrayActive: isTrayAvailable,
    shouldKeepRunningInTray() {
      return isCloseToTrayEnabled() && isTrayAvailable();
    },

    quit() {
      markQuitting();
      allowMainWindowClose();
      destroyTray();
      app.quit();
    },
  };

  surfaces = impl;
  return impl;
}

/** Test/teardown helper. */
export function resetSurfaces(): void {
  surfaces = null;
}

// Keep the overlay module referenced so bundlers do not drop it when only the
// command layer touches it.
export { createOverlayWindow, updateLaunchSplashStatus };
