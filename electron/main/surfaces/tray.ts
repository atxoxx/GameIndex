/**
 * System tray + close-to-tray support.
 *
 * Menu shape (ported from `src-tauri/src/tray.rs`):
 *
 *   Status line (disabled): "GameIndex — idle" / "Playing: <name>"
 *   ─────────────
 *   Show GameIndex / Hide to tray
 *   ─────────────
 *   Library · Store · Activity · Friends · Mods · Settings · Downloads
 *   ─────────────
 *   Quit GameIndex
 *
 * Labels arrive from the renderer as the `tray-strings` event
 * (`src/hooks/useTrayStrings.ts`) whenever the UI language changes; English
 * defaults apply until the first emission. Navigation items emit `navigate`
 * with `{ path }`, which `src/hooks/useTrayNavigation.ts` routes.
 *
 * Left-clicking the icon reveals the window; the context menu is the
 * right-click action (Discord/Steam behaviour).
 *
 * Not ported: the Recent Games and Downloads submenus. They are built from the
 * library database and the live download queue, neither of which the Electron
 * main process has yet; adding them later only means extending `buildMenu`.
 */
import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { emit, onEvent } from "../ipc";
import { getAppSetting, setAppSetting } from "../state/appSettings";
import { markQuitting } from "../quitState";
import { allowMainWindowClose, getMainWindow, revealMainWindow } from "./mainWindow";

/** Every user-facing tray string, as emitted by the renderer. */
interface TrayStrings {
  idle: string;
  playing: string;
  show: string;
  hide: string;
  quit: string;
  recent: string;
  noRecent: string;
  downloads: string;
  downloadsActive: string;
  noDownloads: string;
  downloadRow: string;
  downloadStarting: string;
  openDownloads: string;
  library: string;
  store: string;
  activity: string;
  friends: string;
  mods: string;
  settings: string;
}

/** English fallback in effect until the renderer's first `tray-strings`. */
const DEFAULT_STRINGS: TrayStrings = {
  idle: "GameIndex — idle",
  playing: "Playing: {game}",
  show: "Show GameIndex",
  hide: "Hide to tray",
  quit: "Quit GameIndex",
  recent: "Recent Games",
  noRecent: "No recent games",
  downloads: "Downloads",
  downloadsActive: "Downloads: {count} active",
  noDownloads: "No active downloads",
  downloadRow: "{name} — {pct}% ({downloaded} / {total})",
  downloadStarting: "{name} — starting…",
  openDownloads: "Open Downloads",
  library: "Library",
  store: "Store",
  activity: "Activity",
  friends: "Friends",
  mods: "Mods",
  settings: "Settings",
};

/** Pages the tray can route to (`useTrayNavigation` ignores anything else). */
const NAV_ITEMS: Array<{ path: string; key: keyof TrayStrings }> = [
  { path: "/library", key: "library" },
  { path: "/store", key: "store" },
  { path: "/activity", key: "activity" },
  { path: "/friends", key: "friends" },
  { path: "/mods", key: "mods" },
  { path: "/settings", key: "settings" },
];

let tray: Tray | null = null;
let strings: TrayStrings = { ...DEFAULT_STRINGS };
/** Currently running game name, from `game-started` / `game-exited`. */
let playing: string | null = null;
const unsubscribers: Array<() => void> = [];

/** `{key}` substitution, same helper shape the Rust tray used. */
function fill(template: string, pairs: Array<[string, string]>): string {
  let out = template;
  for (const [key, value] of pairs) out = out.split(`{${key}}`).join(value);
  return out;
}

function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "tray.png")
    : path.join(app.getAppPath(), "build", "tray.png");
}

function loadTrayIcon(): Electron.NativeImage {
  const primary = nativeImage.createFromPath(trayIconPath());
  if (!primary.isEmpty()) return primary;
  // Packaged builds without the extraResource, or a dev checkout missing
  // build/tray.png: fall back to the app icon so the tray stays usable.
  const fallback = nativeImage.createFromPath(path.join(app.getAppPath(), "build", "icon.png"));
  if (!fallback.isEmpty()) return fallback;
  console.warn("[tray] icon missing at", trayIconPath());
  return nativeImage.createEmpty();
}

function navLabel(item: { path: string; key: keyof TrayStrings }): string {
  return strings[item.key] || DEFAULT_STRINGS[item.key];
}

function buildMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  const visible = getMainWindow()?.isVisible() ?? false;
  const statusText = playing
    ? fill(strings.playing || DEFAULT_STRINGS.playing, [["game", playing]])
    : strings.idle || DEFAULT_STRINGS.idle;

  const template: MenuItemConstructorOptions[] = [
    { id: "status", label: statusText, enabled: false },
    { type: "separator" },
    { id: "show", label: strings.show || DEFAULT_STRINGS.show, click: () => { revealMainWindow(); refreshTrayMenu(); } },
    // Hide is pointless when the window is already hidden.
    {
      id: "hide",
      label: strings.hide || DEFAULT_STRINGS.hide,
      enabled: visible,
      click: () => {
        getMainWindow()?.hide();
        refreshTrayMenu();
      },
    },
    { type: "separator" },
    ...NAV_ITEMS.map<MenuItemConstructorOptions>((item) => ({
      id: `nav:${item.path}`,
      label: navLabel(item),
      click: () => {
        revealMainWindow();
        emit("navigate", { path: item.path });
      },
    })),
    {
      id: "nav:/downloads",
      label: strings.openDownloads || DEFAULT_STRINGS.openDownloads,
      click: () => {
        revealMainWindow();
        emit("navigate", { path: "/downloads" });
      },
    },
    { type: "separator" },
    {
      id: "quit",
      label: strings.quit || DEFAULT_STRINGS.quit,
      click: () => {
        markQuitting();
        allowMainWindowClose();
        destroyTray();
        app.quit();
      },
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(statusText);
}

function applyStrings(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const value = payload as Record<string, unknown>;
  const next: TrayStrings = { ...DEFAULT_STRINGS };
  for (const key of Object.keys(DEFAULT_STRINGS) as Array<keyof TrayStrings>) {
    if (typeof value[key] === "string") next[key] = value[key] as string;
  }
  strings = next;
  buildMenu();
}

export function installTray(): void {
  if (tray && !tray.isDestroyed()) return;
  tray = new Tray(loadTrayIcon());
  tray.setToolTip(DEFAULT_STRINGS.idle);
  // Left-click acts as "Show GameIndex" so the user can dismiss the menu
  // without an extra click; the context menu stays on right-click.
  tray.on("click", () => revealMainWindow());
  buildMenu();

  unsubscribers.push(
    onEvent("tray-strings", applyStrings),
    onEvent("game-started", (payload) => {
      const value =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const name = typeof value.gameName === "string" ? value.gameName : "";
      if (!name) return;
      playing = name;
      buildMenu();
    }),
    onEvent("game-exited", (payload) => {
      const value =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const remaining =
        typeof value.remainingGameName === "string" ? value.remainingGameName : "";
      playing = remaining || null;
      buildMenu();
    }),
  );
}

export function isTrayAvailable(): boolean {
  return tray !== null && !tray.isDestroyed();
}

export function isCloseToTrayEnabled(): boolean {
  return Boolean(getAppSetting("close_to_tray"));
}

export function setCloseToTray(enabled: boolean): void {
  setAppSetting("close_to_tray", enabled);
}

/** Rebuild the menu (e.g. after the main window was shown or hidden). */
export function refreshTrayMenu(): void {
  buildMenu();
}

export function destroyTray(): void {
  for (const unsubscribe of unsubscribers.splice(0)) {
    try {
      unsubscribe();
    } catch {
      /* listener already gone */
    }
  }
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}
