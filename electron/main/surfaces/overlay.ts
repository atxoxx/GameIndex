/**
 * In-game overlay HUD: a transparent, always-on-top, non-activating window that
 * floats over a borderless-windowed game.
 *
 * Ported from `src-tauri/src/overlay.rs`. What lives here:
 *   • the lazy window lifecycle (built on first show, kept warm afterwards)
 *   • corner geometry + dragged-position persistence
 *   • the collapsed ticker ↔ interactive panel presentation switch
 *   • click-through / keyboard-focus behaviour per presentation
 *   • the global toggle hotkey (plus the screenshot hotkey)
 *   • settings + telemetry-history persistence
 *   • live telemetry sampling (`overlay:metrics`)
 *
 * What is NOT here (see the port notes in each command):
 *   • native acrylic/blur (`overlay_native_blur_supported` reports false —
 *     Chromium cannot apply DWM materials to a transparent window)
 *   • GPU/FPS/temperature metrics (no vendor SDKs without native code)
 *   • video capture (record / replay buffer)
 *   • `overlay_detect_game` (needs the library + process enumeration)
 */
import { BrowserWindow, app, globalShortcut, screen } from "electron";
import { emit, emitTo, getWindowLabel, onEvent, setWindowLabel } from "../ipc";
import { revealMainWindow } from "./mainWindow";
import { attachWindowEvents } from "./events";
import { loadRenderer, preloadPath } from "./renderer";
import {
  deleteScreenshotFile,
  listRecentScreenshots,
  openCaptureLocation,
  writeCapture,
  type ScreenshotResult,
} from "./overlayCapture";
import {
  startLiveMetrics,
  stopLiveMetrics,
} from "./overlayMetrics";
import {
  DEFAULT_OVERLAY_SETTINGS,
  MAX_OVERLAY_DIM,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  MIN_TICKER_HEIGHT,
  MIN_TICKER_WIDTH,
  OVERLAY_MARGIN,
  isOverlayCorner,
  loadOverlayStore,
  normalizeOverlaySettings,
  persistOverlayStore,
  type OverlayCorner,
  type OverlaySettings,
  type OverlayStore,
} from "./overlaySettings";

export type { OverlayCorner, OverlaySettings };

/** Events (kept as consts so the renderer contract has one source of truth). */
export const EVENT_METRICS = "overlay:metrics";
export const EVENT_TOGGLE = "overlay:toggle";
export const EVENT_SESSION = "overlay:session";
export const EVENT_CLOSED = "overlay:closed";
export const EVENT_SETTINGS = "overlay:settings";
export const EVENT_HOTKEY_ERROR = "overlay:hotkey-error";
export const EVENT_SCREENSHOT = "overlay:screenshot-captured";

/** Session descriptor pushed to the overlay as `overlay:session`. */
export interface OverlaySession {
  gameId: string;
  startedAt: number;
  /** Process id of the game, or `0` while the launch is still pending. */
  pid?: number;
  /** Display name, when the launch event carried one. */
  name?: string;
}

let overlayWindow: BrowserWindow | null = null;
let store: OverlayStore | null = null;
let collapsed = true;
let session: OverlaySession | null = null;
/**
 * Whether the collapsed ticker still resizes itself to its content. A manual
 * resize turns it off so the user's size sticks; a settings change turns it
 * back on (the widget set is what the auto-fit follows).
 */
let tickerAutoFit = true;
let followTimer: NodeJS.Timeout | null = null;
let followGeneration = 0;
let followMonitorOrigin: string | null = null;
let installed = false;
/** Serializes screenshot captures so two hotkey presses can't interleave. */
let screenshotInFlight = false;

// ── Settings store ──────────────────────────────────────────────────
function getStore(): OverlayStore {
  if (!store) store = loadOverlayStore();
  return store;
}

function persist(): void {
  if (store) persistOverlayStore(store);
}

export function getOverlaySettings(): OverlaySettings {
  return getStore().settings;
}

export function getOverlaySession(): OverlaySession | null {
  return session;
}

/** Persist a settings change and broadcast it to every window. */
function commitSettings(next: OverlaySettings): void {
  const target = getStore();
  target.settings = next;
  persist();
  emit(EVENT_SETTINGS, next);
}

// ── Geometry ────────────────────────────────────────────────────────
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function minOverlaySize(isCollapsed: boolean): [number, number] {
  return isCollapsed
    ? [MIN_TICKER_WIDTH, MIN_TICKER_HEIGHT]
    : [MIN_PANEL_WIDTH, MIN_PANEL_HEIGHT];
}

/** Window footprint for the ticker vs the expanded panel, clamped. */
function overlaySize(settings: OverlaySettings, isCollapsed: boolean): [number, number] {
  const [minW, minH] = minOverlaySize(isCollapsed);
  const width = isCollapsed ? settings.tickerWidth : settings.panelWidth;
  const height = isCollapsed ? settings.tickerHeight : settings.panelHeight;
  return [
    clamp(Number(width) || minW, minW, MAX_OVERLAY_DIM),
    clamp(Number(height) || minH, minH, MAX_OVERLAY_DIM),
  ];
}

/**
 * The monitor the HUD targets. There is no portable "monitor of the game
 * window" API, so this follows the cursor (usually inside a borderless game),
 * then falls back to the primary display.
 */
function targetWorkArea(): Rect {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    return { x: area.x, y: area.y, width: area.width, height: area.height };
  } catch {
    return { x: 0, y: 0, width: 1920, height: 1080 };
  }
}

/** Pure corner math, matching the Rust `corner_rect`. */
export function cornerRect(
  corner: OverlayCorner,
  workArea: Rect,
  size: [number, number],
  margin: number,
): { x: number; y: number } {
  const [width, height] = size;
  let x: number;
  let y: number;
  switch (corner) {
    case "top-left":
      x = workArea.x + margin;
      y = workArea.y + margin;
      break;
    case "top-right":
      x = workArea.x + workArea.width - width - margin;
      y = workArea.y + margin;
      break;
    case "bottom-left":
      x = workArea.x + margin;
      y = workArea.y + workArea.height - height - margin;
      break;
    default:
      x = workArea.x + workArea.width - width - margin;
      y = workArea.y + workArea.height - height - margin;
      break;
  }
  // Never place the window outside the work area's top-left, even when the
  // overlay is larger than the monitor (tiny/rotated displays).
  return { x: Math.max(x, workArea.x), y: Math.max(y, workArea.y) };
}

/** An explicit dragged position wins; otherwise anchor to the corner. */
function resolvePosition(settings: OverlaySettings, size: [number, number]): { x: number; y: number } {
  const workArea = targetWorkArea();
  if (typeof settings.posX === "number" && typeof settings.posY === "number") {
    return {
      x: Math.round(
        clamp(settings.posX, workArea.x, Math.max(workArea.x, workArea.x + workArea.width - size[0])),
      ),
      y: Math.round(
        clamp(settings.posY, workArea.y, Math.max(workArea.y, workArea.y + workArea.height - size[1])),
      ),
    };
  }
  const point = cornerRect(settings.corner, workArea, size, OVERLAY_MARGIN);
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function applyGeometry(win: BrowserWindow, settings: OverlaySettings, isCollapsed: boolean): void {
  if (win.isDestroyed()) return;
  const size = overlaySize(settings, isCollapsed);
  const { x, y } = resolvePosition(settings, size);
  const current = win.getBounds();
  // Skip the no-op round-trip: the monitor-follow loop re-evaluates this every
  // few seconds and each native call would otherwise churn the window.
  if (
    Math.abs(current.x - x) <= 2 &&
    Math.abs(current.y - y) <= 2 &&
    Math.abs(current.width - size[0]) <= 2 &&
    Math.abs(current.height - size[1]) <= 2
  ) {
    return;
  }
  win.setBounds({
    x,
    y,
    width: Math.round(size[0]),
    height: Math.round(size[1]),
  });
}

/** Whether the window should pass mouse input through to the game behind it. */
function shouldIgnoreCursor(settings: OverlaySettings, isCollapsed: boolean): boolean {
  return isCollapsed && Boolean(settings.tickerClickThrough);
}

/**
 * Click-through + keyboard focus for a presentation. The collapsed ticker is
 * non-activating so it never steals foreground from the game (many borderless
 * games minimise when that happens); the expanded panel needs the keyboard for
 * its notes/hotkey inputs, so it becomes focusable.
 */
function applyInteraction(
  win: BrowserWindow,
  settings: OverlaySettings,
  isCollapsed: boolean,
): void {
  if (win.isDestroyed()) return;
  try {
    win.setIgnoreMouseEvents(shouldIgnoreCursor(settings, isCollapsed), { forward: true });
  } catch (error) {
    console.warn("[overlay] setIgnoreMouseEvents failed:", error);
  }
  // setFocusable is Windows/macOS only; on Linux it is not implemented.
  if (process.platform !== "linux") {
    try {
      win.setFocusable(!isCollapsed);
    } catch (error) {
      console.warn("[overlay] setFocusable failed:", error);
    }
  }
}

// ── Window lifecycle ────────────────────────────────────────────────
export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null;
}

export function getOverlayLabel(): string {
  return getWindowLabel(getOverlayWindow());
}

export function currentSlideTheme(): string {
  return String(getOverlaySettings().backgroundStyle ?? "glass");
}

export function createOverlayWindow(): BrowserWindow {
  const existing = getOverlayWindow();
  if (existing) return existing;

  const settings = getOverlaySettings();
  const size = overlaySize(settings, collapsed);
  const position = resolvePosition(settings, size);

  const win = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: Math.round(size[0]),
    height: Math.round(size[1]),
    transparent: true,
    frame: false,
    resizable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    backgroundColor: "#00000000",
    title: "GameIndex Overlay",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // A hidden/throttled HUD would freeze its ticker while the game runs.
      backgroundThrottling: false,
    },
  });

  overlayWindow = win;
  setWindowLabel(win, "overlay");
  attachWindowEvents(win);
  win.setAlwaysOnTop(true, "screen-saver");
  if (process.platform !== "win32") {
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      /* unsupported on this platform */
    }
  }
  applyInteraction(win, settings, collapsed);

  win.on("closed", () => {
    overlayWindow = null;
    stopFollow();
    stopLiveMetrics();
    session = null;
    emit(EVENT_CLOSED, null);
  });

  void loadRenderer(win, { window: "overlay" });
  return win;
}

/** Build (if needed), position and show the overlay in one presentation. */
export function presentOverlay(isCollapsed: boolean): void {
  collapsed = isCollapsed;
  const settings = getOverlaySettings();
  const win = createOverlayWindow();

  if (win.isMinimized()) win.restore();
  // Re-assert topmost on every show: some games reset the Z order when they
  // enter fullscreen, which would otherwise bury the HUD.
  win.setAlwaysOnTop(true, "screen-saver");
  applyGeometry(win, settings, isCollapsed);
  // Deliberately no focus(): yanking focus from a running game can drop its
  // input. The HUD is always-on-top; clicking the ticker expands it.
  win.showInactive();
  win.setAlwaysOnTop(true, "screen-saver");
  applyInteraction(win, settings, isCollapsed);

  // Replay the current session so a freshly built overlay renders without
  // waiting for the next lifecycle event, and tell the renderer which
  // presentation to draw (it boots on the ticker otherwise).
  emitTo(win, EVENT_SESSION, session);
  emitTo(win, EVENT_TOGGLE, { collapsed: isCollapsed });

  spawnLiveMetrics(settings);
  startFollow();
}

/** Show the HUD in the ticker presentation (surface-level entry point). */
export function showOverlay(): void {
  presentOverlay(true);
}

/** Hide the HUD without destroying it; the next show is then instant. */
export function hideOverlay(): void {
  const win = getOverlayWindow();
  if (win) win.hide();
  stopLiveMetrics();
  stopFollow();
}

/** Hotkey behaviour: hidden → ticker → panel → hidden. */
export function toggleOverlayFromHotkey(): void {
  if (!getOverlaySettings().enabled) return;
  const win = getOverlayWindow();
  const visible = win?.isVisible() ?? false;
  if (!visible) {
    presentOverlay(true);
    return;
  }
  if (collapsed) {
    presentOverlay(false);
    return;
  }
  if (win) win.hide();
  stopLiveMetrics();
  stopFollow();
}

/** Switch presentation, resizing/repositioning to match the visible content. */
export function setOverlayCollapsed(isCollapsed: boolean): void {
  collapsed = isCollapsed;
  const win = getOverlayWindow();
  if (!win) return;
  const settings = getOverlaySettings();
  applyGeometry(win, settings, isCollapsed);
  applyInteraction(win, settings, isCollapsed);
  win.setAlwaysOnTop(true, "screen-saver");
}

/** Toggle whether the HUD receives mouse input. */
export function setOverlayInteractive(interactive: boolean): void {
  const win = getOverlayWindow();
  if (!win) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
}

/** Jump from the HUD to the full overlay settings page. */
export function openOverlaySettings(): void {
  hideOverlay();
  revealMainWindow();
  emit("app:navigate", "/settings/overlay");
}

// ── Monitor follow ──────────────────────────────────────────────────
/**
 * Re-anchor the HUD when the game's monitor changes. One interval per
 * `present`; the generation counter retires the previous one. It exits as soon
 * as the window is gone/hidden, or the user dragged the HUD to a manual
 * position.
 */
function startFollow(): void {
  stopFollow();
  followGeneration += 1;
  const generation = followGeneration;
  followMonitorOrigin = null;
  followTimer = setInterval(() => {
    const win = getOverlayWindow();
    if (!win || !win.isVisible() || generation !== followGeneration) {
      stopFollow();
      return;
    }
    const settings = getOverlaySettings();
    if (settings.posX != null || settings.posY != null) {
      stopFollow();
      return;
    }
    // Keep the HUD above fullscreen games that may have re-claimed topmost.
    win.setAlwaysOnTop(true, "screen-saver");
    const workArea = targetWorkArea();
    const origin = `${workArea.x}:${workArea.y}`;
    if (followMonitorOrigin === origin) return;
    followMonitorOrigin = origin;
    applyGeometry(win, settings, collapsed);
  }, 5000);
  followTimer.unref?.();
}

function stopFollow(): void {
  if (followTimer) {
    clearInterval(followTimer);
    followTimer = null;
  }
  followGeneration += 1;
  followMonitorOrigin = null;
}

// ── Live metrics ────────────────────────────────────────────────────
/**
 * Start telemetry while the HUD is on screen (there is nothing to render
 * otherwise). The Electron sampler reads whole-machine CPU/RAM (see
 * `overlayMetrics.ts`), so no process id or GPU selection is involved.
 */
export function startOverlayLiveMetrics(options: {
  intervalMs?: number | null;
} = {}): void {
  const win = getOverlayWindow();
  if (!win || !win.isVisible()) return;
  const settings = getOverlaySettings();
  const interval =
    typeof options.intervalMs === "number" && Number.isFinite(options.intervalMs)
      ? options.intervalMs
      : settings.pollIntervalMs;
  startLiveMetrics(interval, (sample) => {
    const target = getOverlayWindow();
    if (!target) return;
    emitTo(target, EVENT_METRICS, sample);
  });
}

export function stopOverlayLiveMetrics(): void {
  stopLiveMetrics();
}

function spawnLiveMetrics(settings: OverlaySettings): void {
  startOverlayLiveMetrics({ intervalMs: settings.pollIntervalMs });
}

// ── Bounds / drag / resize ──────────────────────────────────────────
/**
 * Persist the window's current position + footprint for the active
 * presentation. Called (debounced) by the renderer after a drag or resize.
 */
export function saveOverlayBounds(): void {
  const win = getOverlayWindow();
  if (!win) return;
  const settings = getOverlaySettings();
  const bounds = win.getBounds();
  const size = overlaySize(settings, collapsed);

  // Programmatic resizes (content auto-fit, a ticker/panel switch) fire the
  // same move/resize events as a manual drag. Keep the HUD corner-anchored
  // while it still sits exactly where the corner math puts it, so those events
  // can't silently pin an absolute position and kill monitor-follow.
  const cornerAnchor = cornerRect(
    settings.corner,
    targetWorkArea(),
    size,
    OVERLAY_MARGIN,
  );
  const anchored =
    settings.posX == null &&
    settings.posY == null &&
    Math.abs(bounds.x - Math.round(cornerAnchor.x)) < 2 &&
    Math.abs(bounds.y - Math.round(cornerAnchor.y)) < 2;

  if (!anchored) {
    settings.posX = bounds.x;
    settings.posY = bounds.y;
  }
  if (collapsed) {
    settings.tickerWidth = clamp(bounds.width, MIN_TICKER_WIDTH, MAX_OVERLAY_DIM);
    settings.tickerHeight = clamp(bounds.height, MIN_TICKER_HEIGHT, MAX_OVERLAY_DIM);
  } else {
    settings.panelWidth = clamp(bounds.width, MIN_PANEL_WIDTH, MAX_OVERLAY_DIM);
    settings.panelHeight = clamp(bounds.height, MIN_PANEL_HEIGHT, MAX_OVERLAY_DIM);
  }
  persist();
}

/**
 * Resize the ticker to fit its measured content. Ignores sub-3 px churn so the
 * renderer's ResizeObserver can't ping-pong with mixed-DPI layout passes.
 */
export function fitOverlayTicker(width: number, height: number): void {
  if (!collapsed || !tickerAutoFit) return;
  const settings = getOverlaySettings();
  const nextWidth = clamp(Number(width) || MIN_TICKER_WIDTH, MIN_TICKER_WIDTH, MAX_OVERLAY_DIM);
  const nextHeight = clamp(Number(height) || MIN_TICKER_HEIGHT, MIN_TICKER_HEIGHT, MAX_OVERLAY_DIM);
  if (
    Math.abs(settings.tickerWidth - nextWidth) < 3 &&
    Math.abs(settings.tickerHeight - nextHeight) < 3
  ) {
    return;
  }
  settings.tickerWidth = nextWidth;
  settings.tickerHeight = nextHeight;
  persist();
  const win = getOverlayWindow();
  if (win) applyGeometry(win, settings, true);
}

/**
 * Move the HUD by a physical-pixel delta (the renderer's pointer drag path,
 * used on Wayland where the native move gesture is unavailable). The first
 * move seeds an explicit position from the current corner.
 */
export function moveOverlayBy(dx: number, dy: number): void {
  const win = getOverlayWindow();
  if (!win) return;
  const settings = getOverlaySettings();
  const size = overlaySize(settings, collapsed);
  const workArea = targetWorkArea();

  // The renderer sends physical pixels (pointer deltas × devicePixelRatio);
  // BrowserWindow geometry is DIP.
  let scale = 1;
  try {
    scale = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
  } catch {
    scale = 1;
  }
  const deltaX = Number(dx) / scale;
  const deltaY = Number(dy) / scale;
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

  const current = resolvePosition(settings, size);
  const nextX = clamp(
    current.x + deltaX,
    workArea.x,
    Math.max(workArea.x, workArea.x + workArea.width - size[0]),
  );
  const nextY = clamp(
    current.y + deltaY,
    workArea.y,
    Math.max(workArea.y, workArea.y + workArea.height - size[1]),
  );

  settings.posX = Math.round(nextX);
  settings.posY = Math.round(nextY);
  persist();
  applyGeometry(win, settings, collapsed);
}

/** Resize the HUD to `width` × `height` logical pixels (drag handles). */
export function resizeOverlayTo(width: number, height: number): void {
  const settings = getOverlaySettings();
  const [minW, minH] = minOverlaySize(collapsed);
  const nextWidth = clamp(Number(width) || minW, minW, MAX_OVERLAY_DIM);
  const nextHeight = clamp(Number(height) || minH, minH, MAX_OVERLAY_DIM);

  if (collapsed) {
    settings.tickerWidth = nextWidth;
    settings.tickerHeight = nextHeight;
    // The user sized the ticker directly; stop the content auto-fit from
    // snapping it back until the widget set changes again.
    tickerAutoFit = false;
  } else {
    settings.panelWidth = nextWidth;
    settings.panelHeight = nextHeight;
  }
  persist();
  const win = getOverlayWindow();
  if (win) applyGeometry(win, settings, collapsed);
}

/** Reposition to a new corner and persist the choice. */
export function setOverlayCorner(corner: string): OverlaySettings {
  if (!isOverlayCorner(corner)) {
    throw new Error(`invalid overlay corner: ${corner}`);
  }
  const settings = getOverlaySettings();
  settings.corner = corner;
  // Re-anchor to the corner: drop any dragged position.
  settings.posX = null;
  settings.posY = null;
  persist();
  emit(EVENT_SETTINGS, settings);
  const win = getOverlayWindow();
  if (win) applyGeometry(win, settings, collapsed);
  // Clearing the dragged position re-arms corner anchoring; the follow loop
  // exited when the manual position appeared, so respawn it here.
  if (win && win.isVisible()) startFollow();
  return settings;
}

// ── Settings / hotkeys ──────────────────────────────────────────────
type BindingKind = "toggle" | "screenshot";

interface RegisteredBinding {
  /** Accelerator as stored in settings (Tauri spelling). */
  raw: string;
  /** Accelerator actually handed to `globalShortcut`. */
  electron: string;
}

const bindings: Record<BindingKind, RegisteredBinding | null> = {
  toggle: null,
  screenshot: null,
};

function dispatchBinding(kind: BindingKind): void {
  const settings = getOverlaySettings();
  // Every dispatch is gated on the master switch: a stale binding must never
  // act on a HUD the user turned off.
  if (!settings.enabled) return;
  if (kind === "toggle") {
    toggleOverlayFromHotkey();
    return;
  }
  void captureScreenshot(null).catch((error: unknown) => {
    console.error("[overlay] screenshot hotkey failed:", error);
  });
}

/**
 * Map Tauri accelerator spellings onto Electron's.
 *
 * The renderer records accelerators from `KeyboardEvent.key` (`ArrowUp`,
 * `Escape`, …) because that is what the Tauri global-shortcut plugin parsed.
 * Electron's parser wants `Up` / `Down` / `Left` / `Right`.
 */
function normalizeAccelerator(accelerator: string): string {
  const aliases: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    CmdOrCtrl: "CommandOrControl",
    Cmd: "Command",
    Option: "Alt",
    OS: "Super",
  };
  return accelerator
    .split("+")
    .map((part) => aliases[part] ?? part)
    .join("+");
}

/**
 * Register `accelerator` for `kind`, replacing any previous binding. An empty
 * accelerator unbinds; an invalid/conflicting one keeps the previous binding
 * registered and throws a readable error.
 */
function registerBinding(kind: BindingKind, accelerator: string): void {
  const previous = bindings[kind];
  const trimmed = String(accelerator ?? "").trim();

  if (!trimmed) {
    if (previous) {
      try {
        globalShortcut.unregister(previous.electron);
      } catch {
        /* already gone */
      }
    }
    bindings[kind] = null;
    return;
  }

  if (previous?.raw === trimmed) return;

  const electronAccelerator = normalizeAccelerator(trimmed);
  let registered = false;
  try {
    registered = globalShortcut.register(electronAccelerator, () => dispatchBinding(kind));
  } catch (error) {
    throw new Error(
      `failed to register '${trimmed}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!registered) {
    // The previous binding is still in place: we never unregistered it.
    throw new Error(`failed to register '${trimmed}': accelerator is unavailable`);
  }

  if (previous) {
    try {
      globalShortcut.unregister(previous.electron);
    } catch {
      /* already gone */
    }
  }
  bindings[kind] = { raw: trimmed, electron: electronAccelerator };
}

function unregisterAllBindings(): void {
  for (const kind of ["toggle", "screenshot"] as BindingKind[]) {
    const binding = bindings[kind];
    if (binding) {
      try {
        globalShortcut.unregister(binding.electron);
      } catch {
        /* already gone */
      }
      bindings[kind] = null;
    }
  }
}

function emitHotkeyError(binding: BindingKind, accelerator: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[overlay] ${binding} hotkey registration failed: ${message}`);
  // Non-fatal, but the settings UI should know the binding was rejected
  // (conflict / invalid accelerator) so it can warn the user.
  emit(EVENT_HOTKEY_ERROR, { binding, accelerator, error: message });
}

/**
 * (Re)apply the stored hotkeys. The toggle binding is authoritative: when the
 * overlay is disabled every binding is dropped so a stray Shift+F1 can never
 * pop a HUD the user turned off.
 */
function applyHotkeys(settings: OverlaySettings): void {
  if (!settings.enabled) {
    unregisterAllBindings();
    return;
  }
  registerBinding("toggle", settings.hotkey);
  // Screenshot capture is best-effort; a conflict is reported, never fatal.
  try {
    registerBinding("screenshot", settings.screenshotHotkey);
  } catch (error) {
    emitHotkeyError("screenshot", settings.screenshotHotkey, error);
  }
}

/** Persist a full settings payload and apply the parts the backend owns. */
export function saveOverlaySettings(raw: Partial<OverlaySettings>): void {
  if (raw && typeof raw === "object" && raw.corner != null && !isOverlayCorner(raw.corner)) {
    throw new Error(`invalid overlay corner: ${String(raw.corner)}`);
  }
  const settings = normalizeOverlaySettings(raw);
  // Apply the hotkeys first: an invalid/conflicting accelerator must reject the
  // save instead of persisting a binding that never took effect.
  applyHotkeys(settings);
  // A settings change alters the ticker's widget set, so let the content
  // auto-fit take over again even if the user had resized manually.
  tickerAutoFit = true;
  commitSettings(settings);

  const win = getOverlayWindow();
  if (win) {
    applyGeometry(win, settings, collapsed);
    applyInteraction(win, settings, collapsed);
    if (session && win.isVisible()) spawnLiveMetrics(settings);
  }
}

/**
 * Re-register the global toggle hotkey and return the updated settings. On an
 * invalid accelerator the error is thrown and the previous binding is kept.
 */
export function setOverlayHotkey(accelerator: string): OverlaySettings {
  const settings = getOverlaySettings();
  const trimmed = String(accelerator ?? "").trim();
  // While the overlay is disabled the accelerator is recorded but NOT bound.
  if (settings.enabled) registerBinding("toggle", trimmed);
  settings.hotkey = trimmed;
  persist();
  emit(EVENT_SETTINGS, settings);
  return settings;
}

/**
 * Whether the platform supports a native window backdrop (real
 * behind-the-window blur).
 *
 * Always `false` here: Chromium cannot apply DWM acrylic/mica to a transparent
 * window (the two are mutually exclusive), and the HUD must be transparent for
 * its rounded card. The renderer therefore uses its CSS glass fallback. The
 * `overlay_set_window_effect` command still records the preference so the
 * contract stays intact.
 */
export function nativeBlurSupported(): boolean {
  return false;
}

/**
 * Persist the native-backdrop preference + tint.
 *
 * `overlay_native_blur_supported()` reports false on every platform here, so
 * the renderer only ever calls this with `enabled: false`. The stored
 * `nativeBlur` preference is left untouched in that case rather than being
 * flattened by the platform's limitation; `effectColor` is cleared so a stale
 * tint can't be replayed.
 */
export function setOverlayWindowEffect(enabled: boolean, color: unknown): void {
  const settings = getOverlaySettings();
  const channels = Array.isArray(color) ? color.map(Number) : [];
  const valid = enabled && channels.length === 4 && channels.every((v) => Number.isFinite(v));
  if (enabled) settings.nativeBlur = valid;
  settings.effectColor = valid ? channels : null;
  persist();
}

/** Display-server token so the renderer can pick its drag/resize strategy. */
export function overlayDesktopServer(): string {
  if (process.platform !== "linux") return "other";
  const sessionType = String(process.env.XDG_SESSION_TYPE ?? "").toLowerCase();
  if (sessionType === "wayland" || process.env.WAYLAND_DISPLAY) return "wayland";
  if (sessionType === "x11" || process.env.DISPLAY) return "x11";
  return "other";
}

// ── Telemetry history ───────────────────────────────────────────────
/** Persist the frontend-owned telemetry history blob. */
export function saveOverlayHistory(json: string): void {
  getStore().history = String(json ?? "");
  persist();
}

export function loadOverlayHistory(): string | null {
  return getStore().history;
}

// ── Screenshots ─────────────────────────────────────────────────────
function currentGameTitle(explicit?: string | null): string {
  const given = explicit?.trim();
  if (given) return given;
  return session?.name?.trim() || "GameIndex";
}

/**
 * Grab the current game frame into the Captures folder.
 *
 * The HUD hides first (unless the user asked to include it) and is restored
 * afterwards only when it was visible before — a capture taken while the ticker
 * was auto-hidden must leave it hidden.
 *
 * Serialized: two overlapping captures (a rapid F12 double-press) would
 * otherwise interleave their hide/show cycles.
 */
export async function captureScreenshot(
  gameTitle?: string | null,
): Promise<ScreenshotResult> {
  if (screenshotInFlight) {
    throw new Error("another screen capture is already in progress");
  }
  screenshotInFlight = true;
  try {
    return await runScreenshot(gameTitle);
  } finally {
    screenshotInFlight = false;
  }
}

async function runScreenshot(gameTitle?: string | null): Promise<ScreenshotResult> {
  const settings = getOverlaySettings();
  const title = currentGameTitle(gameTitle);
  const win = getOverlayWindow();
  const wasVisible = win?.isVisible() ?? false;
  const hideOverlay = !settings.screenshotIncludeOverlay;

  if (hideOverlay && wasVisible && win) {
    win.hide();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(20, Number(settings.screenshotDelayMs) || 60)),
    );
  }

  try {
    const result = await writeCapture(settings, title);
    emit(EVENT_SCREENSHOT, result);
    return result;
  } finally {
    if (hideOverlay && wasVisible && win) {
      const target = getOverlayWindow();
      if (target) {
        applyInteraction(target, getOverlaySettings(), collapsed);
        target.showInactive();
        target.setAlwaysOnTop(true, "screen-saver");
      }
    }
  }
}

export function recentScreenshots(gameTitle?: string | null): string[] {
  return listRecentScreenshots(getOverlaySettings(), currentGameTitle(gameTitle));
}

export function deleteScreenshot(filePath: string): void {
  deleteScreenshotFile(filePath);
}

/** Reveal a capture (or the captures folder) in the OS file manager. */
export function openScreenshotFolder(fileOrDirPath?: string | null): Promise<void> {
  return openCaptureLocation(getOverlaySettings(), fileOrDirPath);
}

// ── Session lifecycle ───────────────────────────────────────────────
function setSession(next: OverlaySession | null): void {
  const previous = session;
  session = next;
  if (previous?.gameId !== next?.gameId || previous?.pid !== next?.pid) {
    // A new game invalidates the previous session's telemetry ticks.
    if (next) spawnLiveMetrics(getOverlaySettings());
    else stopLiveMetrics();
  }
  emitTo(getOverlayWindow(), EVENT_SESSION, session);
}

function onGameStarted(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const value = payload as Record<string, unknown>;
  const gameId = typeof value.gameId === "string" ? value.gameId : "";
  if (!gameId) return;
  setSession({
    gameId,
    name: typeof value.gameName === "string" ? value.gameName : undefined,
    pid: typeof value.pid === "number" ? value.pid : 0,
    startedAt: Date.now(),
  });
}

function onGameExited(payload: unknown): void {
  const value =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const remaining = typeof value.remainingGameName === "string" ? value.remainingGameName : "";
  if (remaining) {
    // Another session is still running: keep the HUD showing it.
    if (session) setSession({ ...session, name: remaining });
    return;
  }
  setSession(null);
  // A recording/replay buffer makes no sense once the game is gone; telemetry
  // and the HUD go with it. The window stays warm so the next launch is cheap.
  stopLiveMetrics();
  stopFollow();
  const win = getOverlayWindow();
  if (win) win.hide();
}

// ── Installation ────────────────────────────────────────────────────
/**
 * Load persisted state, apply the stored hotkeys and subscribe to the game
 * lifecycle. Called once from `createSurfaces()`.
 */
export function installOverlay(): void {
  if (installed) return;
  installed = true;

  const settings = getOverlaySettings();
  try {
    applyHotkeys(settings);
  } catch (error) {
    emitHotkeyError("toggle", settings.hotkey, error);
  }

  onEvent("game-started", onGameStarted);
  onEvent("game-exited", onGameExited);

  // Never leave an OS-wide hotkey behind after the app exits.
  app.once("will-quit", () => {
    unregisterAllBindings();
    stopLiveMetrics();
    stopFollow();
  });
}

/** Test/teardown helper. */
export function resetOverlaySurfaces(): void {
  unregisterAllBindings();
  stopLiveMetrics();
  stopFollow();
  const win = getOverlayWindow();
  if (win) win.destroy();
  overlayWindow = null;
  store = null;
  session = null;
  collapsed = true;
  tickerAutoFit = true;
  installed = false;
}

export { DEFAULT_OVERLAY_SETTINGS };
