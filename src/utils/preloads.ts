/**
 * Lazy feature catalogue for intent/idle prefetching.
 *
 * These importers mirror the `lazy(() => import(...))` declarations at the
 * call sites. Warming the module here makes the later lazy render synchronous.
 * Keep the paths in sync when a modal/tab moves.
 */
import { preloadOnce, scheduleIdlePrefetch } from "./preload";

export function preloadCommandPalette(): void {
  preloadOnce("command-palette", () => import("../components/CommandPalette"));
}

export function preloadDownloadModal(): void {
  preloadOnce("download-modal", () => import("../components/DownloadModal"));
}

export function preloadEditGameModal(): void {
  preloadOnce("edit-game-modal", () => import("../components/game/EditGameModal"));
}

export function preloadImportModal(): void {
  preloadOnce("import-modal", () => import("../components/ImportModal"));
}

export function preloadLibraryExportModal(): void {
  preloadOnce("library-export", () =>
    import("../components/library/LibraryExportModal"),
  );
}

export function preloadShelfBuilderModal(): void {
  preloadOnce("shelf-builder", () =>
    import("../components/shelves/ShelfBuilderModal"),
  );
}

export function preloadStoreCompareModal(): void {
  preloadOnce("store-compare", () => import("../components/store/StoreCompareModal"));
}

export function preloadDownloadStatsModal(): void {
  preloadOnce("download-stats", () =>
    import("../components/downloads/DownloadStatsModal"),
  );
}

export function preloadAddDownloadModal(): void {
  preloadOnce("add-download", () =>
    import("../components/downloads/AddDownloadModal"),
  );
}

export function preloadDownloadsScheduledTab(): void {
  preloadOnce("downloads-scheduled", () =>
    import("../components/downloads/DownloadsScheduledTab"),
  );
}

export function preloadDownloadPopover(): void {
  preloadOnce("download-popover", () => import("../components/DownloadPopover"));
}

export function preloadLibraryFilterPopover(): void {
  preloadOnce("library-filter-popover", () =>
    import("../components/library/LibraryFilterPopover"),
  );
}

export function preloadActivityPerformance(): void {
  preloadOnce("activity-performance", () =>
    import("../components/activity/ActivityPerformance"),
  );
}

export function preloadWrappedView(): void {
  preloadOnce("activity-wrapped", () => import("../pages/activity/WrappedView"));
}

export function preloadVrModsTab(): void {
  preloadOnce("vr-mods-tab", () => import("../pages/ports/vrMods/VrModsTab"));
}

export function preloadEmulatorEditorModal(): void {
  preloadOnce("emulator-editor", () => import("../pages/EmulatorEditorModal"));
}

export function preloadFolderScanModal(): void {
  preloadOnce("folder-scan", () =>
    import("../components/library/FolderScanProgressModal"),
  );
}

export function preloadSidebarFilterPopover(): void {
  preloadOnce("sidebar-filter", () => import("../components/SidebarFilterPopover"));
}

const SETTINGS_TAB_IMPORTERS: Readonly<Record<string, () => Promise<unknown>>> = {
  general: () => import("../pages/settings/GeneralTab"),
  appearance: () => import("../pages/settings/AppearanceTab"),
  interface: () => import("../pages/settings/InterfaceTab"),
  hardware: () => import("../pages/settings/HardwareTab"),
  integrations: () => import("../pages/settings/IntegrationsTab"),
  discord: () => import("../pages/settings/DiscordTab"),
  downloads: () => import("../pages/settings/DownloadsTab"),
  plugins: () => import("../pages/settings/PluginsTab"),
  launcher: () => import("../pages/settings/LauncherTab"),
  privacy: () => import("../pages/settings/PrivacyTab"),
  backup: () => import("../pages/settings/BackupTab"),
  saves: () => import("../pages/settings/SavesTab"),
  diagnostics: () => import("../pages/settings/DiagnosticsTab"),
  overlay: () => import("../pages/settings/OverlayTab"),
  compatibility: () => import("../pages/settings/CompatibilityTab"),
};

export function preloadSettingsTab(tab: string | undefined | null): void {
  if (!tab) return;
  const load = SETTINGS_TAB_IMPORTERS[tab];
  if (load) preloadOnce(`settings-tab:${tab}`, load);
}

const GAME_TAB_IMPORTERS: Readonly<Record<string, () => Promise<unknown>>> = {
  reviews: () => import("../components/reviews/ReviewsTab"),
  achievements: () => import("../components/AchievementsTab"),
  weblinks: () => import("../components/WebLinksTab"),
  news: () => import("../components/game/GameNewsTab"),
  map: () => import("../components/game/MapTab"),
  notes: () => import("../components/game/notes/NotesTab"),
  dlc: () => import("../components/game/dlc/DlcTab"),
  activity: () => import("../components/game/GameActivityTab"),
  mods: () => import("../components/mods/ModsTab"),
  saves: () => import("../components/game/SaveBackupTab"),
};

export function preloadGameTab(tab: string | undefined | null): void {
  if (!tab) return;
  const load = GAME_TAB_IMPORTERS[tab];
  if (load) preloadOnce(`game-tab:${tab}`, load);
}

/**
 * Warm the dialogs users open most, after the shell is interactive.
 * Ordered by expected first use; spaced so no burst competes with a render.
 */
export function scheduleCorePrefetch(): () => void {
  return scheduleIdlePrefetch(
    [
      preloadCommandPalette,
      preloadDownloadModal,
      preloadDownloadPopover,
      preloadEditGameModal,
      preloadImportModal,
      preloadStoreCompareModal,
      preloadDownloadStatsModal,
      preloadAddDownloadModal,
      preloadEmulatorEditorModal,
    ],
    3_500,
    350,
  );
}
