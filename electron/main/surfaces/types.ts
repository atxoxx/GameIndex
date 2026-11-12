import type { BrowserWindow } from "electron";
import type { LaunchSplashSnapshot } from "./launchSplash";

export interface LaunchSplashArgs {
  payload?: unknown;
  gameId?: string;
  startedAt?: number;
  [key: string]: unknown;
}

/**
 * The window layer, as seen by the command layer.
 *
 * Commands never import a specific window module: they ask these surfaces, so
 * "close the splash", "open the popout", or "show the overlay" stay one call
 * away from the 400+ command handlers.
 */
export interface AppSurfaces {
  /** Create the boot splash (when enabled) and the main window. */
  boot(): Promise<void>;

  getMainWindow(): BrowserWindow | null;
  revealMainWindow(): void;
  /** Renderer has hydrated: drop the splash and show the main window. */
  closeSplashscreen(): void;

  openLaunchSplash(args: LaunchSplashArgs): void;
  closeLaunchSplash(): void;
  getLaunchSplashState(): LaunchSplashSnapshot | null;
  showLaunchSplashWindow(): void;
  retryLaunchSplash(): void;

  openDetailWindow(route: string, title?: string): void;

  showOverlay(): void;
  hideOverlay(): void;
  getOverlayWindow(): BrowserWindow | null;

  applyTheme(theme: string): void;
  applyAccentColor(color: string): void;

  setCloseToTray(enabled: boolean): void;
  isTrayActive(): boolean;
  /** True when closing every window should keep the app in the tray. */
  shouldKeepRunningInTray(): boolean;

  quit(): void;
}
