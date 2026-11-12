/**
 * Settings / preference commands persisted by the main process.
 *
 * Values live in `app-settings.json` (see `state/appSettings.ts`). The boot
 * toggles (theme, accent, language, close-to-tray, splash, autostart) are
 * already wired in `commands/index.ts`; this module fills the read side the
 * Settings page needs on mount plus a couple of small kv-backed documents.
 */
import { app } from "electron";
import type { CommandHandler } from "../ipc";
import { getAppSetting, setAppSetting } from "../state/appSettings";

const MAX_BIGSCREEN_PREFS_BYTES = 8 * 1024;

export const settingsCommands: Record<string, CommandHandler> = {
  /**
   * Hydrated by `SettingsContext` on mount. The Rust struct used camelCase
   * fields; keep the same shape and map from the snake_case app-settings keys.
   */
  get_launcher_settings: () => ({
    closeToTrayEnabled: Boolean(getAppSetting("close_to_tray")),
    minimizeOnLaunchEnabled: Boolean(getAppSetting("minimize_on_launch")),
    restoreOnExitEnabled: Boolean(getAppSetting("restore_on_exit")),
    disableElevationPrompts: Boolean(getAppSetting("disable_elevation_prompts")),
    startupSplashEnabled: Boolean(getAppSetting("startup_splash")),
  }),

  /** Actual OS login-item state, not just the persisted preference. */
  is_autostart_enabled: () => {
    try {
      // Electron's login-item API is only meaningful on Windows/macOS; the
      // Linux setter in `commands/index.ts` deliberately persists the
      // preference instead of installing a desktop entry.
      if (process.platform === "linux") return Boolean(getAppSetting("autostart"));
      return Boolean(app.getLoginItemSettings().openAtLogin);
    } catch (error) {
      console.warn("[settings] could not read autostart state:", error);
      return Boolean(getAppSetting("autostart"));
    }
  },

  /**
   * Telemetry configuration. The game watcher is not part of this pass, but
   * persisting the object keeps the Hardware tab's controls meaningful and
   * ready for the watcher port.
   */
  set_metrics_config: (args) => {
    const config = args.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("set_metrics_config expects a `config` object");
    }
    setAppSetting("metrics_config", config);
    return null;
  },

  /** Big Screen layout preferences: opaque JSON, stored verbatim. */
  bigscreen_prefs_get: () => {
    const stored = getAppSetting("bigscreen_prefs");
    return typeof stored === "string" ? stored : null;
  },

  bigscreen_prefs_set: (args) => {
    const json = args.json;
    if (typeof json !== "string") throw new Error("bigscreen_prefs_set expects a JSON string");
    if (json.length > MAX_BIGSCREEN_PREFS_BYTES) {
      throw new Error(
        `bigscreen prefs payload too large (${json.length} > ${MAX_BIGSCREEN_PREFS_BYTES} bytes)`,
      );
    }
    setAppSetting("bigscreen_prefs", json);
    return null;
  },

  /**
   * Source links are a first-run-empty list: no source backend is ported yet.
   * Returning `[]` is the normal "nothing configured" state, not fake data, so
   * the Settings page renders its empty state instead of an error toast.
   */
  sources_list: () => [],

  /** Download history: the torrent engine is not ported, so no rows exist. */
  download_history_get: () => [],
};
