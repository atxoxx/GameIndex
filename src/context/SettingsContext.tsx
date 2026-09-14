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
import { SPLASH_ENABLED_KEY } from "./SplashContext";
import {
  DETAIL_TABS,
  DETAIL_TOP_BAR,
  HERO_ELEMENTS,
  normalizeDetailTabOrder,
  normalizeDetailTabOrderMap,
  normalizeDetailTopBarOrder,
  normalizeDetailTopBarOrderMap,
  normalizeDetailTopBarVisibilityMap,
  normalizeHeroElementOrder,
  normalizeHeroElementOrderMap,
  normalizeHeroElementVisibilityMap,
  normalizePageItemOrder,
  normalizePageItemOrderMap,
  normalizePageItemVisibilityMap,
  normalizeSidebarSectionVisibility,
  resolveDetailTabOrder,
  resolveDetailTopBarOrder,
  resolveDetailTopBarHidden,
  resolveHeroElementOrder,
  resolveHeroElementHidden,
  type DetailTabKey,
  type DetailTabOrderMap,
  type DetailTabScope,
  type DetailTopBarKey,
  type DetailTopBarOrderMap,
  type DetailTopBarScope,
  type DetailTopBarVisibilityMap,
  type HeroElementKey,
  type HeroElementOrderMap,
  type HeroElementVisibilityMap,
  type HeroScope,
  type InterfacePageKey,
  type PageItemOrderMap,
  type PageItemVisibilityMap,
  type PageWidgetKey,
  type SidebarSectionKey,
  type SidebarSectionVisibility,
} from "./interfaceLayout";
import {
  normalizeHeroGridLayout,
  normalizeHeroGridLayoutMap,
  resolveHeroGridLayout,
  type HeroGridLayout,
  type HeroGridLayoutMap,
} from "./heroGrid";

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
// the approachable out-of-the-box state (Simple UI mode, only the
// Store / Library / Community navbar tabs, UI sounds off), while anyone
// who has ever run the app keeps whatever they last chose.
// Append-only, like every other key.
const LS_FIRST_LAUNCH = "gamelib.first_launch";
const LS_REDUCE_MOTION = "gamelib.reduce_motion";
const LS_SHOW_CARD_BADGES = "gamelib.show_card_badges";
const LS_SHOW_GAME_ART_BACKDROP = "gamelib.show_game_art_backdrop";
const LS_SHOW_NAVBAR_NOW_PLAYING = "gamelib.show_navbar_now_playing";
// Game & Store detail-page section visibility (Settings → Appearance).
const LS_DETAIL_SECTIONS_VISIBLE = "gamelib.detail_sections_visible";
// Per-item UI visibility (Settings → Interface tab). Same overrides-object
// pattern as detail sections: only OFF entries are persisted.
const LS_INTERFACE_VISIBILITY = "gamelib.interface_visibility";
// Top navbar tab order (Settings → Interface → Navbar Tabs). Persisted as
// the full array of InterfaceItemKey values so the user's arrangement is
// explicit; normalization on read drops unknown/duplicate keys and
// appends newly added tabs so an upgrade never leaves one unrendered.
const LS_NAVBAR_TAB_ORDER = "gamelib.navbar_tab_order";
// Order of the top-right header buttons (Layout Studio → Global).
const LS_NAVBAR_BUTTON_ORDER = "gamelib.navbar_button_order";
// Which side the app sidebar docks to (Layout Studio → Global).
const LS_SIDEBAR_POSITION = "gamelib.sidebar_position";
// Sidebar top-level element visibility (Layout Studio → Global).
const LS_SIDEBAR_SECTIONS_VISIBLE = "gamelib.sidebar_sections_visible";
// Per-page widget visibility and order (Layout Studio → page tabs).
const LS_PAGE_ITEM_VISIBILITY = "gamelib.page_item_visibility";
const LS_PAGE_ITEM_ORDER = "gamelib.page_item_order";
// Detail-page tab order + hero element order/visibility (Settings → Interface).
const LS_DETAIL_TAB_ORDER = "gamelib.detail_tab_order";
const LS_HERO_ELEMENT_ORDER = "gamelib.hero_element_order";
const LS_HERO_ELEMENT_VISIBILITY = "gamelib.hero_element_visibility";
// Detail-page top-bar order + OFF-only visibility (Settings → Interface).
const LS_DETAIL_TOP_BAR_ORDER = "gamelib.detail_top_bar_order";
const LS_DETAIL_TOP_BAR_VISIBILITY = "gamelib.detail_top_bar_visibility";
// Optional hero grid layout per scope (Layout Studio → hero grid). Absent =>
// the hero keeps rendering its flex/`order` layout.
const LS_HERO_GRID_LAYOUT = "gamelib.hero_grid_layout";
// Linux & Steam Deck support level (Settings → General)
const LS_LINUX_SUPPORT_LEVEL = "gamelib.linux_support_level";

// ── Public shape ─────────────────────────────────────────────────────────────

export type HostPlatform = "windows" | "linux" | "macos" | "unknown";
export type LinuxSupportLevel = "disabled" | "deck_verified" | "full";

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

export type SidebarPosition = "left" | "right";
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
  | "notes"
  | "achievements"
  | "mods"
  | "weblinks"
  | "news"
  | "steamFeatures";

export type DetailSectionVisibility = Record<DetailSectionKey, boolean>;

/** Individual UI elements that can be shown/hidden from the Interface
 *  settings tab. Keys are camelCase; the HTML attribute applied to
 *  `<html>` is the kebab-case form (`data-ui-hide-<key>`).
 *  - nav*: top navbar tabs
 *  - btn*: top-right cluster buttons
 *  - badge*: card badges & overlays
 *  - widget*: per-page widgets (KPI cards, filters, sub-tabs, hero, dashboards)
 *  All default to ON; Simple UI mode hides everything at once and these
 *  toggles only refine visibility in Complete mode. */
export type InterfaceItemKey =
  // Top navbar tabs
  | "navHome"
  | "navStore"
  | "navLibrary"
  | "navWishlist"
  | "navDeals"
  | "navNews"
  | "navEmulators"
  | "navMods"
  | "navActivity"
  | "navAchievements"
  | "navStorage"
  | "navCommunity"
  | "navFriends"
  // Right-cluster navbar buttons
  | "btnDownloads"
  | "btnSettings"
  | "btnDocs"
  | "btnBigScreen"
  // Card badges & overlays
  | "badgePlatform"
  | "badgePlaytime"
  | "badgeInstall"
  | "badgeRating"
  | "badgeCrackwatch"
  | "badgeCompare"
  // Page widgets
  | "widgetKpis"
  | "widgetFilters"
  | "widgetSubtabs"
  | "widgetHero"
  | "widgetDashboard";

export type InterfaceVisibility = Record<InterfaceItemKey, boolean>;

/** All interface items default to visible so existing users see no change. */
export const DEFAULT_INTERFACE_VISIBILITY: InterfaceVisibility = {
  navHome: true,
  navStore: true,
  navLibrary: true,
  navWishlist: true,
  navDeals: true,
  navNews: true,
  navEmulators: true,
  navMods: true,
  navActivity: true,
  navAchievements: true,
  navStorage: true,
  navCommunity: true,
  navFriends: true,
  btnDownloads: true,
  btnSettings: true,
  btnDocs: true,
  btnBigScreen: true,
  badgePlatform: true,
  badgePlaytime: true,
  badgeInstall: true,
  badgeRating: true,
  badgeCrackwatch: true,
  badgeCompare: true,
  widgetKpis: true,
  widgetFilters: true,
  widgetSubtabs: true,
  widgetHero: true,
  widgetDashboard: true,
};

/** Map an InterfaceItemKey to its `data-ui-hide-*` attribute name. */
export function interfaceAttrKey(key: InterfaceItemKey): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Canonical default order of the top navbar tabs — mirrors the flat tab
 *  list in TopNav so "Reset order" restores the shipped arrangement.
 *  Activity sits sixth so the default Compact navbar pins it exactly like
 *  the pre-reorder builds did; the tabs after it match the old "More"
 *  dropdown order. */
export const DEFAULT_NAVBAR_TAB_ORDER: InterfaceItemKey[] = [
  "navHome",
  "navStore",
  "navLibrary",
  "navWishlist",
  "navDeals",
  "navActivity",
  "navNews",
  "navEmulators",
  "navMods",
  "navAchievements",
  "navStorage",
  "navCommunity",
  "navFriends",
];

/** Canonical default order of the top-right header buttons — mirrors the
 *  shipped markup in TopNav so "Reset" restores it exactly. */
export const DEFAULT_NAVBAR_BUTTON_ORDER: InterfaceItemKey[] = [
  "btnDownloads",
  "btnSettings",
  "btnDocs",
  "btnBigScreen",
];

/** Normalize a persisted key order: drop unknown and duplicate keys, then
 *  append every known key that is missing so elements added in later
 *  releases still show up at the end of the user's arrangement. */
function normalizeKeyOrder(
  raw: unknown,
  defaults: InterfaceItemKey[],
): InterfaceItemKey[] {
  const known = new Set<string>(defaults);
  const seen = new Set<string>();
  const ordered: InterfaceItemKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string" || !known.has(value) || seen.has(value)) {
        continue;
      }
      seen.add(value);
      ordered.push(value as InterfaceItemKey);
    }
  }
  for (const key of defaults) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

/** Normalize a persisted navbar order: drop unknown and duplicate keys,
 *  then append every known tab that is missing so tabs added in later
 *  releases still show up at the end of the user's arrangement. */
export function normalizeNavbarTabOrder(raw: unknown): InterfaceItemKey[] {
  return normalizeKeyOrder(raw, DEFAULT_NAVBAR_TAB_ORDER);
}

/** Same normalization for the header button cluster. */
export function normalizeNavbarButtonOrder(raw: unknown): InterfaceItemKey[] {
  return normalizeKeyOrder(raw, DEFAULT_NAVBAR_BUTTON_ORDER);
}

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
  /** Per-item visibility for the Interface tab (navbar tabs, buttons,
   *  card badges, page widgets). Simple mode hides everything at once;
   *  these refine visibility in Complete mode. */
  interfaceVisibility: InterfaceVisibility;
  setInterfaceVisibility: (key: InterfaceItemKey, visible: boolean) => void;
  /** User-arranged order of the top navbar tabs (Settings → Interface). */
  navbarTabOrder: InterfaceItemKey[];
  setNavbarTabOrder: (next: InterfaceItemKey[]) => void;
  /** User-arranged order of the top-right header buttons (Layout Studio). */
  navbarButtonOrder: InterfaceItemKey[];
  setNavbarButtonOrder: (next: InterfaceItemKey[]) => void;
  /** Which side the app sidebar docks to (Layout Studio → Global). */
  sidebarPosition: SidebarPosition;
  setSidebarPosition: (next: SidebarPosition) => void;
  /** Show/hide the sidebar's top-level sections (Layout Studio → Global). */
  sidebarSectionVisible: SidebarSectionVisibility;
  setSidebarSectionVisible: (key: SidebarSectionKey, visible: boolean) => void;
  /** Per-page widget visibility (Layout Studio → page tabs). */
  pageItemVisible: PageItemVisibilityMap;
  setPageItemVisible: (
    page: InterfacePageKey,
    widget: PageWidgetKey,
    visible: boolean,
  ) => void;
  /** Per-page widget order (Layout Studio → page tabs). */
  pageItemOrder: PageItemOrderMap;
  setPageItemOrder: (page: InterfacePageKey, next: PageWidgetKey[]) => void;
  /** Per-scope detail-page tab order (Settings → Interface). Tab visibility
   *  itself reuses `detailSectionVisible`; this is order only. */
  detailTabOrder: DetailTabOrderMap;
  setDetailTabOrder: (scope: DetailTabScope, next: DetailTabKey[]) => void;
  /** Per-scope hero element order (Settings → Interface). */
  heroElementOrder: HeroElementOrderMap;
  setHeroElementOrder: (scope: HeroScope, next: HeroElementKey[]) => void;
  /** OFF-only per-scope hero element visibility overrides. */
  heroElementVisibility: HeroElementVisibilityMap;
  setHeroElementVisible: (
    scope: HeroScope,
    key: HeroElementKey,
    visible: boolean,
  ) => void;
  /** Optional per-scope hero grid layout (Layout Studio → hero grid).
   *  An absent scope means the hero renders its flex/`order` layout. */
  heroGridLayout: HeroGridLayoutMap;
  setHeroGridLayout: (scope: HeroScope, next: HeroGridLayout) => void;
  resetHeroGridLayout: (scope: HeroScope) => void;
  /** Per-scope order of the detail-page top bar (game + store). */
  detailTopBarOrder: DetailTopBarOrderMap;
  setDetailTopBarOrder: (scope: DetailTopBarScope, next: DetailTopBarKey[]) => void;
  /** OFF-only per-scope top-bar visibility overrides. A hidden item is
   *  removed from the bar completely, not just styled away. */
  detailTopBarVisibility: DetailTopBarVisibilityMap;
  setDetailTopBarVisible: (
    scope: DetailTopBarScope,
    key: DetailTopBarKey,
    visible: boolean,
  ) => void;

  // ── Splash screens (Settings → Appearance) ──────────────────────
  /** Show the standalone launch splash while a game starts. Mirrors the
   *  `gamelib-show-splash` key read by `isSplashEnabled()` at launch. */
  launchSplashEnabled: boolean;
  setLaunchSplashEnabled: (next: boolean) => void;
  /** Show the native boot splash window while the app starts. Rust-backed
   *  (kv_store) because the boot path consumes it before the frontend. */
  startupSplashEnabled: boolean;
  setStartupSplashEnabled: (next: boolean) => void;

  // ── Linux & Steam Deck Support ──────────────────────────────────
  hostPlatform: HostPlatform;
  isLinuxHost: boolean;
  isWindowsHost: boolean;
  linuxSupportLevel: LinuxSupportLevel;
  setLinuxSupportLevel: (next: LinuxSupportLevel) => void;
  showDeckVerified: boolean;
  showFullLinuxUi: boolean;

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

/** First-launch navbar overrides: only Store, Library and Community are
 *  shown; every other tab starts hidden. Persisted as OFF entries only
 *  (same overrides-object pattern as the Interface settings tab), so
 *  returning installs — which never write this blob — keep all tabs. */
const FIRST_LAUNCH_INTERFACE_OVERRIDES: Partial<InterfaceVisibility> = {
  navHome: false,
  navWishlist: false,
  navDeals: false,
  navNews: false,
  navEmulators: false,
  navMods: false,
  navActivity: false,
  navAchievements: false,
  navStorage: false,
  navFriends: false,
};

/**
 * One-time first-launch bootstrap. Writes the out-of-the-box defaults
 * explicitly so every consumer — including StrictMode remounts, which
 * re-run state initializers — reads the same values: Simple UI mode,
 * only Store / Library / Community navbar tabs, and UI sounds OFF.
 * Returning installs already have `gamelib.first_launch` set, so this
 * is a no-op for them and they keep whatever they last chose.
 */
function bootstrapFirstLaunchDefaults(): void {
  if (lsGet(LS_FIRST_LAUNCH) !== null) return;
  lsSet(LS_FIRST_LAUNCH, "1");
  lsSet(LS_UI_DENSITY_MODE, "simple");
  lsSet(LS_UI_SOUND_ENABLED, "false");
  lsSetJSON(LS_INTERFACE_VISIBILITY, FIRST_LAUNCH_INTERFACE_OVERRIDES);
}
bootstrapFirstLaunchDefaults();

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
  notes: true,
  achievements: true,
  mods: true,
  weblinks: true,
  news: true,
  steamFeatures: true,
};

/** Detect initial platform from user agent before Tauri bridge resolves. */
function detectInitialPlatform(): HostPlatform {
  if (typeof navigator === "undefined") return "windows";
  const ua = (navigator.userAgent || "").toLowerCase();
  const plat = (navigator.platform || "").toLowerCase();
  if (plat.includes("win") || ua.includes("windows")) return "windows";
  if (plat.includes("linux") || ua.includes("linux")) return "linux";
  if (plat.includes("mac") || ua.includes("macintosh") || ua.includes("macos")) return "macos";
  return "windows";
}

// ── Provider ────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Host platform & Linux support level ─────────────────────────────────────
  const [hostPlatform, setHostPlatform] = useState<HostPlatform>(() => {
    // Set before first paint so platform-scoped CSS (e.g. the Linux
    // backdrop-filter fallbacks) applies from the very first frame.
    const p = detectInitialPlatform();
    if (typeof document !== "undefined") {
      document.documentElement.dataset.platform = p;
    }
    return p;
  });

  useEffect(() => {
    let cancelled = false;
    invoke<string>("get_platform")
      .then((p) => {
        if (!cancelled && (p === "windows" || p === "linux" || p === "macos" || p === "unknown")) {
          setHostPlatform(p as HostPlatform);
          document.documentElement.dataset.platform = p;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isLinuxHost = hostPlatform === "linux";
  const isWindowsHost = hostPlatform === "windows";

  const [linuxSupportLevel, setLinuxSupportLevelState] = useState<LinuxSupportLevel>(() => {
    const stored = lsGet(LS_LINUX_SUPPORT_LEVEL);
    if (stored === "disabled" || stored === "deck_verified" || stored === "full") {
      return stored;
    }
    return detectInitialPlatform() === "linux" ? "full" : "disabled";
  });

  const setLinuxSupportLevel = useCallback((next: LinuxSupportLevel) => {
    setLinuxSupportLevelState(next);
    lsSet(LS_LINUX_SUPPORT_LEVEL, next);
  }, []);

  const showDeckVerified = isLinuxHost || linuxSupportLevel === "deck_verified" || linuxSupportLevel === "full";
  const showFullLinuxUi = isLinuxHost || linuxSupportLevel === "full";

  // Rust-backed state ──────────────────────────────────────────────────────
  const [closeToTray, setCloseToTrayState] = useState(false);
  const [minimizeOnLaunch, setMinimizeOnLaunchState] = useState(false);
  const [restoreOnExit, setRestoreOnExitState] = useState(false);
  const [disableElevationPrompts, setDisableElevationPromptsState] =
    useState(false);
  const [startupSplashEnabled, setStartupSplashEnabledState] = useState(true);
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
          startupSplashEnabled: boolean;
        }>("get_launcher_settings");
        if (cancelled) return;
        setCloseToTrayState(s.closeToTrayEnabled);
        setMinimizeOnLaunchState(s.minimizeOnLaunchEnabled);
        setRestoreOnExitState(s.restoreOnExitEnabled);
        setDisableElevationPromptsState(s.disableElevationPrompts);
        setStartupSplashEnabledState(s.startupSplashEnabled);
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

  const setStartupSplashEnabled = useCallback(async (next: boolean) => {
    setStartupSplashEnabledState(next);
    try {
      await invoke("set_startup_splash_enabled", { enabled: next });
    } catch (err) {
      console.warn("[SettingsContext] set_startup_splash_enabled failed:", err);
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

  const [uiSoundEnabled, setUiSoundEnabledState] = useState<boolean>(() => {
    const stored = lsGet(LS_UI_SOUND_ENABLED);
    if (stored !== null) return stored === "true";
    // Nothing persisted: brand-new installs are bootstrapped to OFF;
    // returning installs (first-launch flag already set) keep the
    // legacy ON default so the upgrade is silent for them.
    return lsGet(LS_FIRST_LAUNCH) !== null;
  });
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
    // No explicit choice persisted. The first-launch bootstrap writes
    // "simple"; returning installs that never touched the setting keep
    // Complete.
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

  // Launch splash visibility. Deliberately the same localStorage key the
  // launch path reads directly (SplashContext.isSplashEnabled): GameProvider
  // sits above SettingsProvider, so useLaunch can't consume this hook.
  const [launchSplashEnabled, setLaunchSplashEnabledState] = useState<boolean>(
    () => lsGet(SPLASH_ENABLED_KEY) !== "false",
  );
  const setLaunchSplashEnabled = useCallback((next: boolean) => {
    setLaunchSplashEnabledState(next);
    lsSet(SPLASH_ENABLED_KEY, String(next));
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

  // Per-item UI visibility (Settings → Interface). Same overrides-object
  // pattern as detail sections: defaults all ON, only OFF entries are
  // persisted, and each OFF entry is mirrored to a `data-ui-hide-<key>`
  // attribute on <html> so the CSS rules in theme.css do the hiding.
  const [interfaceVisibility, setInterfaceVisibilityState] =
    useState<InterfaceVisibility>(() => {
      const stored = lsGetJSON<Partial<InterfaceVisibility>>(
        LS_INTERFACE_VISIBILITY,
        {},
      );
      return {
        ...DEFAULT_INTERFACE_VISIBILITY,
        ...stored,
      };
    });
  const setInterfaceVisibility = useCallback(
    (key: InterfaceItemKey, visible: boolean) => {
      setInterfaceVisibilityState((prev) => {
        const next = { ...prev, [key]: visible };
        const overrides: Partial<InterfaceVisibility> = {};
        for (const k of Object.keys(next) as InterfaceItemKey[]) {
          if (next[k] === false) overrides[k] = false;
        }
        lsSetJSON(LS_INTERFACE_VISIBILITY, overrides);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    for (const key of Object.keys(interfaceVisibility) as InterfaceItemKey[]) {
      const attr = `data-ui-hide-${interfaceAttrKey(key)}`;
      if (interfaceVisibility[key] === false) {
        document.documentElement.setAttribute(attr, "true");
      } else {
        document.documentElement.removeAttribute(attr);
      }
    }
  }, [interfaceVisibility]);

  // Navbar tab order (Settings → Interface → Navbar Tabs). Normalized on
  // read and on every write so TopNav can always consume a complete,
  // duplicate-free list.
  const [navbarTabOrder, setNavbarTabOrderState] = useState<InterfaceItemKey[]>(
    () => normalizeNavbarTabOrder(lsGetJSON<unknown>(LS_NAVBAR_TAB_ORDER, null)),
  );
  const setNavbarTabOrder = useCallback((next: InterfaceItemKey[]) => {
    const normalized = normalizeNavbarTabOrder(next);
    setNavbarTabOrderState(normalized);
    lsSetJSON(LS_NAVBAR_TAB_ORDER, normalized);
  }, []);

  // Header button order (Layout Studio → Global). Same normalization as the
  // tab order so TopNav always consumes a complete, duplicate-free list.
  const [navbarButtonOrder, setNavbarButtonOrderState] = useState<
    InterfaceItemKey[]
  >(() => normalizeNavbarButtonOrder(lsGetJSON<unknown>(LS_NAVBAR_BUTTON_ORDER, null)));
  const setNavbarButtonOrder = useCallback((next: InterfaceItemKey[]) => {
    const normalized = normalizeNavbarButtonOrder(next);
    setNavbarButtonOrderState(normalized);
    lsSetJSON(LS_NAVBAR_BUTTON_ORDER, normalized);
  }, []);

  // Sidebar docking side (Layout Studio → Global). Mirrored to a
  // `data-sidebar-position` attribute on <html> so layout.css can flip the
  // app grid and sidebar.css can move the divider to the inner edge.
  const [sidebarPosition, setSidebarPositionState] = useState<SidebarPosition>(() => {
    const stored = lsGet(LS_SIDEBAR_POSITION) === "right" ? "right" : "left";
    // Set before first paint so the app grid never flashes the wrong dock.
    if (typeof document !== "undefined") {
      document.documentElement.dataset.sidebarPosition = stored;
    }
    return stored;
  });
  const setSidebarPosition = useCallback((next: SidebarPosition) => {
    setSidebarPositionState(next);
    lsSet(LS_SIDEBAR_POSITION, next);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.sidebarPosition = sidebarPosition;
  }, [sidebarPosition]);

  // Sidebar section visibility (Layout Studio → Global). Same OFF-entries-only
  // overrides pattern as the other maps so an upgrade adds new sections ON.
  const [sidebarSectionVisible, setSidebarSectionVisibleState] =
    useState<SidebarSectionVisibility>(() =>
      normalizeSidebarSectionVisibility(
        lsGetJSON<unknown>(LS_SIDEBAR_SECTIONS_VISIBLE, null),
      ),
    );
  const setSidebarSectionVisible = useCallback(
    (key: SidebarSectionKey, visible: boolean) => {
      setSidebarSectionVisibleState((prev) => {
        const next = { ...prev, [key]: visible };
        const overrides: Partial<Record<SidebarSectionKey, boolean>> = {};
        for (const section of Object.keys(next) as SidebarSectionKey[]) {
          if (next[section] === false) overrides[section] = false;
        }
        lsSetJSON(LS_SIDEBAR_SECTIONS_VISIBLE, overrides);
        return next;
      });
    },
    [],
  );

  // Per-page widget visibility + order (Layout Studio → page tabs). The
  // runtime bridge (PageLayoutBridge) mirrors the *active* page's entries to
  // `data-ui-page-hide` / `--ui-ord-*` so theme.css only needs one rule per
  // widget category instead of one per page × widget.
  const [pageItemVisible, setPageItemVisibleState] =
    useState<PageItemVisibilityMap>(() =>
      normalizePageItemVisibilityMap(lsGetJSON<unknown>(LS_PAGE_ITEM_VISIBILITY, null)),
    );
  const setPageItemVisible = useCallback(
    (page: InterfacePageKey, widget: PageWidgetKey, visible: boolean) => {
      setPageItemVisibleState((prev) => {
        const pageEntry = { ...(prev[page] ?? {}) };
        if (visible) delete pageEntry[widget];
        else pageEntry[widget] = false;
        const next = { ...prev };
        if (Object.keys(pageEntry).length === 0) delete next[page];
        else next[page] = pageEntry;
        lsSetJSON(
          LS_PAGE_ITEM_VISIBILITY,
          normalizePageItemVisibilityMap(next),
        );
        return next;
      });
    },
    [],
  );

  const [pageItemOrder, setPageItemOrderState] = useState<PageItemOrderMap>(() =>
    normalizePageItemOrderMap(lsGetJSON<unknown>(LS_PAGE_ITEM_ORDER, null)),
  );
  const setPageItemOrder = useCallback(
    (page: InterfacePageKey, next: PageWidgetKey[]) => {
      const normalized = normalizePageItemOrder(page, next);
      setPageItemOrderState((prev) => {
        const merged = { ...prev, [page]: normalized };
        lsSetJSON(LS_PAGE_ITEM_ORDER, merged);
        return merged;
      });
    },
    [],
  );

  // Detail-page tab order (Settings → Interface). Normalized on read and on
  // every write so the detail pages always consume a complete, duplicate-free
  // list; visibility reuses `detailSectionVisible` above (no separate map).
  const [detailTabOrder, setDetailTabOrderState] = useState<DetailTabOrderMap>(
    () => normalizeDetailTabOrderMap(lsGetJSON<unknown>(LS_DETAIL_TAB_ORDER, null)),
  );
  const setDetailTabOrder = useCallback(
    (scope: DetailTabScope, next: DetailTabKey[]) => {
      const normalized = normalizeDetailTabOrder(scope, next);
      setDetailTabOrderState((prev) => {
        const merged = { ...prev, [scope]: normalized };
        lsSetJSON(LS_DETAIL_TAB_ORDER, merged);
        return merged;
      });
    },
    [],
  );

  // Hero element order (Settings → Interface). The element set is shared by
  // both scopes; persistence is per-scope so game and store can differ.
  const [heroElementOrder, setHeroElementOrderState] = useState<HeroElementOrderMap>(
    () => normalizeHeroElementOrderMap(lsGetJSON<unknown>(LS_HERO_ELEMENT_ORDER, null)),
  );
  const setHeroElementOrder = useCallback(
    (scope: HeroScope, next: HeroElementKey[]) => {
      const normalized = normalizeHeroElementOrder(scope, next);
      setHeroElementOrderState((prev) => {
        const merged = { ...prev, [scope]: normalized };
        lsSetJSON(LS_HERO_ELEMENT_ORDER, merged);
        return merged;
      });
    },
    [],
  );

  // Hero element visibility (Settings → Interface). Same OFF-entries-only
  // overrides pattern as the sidebar/page maps so an upgrade adds new
  // elements visible.
  const [heroElementVisibility, setHeroElementVisibilityState] =
    useState<HeroElementVisibilityMap>(() =>
      normalizeHeroElementVisibilityMap(
        lsGetJSON<unknown>(LS_HERO_ELEMENT_VISIBILITY, null),
      ),
    );
  const setHeroElementVisible = useCallback(
    (scope: HeroScope, key: HeroElementKey, visible: boolean) => {
      setHeroElementVisibilityState((prev) => {
        const scopeEntry = { ...(prev[scope] ?? {}) };
        if (visible) delete scopeEntry[key];
        else scopeEntry[key] = false;
        const next = { ...prev };
        if (Object.keys(scopeEntry).length === 0) delete next[scope];
        else next[scope] = scopeEntry;
        lsSetJSON(
          LS_HERO_ELEMENT_VISIBILITY,
          normalizeHeroElementVisibilityMap(next),
        );
        return next;
      });
    },
    [],
  );

  // Hero grid layout (Layout Studio → hero grid). Entirely optional: when no
  // scope is persisted the hero keeps its flex/`order` layout, so existing
  // users are unaffected until they author a grid.
  const [heroGridLayout, setHeroGridLayoutState] = useState<HeroGridLayoutMap>(
    () => normalizeHeroGridLayoutMap(lsGetJSON<unknown>(LS_HERO_GRID_LAYOUT, null)),
  );
  const setHeroGridLayout = useCallback(
    (scope: HeroScope, next: HeroGridLayout) => {
      const normalized = normalizeHeroGridLayout(scope, next);
      setHeroGridLayoutState((prev) => {
        const merged = { ...prev, [scope]: normalized };
        lsSetJSON(LS_HERO_GRID_LAYOUT, merged);
        return merged;
      });
    },
    [],
  );
  const resetHeroGridLayout = useCallback((scope: HeroScope) => {
    setHeroGridLayoutState((prev) => {
      const next = { ...prev };
      delete next[scope];
      lsSetJSON(LS_HERO_GRID_LAYOUT, next);
      return next;
    });
  }, []);

  // Detail-page top-bar order (Settings → Interface). Same append-only
  // normalization as the hero element lane: unknown keys and duplicates are
  // dropped and any newly shipped buttons are appended so nothing goes
  // unrendered on upgrade.
  const [detailTopBarOrder, setDetailTopBarOrderState] = useState<DetailTopBarOrderMap>(
    () => normalizeDetailTopBarOrderMap(lsGetJSON<unknown>(LS_DETAIL_TOP_BAR_ORDER, null)),
  );
  const setDetailTopBarOrder = useCallback(
    (scope: DetailTopBarScope, next: DetailTopBarKey[]) => {
      const normalized = normalizeDetailTopBarOrder(scope, next);
      setDetailTopBarOrderState((prev) => {
        const merged = { ...prev, [scope]: normalized };
        lsSetJSON(LS_DETAIL_TOP_BAR_ORDER, merged);
        return merged;
      });
    },
    [],
  );

  // Detail-page top-bar visibility (Settings → Interface). OFF-only overrides,
  // exactly like heroElementVisibility: a visible item deletes the override so
  // new buttons default to shown.
  const [detailTopBarVisibility, setDetailTopBarVisibilityState] =
    useState<DetailTopBarVisibilityMap>(() =>
      normalizeDetailTopBarVisibilityMap(
        lsGetJSON<unknown>(LS_DETAIL_TOP_BAR_VISIBILITY, null),
      ),
    );
  const setDetailTopBarVisible = useCallback(
    (scope: DetailTopBarScope, key: DetailTopBarKey, visible: boolean) => {
      setDetailTopBarVisibilityState((prev) => {
        const scopeEntry = { ...(prev[scope] ?? {}) };
        if (visible) delete scopeEntry[key];
        else scopeEntry[key] = false;
        const next = { ...prev };
        if (Object.keys(scopeEntry).length === 0) delete next[scope];
        else next[scope] = scopeEntry;
        lsSetJSON(
          LS_DETAIL_TOP_BAR_VISIBILITY,
          normalizeDetailTopBarVisibilityMap(next),
        );
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
      launchSplashEnabled,
      setLaunchSplashEnabled,
      startupSplashEnabled,
      setStartupSplashEnabled,
      detailSectionVisible,
      setDetailSectionVisible,
      interfaceVisibility,
      setInterfaceVisibility,
      navbarTabOrder,
      setNavbarTabOrder,
      navbarButtonOrder,
      setNavbarButtonOrder,
      sidebarPosition,
      setSidebarPosition,
      sidebarSectionVisible,
      setSidebarSectionVisible,
      pageItemVisible,
      setPageItemVisible,
      pageItemOrder,
      setPageItemOrder,
      detailTabOrder,
      setDetailTabOrder,
      heroElementOrder,
      setHeroElementOrder,
      heroElementVisibility,
      setHeroElementVisible,
      heroGridLayout,
      setHeroGridLayout,
      resetHeroGridLayout,
      detailTopBarOrder,
      setDetailTopBarOrder,
      detailTopBarVisibility,
      setDetailTopBarVisible,
      hostPlatform,
      isLinuxHost,
      isWindowsHost,
      linuxSupportLevel,
      setLinuxSupportLevel,
      showDeckVerified,
      showFullLinuxUi,
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
      launchSplashEnabled,
      setLaunchSplashEnabled,
      startupSplashEnabled,
      setStartupSplashEnabled,
      detailSectionVisible,
      setDetailSectionVisible,
      interfaceVisibility,
      setInterfaceVisibility,
      navbarTabOrder,
      setNavbarTabOrder,
      navbarButtonOrder,
      setNavbarButtonOrder,
      sidebarPosition,
      setSidebarPosition,
      sidebarSectionVisible,
      setSidebarSectionVisible,
      pageItemVisible,
      setPageItemVisible,
      pageItemOrder,
      setPageItemOrder,
      detailTabOrder,
      setDetailTabOrder,
      heroElementOrder,
      setHeroElementOrder,
      heroElementVisibility,
      setHeroElementVisible,
      heroGridLayout,
      setHeroGridLayout,
      resetHeroGridLayout,
      detailTopBarOrder,
      setDetailTopBarOrder,
      detailTopBarVisibility,
      setDetailTopBarVisible,
      hostPlatform,
      isLinuxHost,
      isWindowsHost,
      linuxSupportLevel,
      setLinuxSupportLevel,
      showDeckVerified,
      showFullLinuxUi,
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

// ── Visibility helpers (Settings → Interface / Layout Studio) ───────────────
//
// The Layout Studio toggles used to be pure CSS (`display: none`), which still
// mounted every hidden component: its effects, subscriptions and data fetches
// kept running for something the user could not see. These helpers let a
// consumer *not render* a hidden element instead, so it costs nothing.
//
// All of them are null-safe: outside a SettingsProvider (isolated component
// tests, static renders) an element defaults to visible.

/** Generic page-widget categories that are also gated by a global Interface
 *  toggle (`widgetHero`, `widgetKpis`, …) in addition to the per-page map. */
const GENERIC_WIDGET_INTERFACE_KEY: Partial<Record<PageWidgetKey, InterfaceItemKey>> = {
  hero: "widgetHero",
  kpis: "widgetKpis",
  filters: "widgetFilters",
  subtabs: "widgetSubtabs",
  dashboard: "widgetDashboard",
};

/** Whether a global Interface element (nav item, badge, generic widget) is
 *  currently switched on. */
export function useInterfaceItemVisible(key: InterfaceItemKey): boolean {
  const ctx = useContext(SettingsContext);
  if (!ctx) return true;
  return ctx.interfaceVisibility[key] !== false;
}

/** Whether a page widget should be mounted at all. Combines the per-page
 *  Layout Studio map with the global generic toggle for the shared categories
 *  (`hero`, `kpis`, `filters`, `subtabs`, `dashboard`). */
export function useWidgetVisible(
  page: InterfacePageKey,
  widget: PageWidgetKey,
): boolean {
  const ctx = useContext(SettingsContext);
  if (!ctx) return true;
  const globalKey = GENERIC_WIDGET_INTERFACE_KEY[widget];
  if (globalKey && ctx.interfaceVisibility[globalKey] === false) return false;
  return ctx.pageItemVisible[page]?.[widget] !== false;
}

/** Position of a widget within the page's stored order, or `undefined` when it
 *  should keep its shipped position. Defaults to `undefined` outside a
 *  SettingsProvider (isolated tests, static renders). */
export function usePageWidgetOrder(
  page: InterfacePageKey,
  widget: PageWidgetKey,
): number | undefined {
  const ctx = useContext(SettingsContext);
  if (!ctx) return undefined;
  const order = ctx.pageItemOrder[page];
  if (!order) return undefined;
  const i = order.indexOf(widget);
  return i === -1 ? undefined : i;
}

/** Whether a sidebar top-level section should be mounted. */
export function useSidebarSectionVisible(key: SidebarSectionKey): boolean {
  const ctx = useContext(SettingsContext);
  if (!ctx) return true;
  return ctx.sidebarSectionVisible[key] !== false;
}

/** Effective detail-page tab order for a scope. Defaults to the shipped order
 *  outside a SettingsProvider (isolated tests, static renders). */
export function useDetailTabOrder(scope: DetailTabScope): DetailTabKey[] {
  const ctx = useContext(SettingsContext);
  if (!ctx) return DETAIL_TABS[scope];
  return resolveDetailTabOrder(ctx.detailTabOrder, scope);
}

/** Effective hero element order + OFF-only hidden entries for a scope.
 *  Defaults to the shipped order and nothing hidden outside a provider. */
export function useHeroElementLayout(scope: HeroScope): {
  order: HeroElementKey[];
  hidden: Partial<Record<HeroElementKey, boolean>>;
} {
  const ctx = useContext(SettingsContext);
  if (!ctx) return { order: HERO_ELEMENTS, hidden: {} };
  return {
    order: resolveHeroElementOrder(ctx.heroElementOrder, scope),
    hidden: resolveHeroElementHidden(ctx.heroElementVisibility, scope),
  };
}

/** Effective hero grid layout for a scope, or `null` when no grid has been
 *  authored (the hero then renders its flex/`order` layout). Defaults to
 *  `null` outside a SettingsProvider (isolated tests, static renders). */
export function useHeroGridLayout(scope: HeroScope): HeroGridLayout | null {
  const ctx = useContext(SettingsContext);
  if (!ctx) return null;
  return resolveHeroGridLayout(ctx.heroGridLayout, scope);
}

/** Effective detail-page top-bar order + OFF-only hidden entries for a scope.
 *  Defaults to the shipped order and nothing hidden outside a provider. */
export function useDetailTopBarLayout(scope: DetailTopBarScope): {
  order: DetailTopBarKey[];
  hidden: Partial<Record<DetailTopBarKey, boolean>>;
} {
  const ctx = useContext(SettingsContext);
  if (!ctx) return { order: DETAIL_TOP_BAR[scope], hidden: {} };
  return {
    order: resolveDetailTopBarOrder(ctx.detailTopBarOrder, scope),
    hidden: resolveDetailTopBarHidden(ctx.detailTopBarVisibility, scope),
  };
}
