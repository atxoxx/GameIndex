// SettingsContext — single source of truth for every new
// user-configurable setting introduced in this drop. Consolidates both
// the Rust-backed launcher settings (close-to-tray, minimize-on-launch,
// disable UAC, OS auto-launch) and the localStorage-backed knobs
// (landing page, accent color, per-vendor sync intervals, Steam
// auto-detect, achievement privacy, Discord rich presence, player-
// count history retention cap, source domain blocklist) so the
// SettingsPage can read from a single hook and every consumer agrees
// on the value.
//
// Architecture: this is intentionally a "client-side" context. The
// localStorage values are mirrored to React state so renders stay
// fast (no async reads in render paths) and the writes update both
// the React state and the storage layer in the same tick so the two
// never disagree. The Rust-backed values are fetched once on mount
// and refreshed after every setter call; shared state with the
// backend is durable because the Rust commands persist each toggle
// to the kv_store on update (see lib.rs::set_*_enabled).
//
// The defaults match the design's "opt-in" stance: every new toggle
// is OFF by default so the upgrade is silent for existing users.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { applyAccentFamily } from "../utils/color";
import { clampDeadzone } from "../hooks/gamepad/gamepadUtils";
import { updateSoundConfig } from "../utils/soundEffects";

// ── LocalStorage keys (one per localStorage-backed setting) ─────────────────
//
// Append-only — never rename a key here without a migration. A
// existing user upgrading from an older build will simply see the
// default for the renamed setting, which is the safer failure mode
// (we never want to silently revert a user's intent).

const LS_LANDING_PAGE = "gamelib.landing_page";
const LS_ACCENT_COLOR = "gamelib.accent_color";
const LS_AUTO_GAME_ACCENT = "gamelib.auto_game_accent";
const LS_UI_SOUND_ENABLED = "gamelib.ui_sound_enabled";
const LS_UI_SOUND_VOLUME = "gamelib.ui_sound_volume";
const LS_SYNC_INTERVAL = "gamelib.sync_interval_minutes";
const LS_STEAM_AUTO_DETECT = "gamelib.steam_auto_detect_enabled";
const LS_ACHIEVEMENT_PRIVACY = "gamelib.hide_achievement_progress";
const LS_DISCORD_PRESENCE = "gamelib.discord_rich_presence_enabled";
// Per-option Discord Rich Presence toggles (Settings → Discord tab).
// Exported so the presence emitters (useSessions, which lives above this
// provider in the tree) can read the persisted choice without the hook.
export const LS_DISCORD_SHOW_ART = "gamelib.discord_show_art";
export const LS_DISCORD_SHOW_PLAYTIME = "gamelib.discord_show_playtime";
export const LS_DISCORD_SHOW_WEBSITE_BUTTON = "gamelib.discord_show_website_button";
export const LS_DISCORD_SHOW_BROWSING = "gamelib.discord_show_browsing";
const LS_HISTORY_CAP_DAYS = "gamelib.player_count_history_cap_days";
const LS_BLOCKED_DOMAINS = "gamelib.blocked_source_domains";

// Friends (Settings → Privacy → Friends)
const LS_FRIENDS_NOTIFICATIONS = "gamelib.friends.notifications_enabled";
const LS_DM_READ_RECEIPTS = "gamelib.friends.read_receipts_enabled";

// Hardware monitoring (Settings → Hardware tab)
const LS_HW_MONITORING = "gamelib.hardware_monitoring_enabled";
const LS_METRIC_CAPTURE = "gamelib.metric_capture";
const LS_SAMPLING_SEC = "gamelib.metrics_sampling_interval_sec";
const LS_TEMP_UNIT = "gamelib.temp_unit";

// Big Screen controller (gamepad stick deadzones; null = auto-calibrate)
const LS_GAMEPAD_LEFT_DEADZONE = "gamelib.gamepad_left_deadzone";
const LS_GAMEPAD_RIGHT_DEADZONE = "gamelib.gamepad_right_deadzone";

// Interface & Navigation (Settings → Appearance)
const LS_COMMAND_PALETTE_MODE = "gamelib.command_palette_mode";
const LS_NAVBAR_MODE = "gamelib.navbar_mode";
const LS_UI_DENSITY_MODE = "gamelib.ui_density_mode";
const LS_UI_SCALE = "gamelib.ui_scale";
// Set on the very first launch so brand-new users can be defaulted into
// Simple UI mode for approachability, while anyone who has ever run the
// app keeps whatever they last chose. Append-only, like every other key.
const LS_FIRST_LAUNCH = "gamelib.first_launch";
const LS_REDUCE_MOTION = "gamelib.reduce_motion";
const LS_SHOW_CARD_BADGES = "gamelib.show_card_badges";
const LS_SHOW_GAME_ART_BACKDROP = "gamelib.show_game_art_backdrop";
const LS_SHOW_NAVBAR_NOW_PLAYING = "gamelib.show_navbar_now_playing";
// Game & Store detail-page section visibility (Settings → Appearance).
const LS_DETAIL_SECTIONS_VISIBLE = "gamelib.detail_sections_visible";

// ── Public shape ─────────────────────────────────────────────────────────────

export type LandingPage =
  | "home"
  | "library"
  | "store"
  | "wishlist"
  | "deals"
  | "activity"
  | "achievements"
  | "downloads"
  | "storage"
  | "news"
  | "community";

export type SyncIntervalMinutes = 0 | 15 | 30 | 60 | 360 | 720 | 1440;

/** Connection state of the Discord presence thread, tracked from
 *  `discord-presence-status` events so Settings can show "Discord is
 *  not running" when the desktop app is closed. */
export type DiscordStatus = "idle" | "connected" | "notRunning";

/** Which individual telemetry streams to record during a session. */
export interface MetricCapture {
  fps: boolean;
  cpu: boolean;
  gpu: boolean;
  ram: boolean;
  cpuTemp: boolean;
  gpuTemp: boolean;
}

/** Temperature display unit for every hardware readout in the UI. */
export type TempUnit = "c" | "f";

export type CommandPaletteMode = "simple" | "full";
export type NavbarMode = "compact" | "full";
export type UiDensityMode = "simple" | "complete";
export type UiScale = "auto" | "85" | "100" | "110" | "125" | "150" | "175" | "200";


/** Individual detail-page sections that can be hidden via settings.
 *  Mirrors the sections rendered on the game detail and store pages.
 *  Each key is persisted independently in localStorage. */
export type DetailSectionKey =
  | "systemRequirements"
  | "gameRelations"
  | "timeToBeat"
  | "protonDb"
  | "releases"
  | "reviews"
  | "activity"
  | "achievements"
  | "mods"
  | "weblinks"
  | "news";

export type DetailSectionVisibility = Record<DetailSectionKey, boolean>;

export interface SettingsContextValue {
  // ── Launcher (Rust-backed) ───────────────────────────────────────
  closeToTray: boolean;
  setCloseToTray: (next: boolean) => Promise<void>;
  minimizeOnLaunch: boolean;
  setMinimizeOnLaunch: (next: boolean) => Promise<void>;
  restoreOnExit: boolean;
  setRestoreOnExit: (next: boolean) => Promise<void>;
  disableElevationPrompts: boolean;
  setDisableElevationPrompts: (next: boolean) => Promise<void>;
  autoStartEnabled: boolean;
  setAutoStartEnabled: (next: boolean) => Promise<void>;

  // ── LocalStorage-backed ─────────────────────────────────────────
  landingPage: LandingPage;
  setLandingPage: (next: LandingPage) => void;
  accentColor: string | null;
  setAccentColor: (next: string | null) => void;
  autoGameAccent: boolean;
  setAutoGameAccent: (next: boolean) => void;
  uiSoundEnabled: boolean;
  setUiSoundEnabled: (next: boolean) => void;
  uiSoundVolume: number;
  setUiSoundVolume: (next: number) => void;
  syncIntervalMinutes: SyncIntervalMinutes;
  setSyncIntervalMinutes: (next: SyncIntervalMinutes) => void;
  steamAutoDetect: boolean;
  setSteamAutoDetect: (next: boolean) => void;
  hideAchievementProgress: boolean;
  setHideAchievementProgress: (next: boolean) => void;
  discordRichPresence: boolean;
  setDiscordRichPresence: (next: boolean) => void;
  discordStatus: DiscordStatus;
  /** Whether the game cover art (large image) is shown while playing. */
  discordShowArt: boolean;
  setDiscordShowArt: (next: boolean) => void;
  /** Whether total playtime + the live session timer are shown while playing. */
  discordShowPlaytime: boolean;
  setDiscordShowPlaytime: (next: boolean) => void;
  /** Whether the "View Website" presence button is attached while playing. */
  discordShowWebsiteButton: boolean;
  setDiscordShowWebsiteButton: (next: boolean) => void;
  /** Whether the "browsing" activity (which page you're on) is broadcast. */
  discordShowBrowsing: boolean;
  setDiscordShowBrowsing: (next: boolean) => void;
  historyCapDays: 1 | 7 | 30;
  setHistoryCapDays: (next: 1 | 7 | 30) => void;
  blockedSourceDomains: string[];
  setBlockedSourceDomains: (next: string[]) => void;

  // ── Friends (Settings → Privacy → Friends) ─────────────────────
  friendsNotifications: boolean;
  setFriendsNotifications: (next: boolean) => void;
  dmReadReceipts: boolean;
  setDmReadReceipts: (next: boolean) => void;

  // ── Hardware monitoring (Settings → Hardware tab) ───────────────
  hardwareMonitoringEnabled: boolean;
  setHardwareMonitoringEnabled: (next: boolean) => void;
  metricCapture: MetricCapture;
  setMetricCapture: (next: MetricCapture) => void;
  samplingIntervalSec: number;
  setSamplingIntervalSec: (next: number) => void;
  tempUnit: TempUnit;
  setTempUnit: (next: TempUnit) => void;

  // ── Big Screen controller ───────────────────────────────────
  gamepadLeftDeadzone: number | null;
  setGamepadLeftDeadzone: (next: number | null) => void;
  gamepadRightDeadzone: number | null;
  setGamepadRightDeadzone: (next: number | null) => void;

  // ── Interface & Navigation (Settings → Appearance) ──────────────
  commandPaletteMode: CommandPaletteMode;
  setCommandPaletteMode: (next: CommandPaletteMode) => void;
  navbarMode: NavbarMode;
  setNavbarMode: (next: NavbarMode) => void;
  uiDensityMode: UiDensityMode;
  setUiDensityMode: (next: UiDensityMode) => void;
  isSimpleUi: boolean;
  uiScale: UiScale;
  setUiScale: (next: UiScale) => void;
  reduceMotion: boolean;
  setReduceMotion: (next: boolean) => void;
  showCardBadges: boolean;
  setShowCardBadges: (next: boolean) => void;
  showGameArtBackdrop: boolean;
  setShowGameArtBackdrop: (next: boolean) => void;
  showNavbarNowPlaying: boolean;
  setShowNavbarNowPlaying: (next: boolean) => void;
  /** Per-section visibility for the game detail and store pages. */
  detailSectionVisible: DetailSectionVisibility;
  setDetailSectionVisible: (key: DetailSectionKey, visible: boolean) => void;

  // True until the very first Rust-side fetch has resolved. Mirrors
  // SettingsPage's existing `steamAuthReady` gating pattern so a
  // remount doesn't show form-state with hydrated values before the
  // backend confirms them.
  ready: boolean;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalSettingsObj = globalThis as unknown as {
  __gamelib_settings_context__?: React.Context<SettingsContextValue | null>;
};
const SettingsContext =
  globalSettingsObj.__gamelib_settings_context__ ??
  (globalSettingsObj.__gamelib_settings_context__ = createContext<SettingsContextValue | null>(null));

// ── localStorage helpers (try/catch around every read/write because
// private-browsing modes and some sandboxed contexts throw) ────────────────
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function lsGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function lsSetJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Parse a persisted deadzone value; `null`/empty/invalid → auto (null). */
function parseDeadzoneSetting(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? clampDeadzone(value) : null;
}

/** Default state: every detail-page section starts visible so existing
 *  users see nothing change. Individual sections can be switched off. */
const DEFAULT_DETAIL_SECTION_VISIBILITY: DetailSectionVisibility = {
  systemRequirements: true,
  gameRelations: true,
  timeToBeat: true,
  protonDb: true,
  releases: true,
  reviews: true,
  activity: true,
  achievements: true,
  mods: true,
  weblinks: true,
  news: true,
};

// ── Provider ────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Rust-backed state ──────────────────────────────────────────────────────
  const [closeToTray, setCloseToTrayState] = useState(false);
  const [minimizeOnLaunch, setMinimizeOnLaunchState] = useState(false);
  const [restoreOnExit, setRestoreOnExitState] = useState(false);
  const [disableElevationPrompts, setDisableElevationPromptsState] =
    useState(false);
  const [autoStartEnabled, setAutoStartEnabledState] = useState(false);
  const [ready, setReady] = useState(false);

  // Hydrate from the backend on mount. Cancelled flag protects the
  // mount-then-unmount case (StrictMode's double-mount in dev) from
  // calling setState after the component unmounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await invoke<{
          closeToTrayEnabled: boolean;
          minimizeOnLaunchEnabled: boolean;
          restoreOnExitEnabled: boolean;
          disableElevationPrompts: boolean;
        }>("get_launcher_settings");
        if (cancelled) return;
        setCloseToTrayState(s.closeToTrayEnabled);
        setMinimizeOnLaunchState(s.minimizeOnLaunchEnabled);
        setRestoreOnExitState(s.restoreOnExitEnabled);
        setDisableElevationPromptsState(s.disableElevationPrompts);
      } catch {
        // Backend call failed (e.g. `npm run dev` in the browser
        // where the Tauri bridge isn't injected). Keep defaults on
        // the localStorage side regardless so the Settings UI still
        // renders.
      }
      try {
        const isEnabled = await invoke<boolean>("is_autostart_enabled");
        if (!cancelled) setAutoStartEnabledState(isEnabled);
      } catch {
        /* same fallback rationale */
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Setters: dual-write to React state (sync) + Rust kv (async). The
  // optimistic React write keeps the Settings UI responsive; if the
  // Rust call fails we surface it via toast (the page does this)
  // and the next reload picks up the persisted truth again. Argument
  // names MUST match the Rust `#[tauri::command]` parameter names
  // (Tauri 2 sends them through serde camelCase by default).
  const setCloseToTray = useCallback(async (next: boolean) => {
    setCloseToTrayState(next);
    try {
      await invoke("set_close_to_tray_enabled", { enabled: next });
    } catch (err) {
      console.warn("[SettingsContext] set_close_to_tray_enabled failed:", err);
    }
  }, []);

  const setMinimizeOnLaunch = useCallback(async (next: boolean) => {
    setMinimizeOnLaunchState(next);
    try {
      await invoke("set_minimize_on_launch_enabled", { enabled: next });
    } catch (err) {
      console.warn(
        "[SettingsContext] set_minimize_on_launch_enabled failed:",
        err,
      );
    }
  }, []);

  const setRestoreOnExit = useCallback(async (next: boolean) => {
    setRestoreOnExitState(next);
    try {
      await invoke("set_restore_on_exit_enabled", { enabled: next });
    } catch (err) {
      console.warn(
        "[SettingsContext] set_restore_on_exit_enabled failed:",
        err,
      );
    }
  }, []);

  const setDisableElevationPrompts = useCallback(async (next: boolean) => {
    setDisableElevationPromptsState(next);
    try {
      await invoke("set_disable_elevation_prompts", { enabled: next });
    } catch (err) {
      console.warn(
        "[SettingsContext] set_disable_elevation_prompts failed:",
        err,
      );
    }
  }, []);

  const setAutoStartEnabled = useCallback(async (next: boolean) => {
    setAutoStartEnabledState(next);
    try {
      await invoke("set_autostart_enabled", { enabled: next });
    } catch (err) {
      console.warn("[SettingsContext] set_autostart_enabled failed:", err);
      // Roll back the optimistic flip so the toggle reflects the OS
      // state the backend actually persisted (or failed to). The page
      // surfaces the error via toast; without this revert the checkbox
      // would stay flipped until the next app restart.
      setAutoStartEnabledState(!next);
      throw err;
    }
  }, []);

  // LocalStorage-backed state ──────────────────────────────────────────────
  const [landingPage, setLandingPageState] = useState<LandingPage>(() => {
    const raw = lsGet(LS_LANDING_PAGE);
    if (
      raw === "home" ||
      raw === "library" ||
      raw === "store" ||
      raw === "wishlist" ||
      raw === "deals" ||
      raw === "activity" ||
      raw === "achievements" ||
      raw === "downloads" ||
      raw === "storage" ||
      raw === "news" ||
      raw === "community"
    ) {
      return raw;
    }
    // First-ever launch (no stored preference): land on the Library
    // tab — the primary surface. The legacy "home" page renders
    // nothing while the library is empty, so it can't be the default.
    return "library";
  });

  const setLandingPage = useCallback((next: LandingPage) => {
    setLandingPageState(next);
    lsSet(LS_LANDING_PAGE, next);
  }, []);

  const [accentColor, setAccentColorState] = useState<string | null>(() =>
    lsGet(LS_ACCENT_COLOR),
  );

  const setAccentColor = useCallback((next: string | null) => {
    setAccentColorState(next);
    if (next === null) {
      try {
        localStorage.removeItem(LS_ACCENT_COLOR);
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS_ACCENT_COLOR, next);
    }
    // Apply the full accent family to :root so every theme re-tints
    // itself with the override (base, harmonized partner, contrast
    // text, hover/active/glow/soft/border states, brand gradient +
    // mesh all derive from the single injected color). Inline styles
    // on <html> win over the theme stylesheets — `null` removes the
    // whole family and reverts to the per-theme defaults.
    if (typeof document !== "undefined") {
      applyAccentFamily(document.documentElement, next);
    }
  }, []);

  // Hydrate the accent family on first mount so a saved override
  // applies before the first paint of the Settings page or any route.
  useEffect(() => {
    if (typeof document !== "undefined") {
      applyAccentFamily(document.documentElement, accentColor);
    }
  }, [accentColor]);

  // Mirror the accent override to the backend kv store
  // (get_accent_color / set_accent_color) so the native splash
  // window can apply it on next launch.
  useEffect(() => {
    invoke("set_accent_color", { accent: accentColor ?? "" }).catch(() => {
      /* non-fatal */
    });
  }, [accentColor]);

  const [autoGameAccent, setAutoGameAccentState] = useState<boolean>(() =>
    lsGet(LS_AUTO_GAME_ACCENT) === "true",
  );
  const setAutoGameAccent = useCallback((next: boolean) => {
    setAutoGameAccentState(next);
    lsSet(LS_AUTO_GAME_ACCENT, String(next));
  }, []);

  const [uiSoundEnabled, setUiSoundEnabledState] = useState<boolean>(() =>
    lsGet(LS_UI_SOUND_ENABLED) !== "false",
  );
  const [uiSoundVolume, setUiSoundVolumeState] = useState<number>(() => {
    const raw = Number(lsGet(LS_UI_SOUND_VOLUME) ?? "25");
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 25;
  });

  const setUiSoundEnabled = useCallback((next: boolean) => {
    setUiSoundEnabledState(next);
    lsSet(LS_UI_SOUND_ENABLED, String(next));
    updateSoundConfig(next, uiSoundVolume);
  }, [uiSoundVolume]);

  const setUiSoundVolume = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    setUiSoundVolumeState(clamped);
    lsSet(LS_UI_SOUND_VOLUME, String(clamped));
    updateSoundConfig(uiSoundEnabled, clamped);
  }, [uiSoundEnabled]);

  useEffect(() => {
    updateSoundConfig(uiSoundEnabled, uiSoundVolume);
  }, [uiSoundEnabled, uiSoundVolume]);

  const [syncIntervalMinutes, setSyncIntervalState] =
    useState<SyncIntervalMinutes>(() => {
      const raw = parseInt(lsGet(LS_SYNC_INTERVAL) ?? "0", 10);
      if (raw === 15 || raw === 30 || raw === 60 || raw === 360) return raw;
      if (raw === 720) return 720;
      if (raw === 1440) return 1440;
      return 0;
    });
  const setSyncIntervalMinutes = useCallback((next: SyncIntervalMinutes) => {
    setSyncIntervalState(next);
    lsSet(LS_SYNC_INTERVAL, String(next));
  }, []);

  const [steamAutoDetect, setSteamAutoDetectState] = useState<boolean>(() =>
    lsGet(LS_STEAM_AUTO_DETECT) === "true",
  );
  const setSteamAutoDetect = useCallback((next: boolean) => {
    setSteamAutoDetectState(next);
    lsSet(LS_STEAM_AUTO_DETECT, String(next));
  }, []);

  const [hideAchievementProgress, setHideAchievementProgressState] =
    useState<boolean>(() => lsGet(LS_ACHIEVEMENT_PRIVACY) === "true");
  const setHideAchievementProgress = useCallback((next: boolean) => {
    setHideAchievementProgressState(next);
    lsSet(LS_ACHIEVEMENT_PRIVACY, String(next));
  }, []);

  const [discordRichPresence, setDiscordRichPresenceState] = useState<boolean>(
    () => lsGet(LS_DISCORD_PRESENCE) === "true",
  );
  const [discordStatus, setDiscordStatus] = useState<DiscordStatus>("idle");
  const setDiscordRichPresence = useCallback(async (next: boolean) => {
    setDiscordRichPresenceState(next);
    if (!next) setDiscordStatus("idle");
    lsSet(LS_DISCORD_PRESENCE, String(next));
    try {
      await invoke("set_discord_presence_enabled", { enabled: next });
    } catch (err) {
      console.warn("[SettingsContext] set_discord_presence_enabled failed:", err);
    }
  }, []);

  // Per-option visibility toggles. All default to ON so existing users
  // upgrading see exactly the presence they had before; each can be
  // switched off for privacy. Read synchronously at emit time by the
  // presence emitters (useSessions reads the exported LS keys directly
  // because it lives above this provider in the tree).
  const [discordShowArt, setDiscordShowArtState] = useState<boolean>(
    () => lsGet(LS_DISCORD_SHOW_ART) !== "false",
  );
  const setDiscordShowArt = useCallback((next: boolean) => {
    setDiscordShowArtState(next);
    lsSet(LS_DISCORD_SHOW_ART, String(next));
  }, []);

  const [discordShowPlaytime, setDiscordShowPlaytimeState] = useState<boolean>(
    () => lsGet(LS_DISCORD_SHOW_PLAYTIME) !== "false",
  );
  const setDiscordShowPlaytime = useCallback((next: boolean) => {
    setDiscordShowPlaytimeState(next);
    lsSet(LS_DISCORD_SHOW_PLAYTIME, String(next));
  }, []);

  const [discordShowWebsiteButton, setDiscordShowWebsiteButtonState] =
    useState<boolean>(() => lsGet(LS_DISCORD_SHOW_WEBSITE_BUTTON) !== "false");
  const setDiscordShowWebsiteButton = useCallback((next: boolean) => {
    setDiscordShowWebsiteButtonState(next);
    lsSet(LS_DISCORD_SHOW_WEBSITE_BUTTON, String(next));
  }, []);

  const [discordShowBrowsing, setDiscordShowBrowsingState] = useState<boolean>(
    () => lsGet(LS_DISCORD_SHOW_BROWSING) !== "false",
  );
  const setDiscordShowBrowsing = useCallback((next: boolean) => {
    setDiscordShowBrowsingState(next);
    lsSet(LS_DISCORD_SHOW_BROWSING, String(next));
  }, []);

  // Apply the persisted Discord Rich Presence choice on mount so the
  // backend connection thread starts (or stays off) without requiring a
  // manual toggle after every launch.
  useEffect(() => {
    invoke("set_discord_presence_enabled", {
      enabled: lsGet(LS_DISCORD_PRESENCE) === "true",
    }).catch((err) =>
      console.warn("[SettingsContext] discord presence init failed:", err),
    );
  }, []);

  // Track the presence thread's connection state (emitted as
  // `discord-presence-status` with { connected }) so Settings can show
  // "Discord is not running" when the desktop app is closed.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<{ connected: boolean }>("discord-presence-status", (e) => {
          if (!disposed) setDiscordStatus(e.payload.connected ? "connected" : "notRunning");
        });
      } catch (err) {
        console.warn("[SettingsContext] discord status listen failed:", err);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const [historyCapDays, setHistoryCapDaysState] = useState<1 | 7 | 30>(() => {
    const raw = parseInt(lsGet(LS_HISTORY_CAP_DAYS) ?? "1", 10);
    if (raw === 7) return 7;
    if (raw === 30) return 30;
    return 1;
  });
  const setHistoryCapDays = useCallback((next: 1 | 7 | 30) => {
    setHistoryCapDaysState(next);
    lsSet(LS_HISTORY_CAP_DAYS, String(next));
  }, []);

  const [friendsNotifications, setFriendsNotificationsState] = useState<boolean>(
    () => lsGet(LS_FRIENDS_NOTIFICATIONS) === "true",
  );
  const setFriendsNotifications = useCallback((next: boolean) => {
    setFriendsNotificationsState(next);
    lsSet(LS_FRIENDS_NOTIFICATIONS, String(next));
  }, []);

  const [dmReadReceipts, setDmReadReceiptsState] = useState<boolean>(() =>
    lsGet(LS_DM_READ_RECEIPTS) === "true",
  );
  const setDmReadReceipts = useCallback((next: boolean) => {
    setDmReadReceiptsState(next);
    lsSet(LS_DM_READ_RECEIPTS, String(next));
  }, []);

  const [blockedSourceDomains, setBlockedSourceDomainsState] = useState<
    string[]
  >(() => lsGetJSON<string[]>(LS_BLOCKED_DOMAINS, []));
  const setBlockedSourceDomains = useCallback((next: string[]) => {
    // Normalize: lowercase, trim, dedupe, drop empty. The user types
    // whatever they want (with caps, trailing whitespace) and we
    // store the cleaned version so the matcher is reproducible.
    const cleaned = Array.from(
      new Set(
        next
          .map((d) => d.trim().toLowerCase())
          .filter((d) => d.length > 0),
      ),
    );
    setBlockedSourceDomainsState(cleaned);
    lsSetJSON(LS_BLOCKED_DOMAINS, cleaned);
  }, []);

  // ── Hardware monitoring ────────────────────────────────────────────────
  const [hardwareMonitoringEnabled, setHardwareMonitoringEnabledState] =
    useState<boolean>(() => lsGet(LS_HW_MONITORING) !== "false");
  const setHardwareMonitoringEnabled = useCallback((next: boolean) => {
    setHardwareMonitoringEnabledState(next);
    lsSet(LS_HW_MONITORING, String(next));
  }, []);

  const [metricCapture, setMetricCaptureState] = useState<MetricCapture>(
    () =>
      lsGetJSON<MetricCapture>(LS_METRIC_CAPTURE, {
        fps: true,
        cpu: true,
        gpu: true,
        ram: true,
        cpuTemp: true,
        gpuTemp: true,
      }),
  );
  const setMetricCapture = useCallback((next: MetricCapture) => {
    setMetricCaptureState(next);
    lsSetJSON(LS_METRIC_CAPTURE, next);
  }, []);

  const [samplingIntervalSec, setSamplingIntervalSecState] = useState<number>(
    () => {
      const raw = parseFloat(lsGet(LS_SAMPLING_SEC) ?? "5");
      return Number.isFinite(raw) && raw >= 0.25 ? raw : 5;
    },
  );
  const setSamplingIntervalSec = useCallback((next: number) => {
    const clamped = Number.isFinite(next)
      ? Math.min(60, Math.max(0.25, Math.round(next * 4) / 4))
      : 5;
    setSamplingIntervalSecState(clamped);
    lsSet(LS_SAMPLING_SEC, String(clamped));
  }, []);

  const [tempUnit, setTempUnitState] = useState<TempUnit>(() =>
    lsGet(LS_TEMP_UNIT) === "f" ? "f" : "c",
  );
  const setTempUnit = useCallback((next: TempUnit) => {
    setTempUnitState(next);
    lsSet(LS_TEMP_UNIT, next);
  }, []);

  // ── Big Screen controller ───────────────────────────────────────────────
  // `null` = auto-calibrate on connect; a number is a manual override.
  const [gamepadLeftDeadzone, setGamepadLeftDeadzoneState] = useState<
    number | null
  >(() => parseDeadzoneSetting(lsGet(LS_GAMEPAD_LEFT_DEADZONE)));
  const setGamepadLeftDeadzone = useCallback((next: number | null) => {
    setGamepadLeftDeadzoneState(next);
    if (next === null) {
      try {
        localStorage.removeItem(LS_GAMEPAD_LEFT_DEADZONE);
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS_GAMEPAD_LEFT_DEADZONE, String(next));
    }
  }, []);

  const [gamepadRightDeadzone, setGamepadRightDeadzoneState] = useState<
    number | null
  >(() => parseDeadzoneSetting(lsGet(LS_GAMEPAD_RIGHT_DEADZONE)));
  const setGamepadRightDeadzone = useCallback((next: number | null) => {
    setGamepadRightDeadzoneState(next);
    if (next === null) {
      try {
        localStorage.removeItem(LS_GAMEPAD_RIGHT_DEADZONE);
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS_GAMEPAD_RIGHT_DEADZONE, String(next));
    }
  }, []);

  // Interface & Navigation state ──────────────────────────────────────────
  const [commandPaletteMode, setCommandPaletteModeState] =
    useState<CommandPaletteMode>(() =>
      lsGet(LS_COMMAND_PALETTE_MODE) === "simple" ? "simple" : "full",
    );
  const setCommandPaletteMode = useCallback((next: CommandPaletteMode) => {
    setCommandPaletteModeState(next);
    lsSet(LS_COMMAND_PALETTE_MODE, next);
  }, []);

  // Compact is the default: the full 12-tab bar is crowded and the
  // secondary pages stay one click away inside the "More" dropdown.
  const [navbarMode, setNavbarModeState] = useState<NavbarMode>(() =>
    lsGet(LS_NAVBAR_MODE) === "full" ? "full" : "compact",
  );
  const setNavbarMode = useCallback((next: NavbarMode) => {
    setNavbarModeState(next);
    lsSet(LS_NAVBAR_MODE, next);
  }, []);

  const [uiDensityMode, setUiDensityModeState] = useState<UiDensityMode>(() => {
    const stored = lsGet(LS_UI_DENSITY_MODE);
    if (stored === "simple" || stored === "complete") return stored;
    // No explicit choice persisted. On the very first launch of the app
    // we default a brand-new user into Simple mode so the UI reads
    // approachable out of the box; returning installs keep Complete.
    if (lsGet(LS_FIRST_LAUNCH) === null) {
      lsSet(LS_UI_DENSITY_MODE, "simple");
      lsSet(LS_FIRST_LAUNCH, "1");
      return "simple";
    }
    return "complete";
  });
  const setUiDensityMode = useCallback((next: UiDensityMode) => {
    setUiDensityModeState(next);
    lsSet(LS_UI_DENSITY_MODE, next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-ui-mode", next);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-ui-mode", uiDensityMode);
    }
  }, [uiDensityMode]);

  const isSimpleUi = uiDensityMode === "simple";

  const [uiScale, setUiScaleState] = useState<UiScale>(() => {
    const stored = lsGet(LS_UI_SCALE);
    if (stored === "auto" || stored === "85" || stored === "100" || stored === "110" || stored === "125" || stored === "150" || stored === "175" || stored === "200") {
      return stored;
    }
    return "auto";
  });
  const setUiScale = useCallback((next: UiScale) => {
    setUiScaleState(next);
    lsSet(LS_UI_SCALE, next);
    if (typeof document !== "undefined") {
      if (next === "auto" || next === "100") {
        document.documentElement.removeAttribute("data-ui-scale");
      } else {
        document.documentElement.setAttribute("data-ui-scale", next);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      if (uiScale === "auto" || uiScale === "100") {
        document.documentElement.removeAttribute("data-ui-scale");
      } else {
        document.documentElement.setAttribute("data-ui-scale", uiScale);
      }
    }
  }, [uiScale]);

  const [reduceMotion, setReduceMotionState] = useState<boolean>(
    () => lsGet(LS_REDUCE_MOTION) === "true",
  );
  const setReduceMotion = useCallback((next: boolean) => {
    setReduceMotionState(next);
    lsSet(LS_REDUCE_MOTION, String(next));
    if (typeof document !== "undefined") {
      if (next) {
        document.documentElement.setAttribute("data-reduce-motion", "true");
      } else {
        document.documentElement.removeAttribute("data-reduce-motion");
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      if (reduceMotion) {
        document.documentElement.setAttribute("data-reduce-motion", "true");
      } else {
        document.documentElement.removeAttribute("data-reduce-motion");
      }
    }
  }, [reduceMotion]);

  const [showCardBadges, setShowCardBadgesState] = useState<boolean>(
    () => lsGet(LS_SHOW_CARD_BADGES) !== "false",
  );
  const setShowCardBadges = useCallback((next: boolean) => {
    setShowCardBadgesState(next);
    lsSet(LS_SHOW_CARD_BADGES, String(next));
  }, []);

  const [showGameArtBackdrop, setShowGameArtBackdropState] = useState<boolean>(
    () => lsGet(LS_SHOW_GAME_ART_BACKDROP) !== "false",
  );
  const setShowGameArtBackdrop = useCallback((next: boolean) => {
    setShowGameArtBackdropState(next);
    lsSet(LS_SHOW_GAME_ART_BACKDROP, String(next));
  }, []);

  const [showNavbarNowPlaying, setShowNavbarNowPlayingState] = useState<boolean>(
    () => lsGet(LS_SHOW_NAVBAR_NOW_PLAYING) !== "false",
  );
  const setShowNavbarNowPlaying = useCallback((next: boolean) => {
    setShowNavbarNowPlayingState(next);
    lsSet(LS_SHOW_NAVBAR_NOW_PLAYING, String(next));
  }, []);

  // Detail-page section visibility. Loaded once from localStorage as an
  // overrides object; keys not present fall back to ON (visible) so
  // existing users see everything exactly as before. Writing only the
  // OFF entries keeps the stored blob small and the default explicit.
  const [detailSectionVisible, setDetailSectionVisibleState] =
    useState<DetailSectionVisibility>(() => {
      const stored = lsGetJSON<Partial<Record<DetailSectionKey, boolean>>>(
        LS_DETAIL_SECTIONS_VISIBLE,
        {},
      );
      return {
        ...DEFAULT_DETAIL_SECTION_VISIBILITY,
        ...stored,
      };
    });
  const setDetailSectionVisible = useCallback(
    (key: DetailSectionKey, visible: boolean) => {
      setDetailSectionVisibleState((prev) => {
        const next = { ...prev, [key]: visible };
        const overrides: Partial<Record<DetailSectionKey, boolean>> = {};
        for (const k of Object.keys(next) as DetailSectionKey[]) {
          if (next[k] === false) overrides[k] = false;
        }
        lsSetJSON(LS_DETAIL_SECTIONS_VISIBLE, overrides);
        return next;
      });
    },
    [],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      closeToTray,
      setCloseToTray,
      minimizeOnLaunch,
      setMinimizeOnLaunch,
      restoreOnExit,
      setRestoreOnExit,
      disableElevationPrompts,
      setDisableElevationPrompts,
      autoStartEnabled,
      setAutoStartEnabled,
      landingPage,
      setLandingPage,
      accentColor,
      setAccentColor,
      autoGameAccent,
      setAutoGameAccent,
      uiSoundEnabled,
      setUiSoundEnabled,
      uiSoundVolume,
      setUiSoundVolume,
      syncIntervalMinutes,
      setSyncIntervalMinutes,
      steamAutoDetect,
      setSteamAutoDetect,
      hideAchievementProgress,
      setHideAchievementProgress,
      discordRichPresence,
      setDiscordRichPresence,
      discordStatus,
      discordShowArt,
      setDiscordShowArt,
      discordShowPlaytime,
      setDiscordShowPlaytime,
      discordShowWebsiteButton,
      setDiscordShowWebsiteButton,
      discordShowBrowsing,
      setDiscordShowBrowsing,
      historyCapDays,
      setHistoryCapDays,
      blockedSourceDomains,
      setBlockedSourceDomains,
      friendsNotifications,
      setFriendsNotifications,
      dmReadReceipts,
      setDmReadReceipts,
      hardwareMonitoringEnabled,
      setHardwareMonitoringEnabled,
      metricCapture,
      setMetricCapture,
      samplingIntervalSec,
      setSamplingIntervalSec,
      tempUnit,
      setTempUnit,
      gamepadLeftDeadzone,
      setGamepadLeftDeadzone,
      gamepadRightDeadzone,
      setGamepadRightDeadzone,
      commandPaletteMode,
      setCommandPaletteMode,
      navbarMode,
      setNavbarMode,
      uiDensityMode,
      setUiDensityMode,
      isSimpleUi,
      uiScale,
      setUiScale,
      reduceMotion,
      setReduceMotion,
      showCardBadges,
      setShowCardBadges,
      showGameArtBackdrop,
      setShowGameArtBackdrop,
      showNavbarNowPlaying,
      setShowNavbarNowPlaying,
      detailSectionVisible,
      setDetailSectionVisible,
      ready,
    }),
    [
      closeToTray,
      setCloseToTray,
      minimizeOnLaunch,
      setMinimizeOnLaunch,
      restoreOnExit,
      setRestoreOnExit,
      disableElevationPrompts,
      setDisableElevationPrompts,
      autoStartEnabled,
      setAutoStartEnabled,
      landingPage,
      setLandingPage,
      accentColor,
      setAccentColor,
      autoGameAccent,
      setAutoGameAccent,
      uiSoundEnabled,
      setUiSoundEnabled,
      uiSoundVolume,
      setUiSoundVolume,
      syncIntervalMinutes,
      setSyncIntervalMinutes,
      steamAutoDetect,
      setSteamAutoDetect,
      hideAchievementProgress,
      setHideAchievementProgress,
      discordRichPresence,
      setDiscordRichPresence,
      discordStatus,
      discordShowArt,
      setDiscordShowArt,
      discordShowPlaytime,
      setDiscordShowPlaytime,
      discordShowWebsiteButton,
      setDiscordShowWebsiteButton,
      discordShowBrowsing,
      setDiscordShowBrowsing,
      historyCapDays,
      setHistoryCapDays,
      blockedSourceDomains,
      setBlockedSourceDomains,
      friendsNotifications,
      setFriendsNotifications,
      dmReadReceipts,
      setDmReadReceipts,
      hardwareMonitoringEnabled,
      setHardwareMonitoringEnabled,
      metricCapture,
      setMetricCapture,
      samplingIntervalSec,
      setSamplingIntervalSec,
      tempUnit,
      setTempUnit,
      gamepadLeftDeadzone,
      setGamepadLeftDeadzone,
      gamepadRightDeadzone,
      setGamepadRightDeadzone,
      commandPaletteMode,
      setCommandPaletteMode,
      navbarMode,
      setNavbarMode,
      uiDensityMode,
      setUiDensityMode,
      isSimpleUi,
      uiScale,
      setUiScale,
      reduceMotion,
      setReduceMotion,
      showCardBadges,
      setShowCardBadges,
      showGameArtBackdrop,
      setShowGameArtBackdrop,
      showNavbarNowPlaying,
      setShowNavbarNowPlaying,
      detailSectionVisible,
      setDetailSectionVisible,
      ready,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
