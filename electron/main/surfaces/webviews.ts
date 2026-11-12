/**
 * Embedded webviews (store pages, news readers, map previews, the HUD's Guides
 * browser) backed by Electron `WebContentsView`s.
 *
 * The UI keeps the Tauri sequence:
 *   1. `invoke("create_preview_webview", { label, url, x, y, width, height,
 *      contentFilter, window })`
 *   2. `Webview.getByLabel(label)` (bridge "webviewOp" → `exists`)
 *   3. `setPosition/setSize/show/hide/close` + the `webview_*` / `*_preview_*`
 *      commands for navigation, zoom and consent dismissal.
 *
 * Geometry is CSS/DIP pixels relative to the host window's content area, which
 * is exactly what `WebContentsView.setBounds` takes — the renderer measures
 * `getBoundingClientRect()` and hands those numbers over unchanged.
 *
 * Extras ported from `src-tauri/src/webview.rs`:
 *   • a cap of 3 co-resident previews (FIFO eviction of the oldest), so a
 *     missed close can't pin external sites in memory for the whole session;
 *   • popup handling (`target="_blank"` / `window.open` become same-view
 *     navigations);
 *   • the cookie-consent bypass and cosmetic content filter, attachable per
 *     preview (`contentFilter`, default on) and re-runnable on demand.
 *
 * Limitation: Electron has no per-view "initialization script" hook, so the
 * scripts run at `dom-ready` / `did-finish-load` rather than before the first
 * document script. The consent script's own timer + MutationObserver sweep
 * covers banners that appear after that point.
 */
import {
  BrowserWindow,
  WebContentsView,
  screen,
  type WebContents,
} from "electron";
import { getWindowByLabel, registerCommands, setWebviewOpHandler } from "../ipc";
import {
  WEBLINKS_PREVIEW_INIT_SCRIPT,
  WEBVIEW_CONSENT_SCRIPT,
  WEBVIEW_CONTENT_FILTER_SCRIPT,
} from "./webviewScripts";

/** Upper bound on simultaneously live preview child webviews. */
const MAX_PREVIEW_WEBVIEWS = 3;

interface EmbeddedWebview {
  label: string;
  view: WebContentsView;
  ownerLabel: string;
  visible: boolean;
  /** Whether the consent/content-filter scripts are attached. */
  contentFilter: boolean;
  filterHandler: (() => void) | null;
}

const webviews = new Map<string, EmbeddedWebview>();
/** FIFO of live labels, oldest first. */
const order: string[] = [];

function scaleFactorForView(entry: EmbeddedWebview): number {
  const owner = getWindowByLabel(entry.ownerLabel);
  if (!owner) return 1;
  try {
    return screen.getDisplayMatching(owner.getBounds()).scaleFactor || 1;
  } catch {
    return 1;
  }
}

function addToOwner(view: WebContentsView, ownerLabel: string): BrowserWindow {
  const owner = getWindowByLabel(ownerLabel);
  if (!owner || owner.isDestroyed()) {
    throw new Error(`[webviews] owner window "${ownerLabel}" not found`);
  }
  owner.contentView.addChildView(view);
  return owner;
}

function resolveSize(size: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(1, Math.round(size.width)),
    height: Math.max(1, Math.round(size.height)),
  };
}

function clampBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  const size = resolveSize(bounds);
  return { x: Math.round(bounds.x), y: Math.round(bounds.y), ...size };
}

/** Run `script` in the view, ignoring failures (page may be navigating). */
function runScript(contents: WebContents, script: string): void {
  if (contents.isDestroyed()) return;
  contents.executeJavaScript(script, true).catch(() => {
    /* navigation raced the injection */
  });
}

/** Attach the consent + content filter, re-running the sweep per page load. */
function installContentFilter(entry: EmbeddedWebview): void {
  const contents = entry.view.webContents;
  const handler = () => {
    runScript(contents, WEBVIEW_CONSENT_SCRIPT);
    runScript(contents, WEBVIEW_CONTENT_FILTER_SCRIPT);
  };
  entry.filterHandler = handler;
  contents.on("dom-ready", handler);
  contents.on("did-finish-load", handler);
}

function removeContentFilter(entry: EmbeddedWebview): void {
  if (!entry.filterHandler) return;
  entry.view.webContents.removeListener("dom-ready", entry.filterHandler);
  entry.view.webContents.removeListener("did-finish-load", entry.filterHandler);
  entry.filterHandler = null;
}

/** Popup handling: turn `window.open` / `target="_blank"` into a navigation. */
function installPopupHandling(entry: EmbeddedWebview): void {
  const contents = entry.view.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      runScript(contents, `window.location.assign(${JSON.stringify(url)});`);
    }
    return { action: "deny" };
  });
  const injectPopupScript = () => runScript(contents, WEBLINKS_PREVIEW_INIT_SCRIPT);
  contents.on("dom-ready", injectPopupScript);
  contents.on("did-finish-load", injectPopupScript);
}

function closeWebview(label: string): void {
  const entry = webviews.get(label);
  if (!entry) return;
  webviews.delete(label);
  const index = order.indexOf(label);
  if (index !== -1) order.splice(index, 1);
  removeContentFilter(entry);
  try {
    const owner = getWindowByLabel(entry.ownerLabel);
    if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(entry.view);
  } catch {
    /* owner already gone */
  }
  try {
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  } catch {
    /* already destroyed */
  }
}

function closeWebviewsForOwner(ownerLabel: string): void {
  for (const [label, entry] of [...webviews]) {
    if (entry.ownerLabel === ownerLabel) closeWebview(label);
  }
}

/** Record `label` as live, returning any labels pushed past the cap. */
function registerLabel(label: string): string[] {
  const existing = order.indexOf(label);
  if (existing !== -1) order.splice(existing, 1);
  order.push(label);
  const evicted: string[] = [];
  while (order.length > MAX_PREVIEW_WEBVIEWS) {
    const oldest = order.shift();
    if (oldest) evicted.push(oldest);
  }
  return evicted;
}

export function installEmbeddedWebviews(): void {
  setWebviewOpHandler((op, args) => {
    const label = String(args.label ?? "");
    if (op === "list") return [...webviews.keys()];
    if (op === "exists") return webviews.has(label);
    const entry = webviews.get(label);
    if (!entry) throw new Error(`[webviews] "${label}" does not exist`);

    switch (op) {
      case "setPosition": {
        const position = args.position as
          | { x: number; y: number; type?: string }
          | undefined;
        if (position) {
          const scale = position.type === "Physical" ? scaleFactorForView(entry) : 1;
          const bounds = entry.view.getBounds();
          entry.view.setBounds(
            clampBounds({
              ...bounds,
              x: position.x / scale,
              y: position.y / scale,
            }),
          );
        }
        return null;
      }
      case "setSize": {
        const size = args.size as
          | { width: number; height: number; type?: string }
          | undefined;
        if (size) {
          const scale = size.type === "Physical" ? scaleFactorForView(entry) : 1;
          const bounds = entry.view.getBounds();
          entry.view.setBounds(
            clampBounds({
              ...bounds,
              width: size.width / scale,
              height: size.height / scale,
            }),
          );
        }
        return null;
      }
      case "show":
        entry.view.setVisible(true);
        entry.visible = true;
        return null;
      case "hide":
        entry.view.setVisible(false);
        entry.visible = false;
        return null;
      case "close":
        closeWebview(label);
        return null;
      case "navigate": {
        const url = String(args.url ?? "");
        if (url) void entry.view.webContents.loadURL(url);
        return null;
      }
      case "setZoom":
        entry.view.webContents.setZoomFactor(Number(args.scale ?? 1));
        return null;
      default:
        throw new Error(`[webviews] unsupported operation "${op}"`);
    }
  });

  registerCommands({
    create_preview_webview: (args) => {
      const label = String(args.label ?? "");
      const url = String(args.url ?? "");
      const ownerLabel = String(args.window ?? "main");
      if (!label || !url) throw new Error("[webviews] label and url are required");
      try {
        // Reject malformed URLs up front so the renderer gets a real error
        // instead of a silently blank preview.
        new URL(url);
      } catch {
        throw new Error(`invalid webview url '${url}'`);
      }
      // A reused label replaces the previous preview outright.
      closeWebview(label);

      // Absent flag (older frontend) keeps the filter on, like the Tauri build.
      const contentFilter = args.contentFilter === undefined ? true : Boolean(args.contentFilter);

      const view = new WebContentsView({
        webPreferences: {
          // Preview pages are untrusted third-party sites: no preload, no
          // Node, no context bridge. They share the default session so logins
          // and the seeded consent cookies persist.
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
        },
      });
      view.setBackgroundColor("#00000000");
      view.setBounds(
        clampBounds({
          x: Number(args.x ?? 0),
          y: Number(args.y ?? 0),
          ...resolveSize({
            width: Number(args.width ?? 800),
            height: Number(args.height ?? 600),
          }),
        }),
      );

      let owner: BrowserWindow;
      try {
        owner = addToOwner(view, ownerLabel);
      } catch (error) {
        // A missing host window must not leave an orphaned renderer behind.
        try {
          view.webContents.close();
        } catch {
          /* already gone */
        }
        throw error;
      }
      const entry: EmbeddedWebview = {
        label,
        view,
        ownerLabel,
        visible: true,
        contentFilter,
        filterHandler: null,
      };
      webviews.set(label, entry);
      installPopupHandling(entry);
      if (contentFilter) installContentFilter(entry);
      // Clean up when the page's process goes away (crash/cross-origin swap).
      view.webContents.once("destroyed", () => {
        if (webviews.get(label) === entry) closeWebview(label);
      });
      // Detach everything when the host window closes.
      owner.once("closed", () => closeWebviewsForOwner(ownerLabel));

      // Cap the number of co-resident preview pages.
      for (const stale of registerLabel(label)) closeWebview(stale);

      void view.webContents.loadURL(url).catch((error: unknown) => {
        console.error(`[webviews] failed to load "${url}":`, error);
      });
      return null;
    },
    close_preview_webview: (args) => {
      closeWebview(String(args.label ?? ""));
      return null;
    },
    reposition_preview_webview: (args) => {
      const entry = webviews.get(String(args.label ?? ""));
      if (!entry) return null;
      entry.view.setBounds(
        clampBounds({
          x: Number(args.x ?? 0),
          y: Number(args.y ?? 0),
          ...resolveSize({
            width: Number(args.width ?? 1),
            height: Number(args.height ?? 1),
          }),
        }),
      );
      return null;
    },
    set_preview_webview_visible: (args) => {
      const entry = webviews.get(String(args.label ?? ""));
      if (!entry) return null;
      const visible = Boolean(args.visible);
      entry.view.setVisible(visible);
      entry.visible = visible;
      return null;
    },
    webview_current_url: (args) => {
      const entry = webviews.get(String(args.label ?? ""));
      if (!entry || entry.view.webContents.isDestroyed()) return null;
      return entry.view.webContents.getURL();
    },
    webview_eval: (args) => {
      const entry = webviews.get(String(args.label ?? ""));
      if (!entry) return null;
      runScript(entry.view.webContents, String(args.js ?? ""));
      return null;
    },
    webview_history_navigate: (args) => {
      const entry = webviews.get(String(args.label ?? ""));
      if (!entry || entry.view.webContents.isDestroyed()) return null;
      const direction = String(args.direction ?? "");
      if (direction !== "back" && direction !== "forward") {
        throw new Error(`invalid direction: ${direction}`);
      }
      const history = entry.view.webContents.navigationHistory;
      if (direction === "back") history.goBack();
      else history.goForward();
      return null;
    },
    webview_dismiss_consent: (args) => {
      const entry = webviews.get(String(args.label ?? ""));
      if (!entry) throw new Error(`webview not found: ${String(args.label ?? "")}`);
      // Re-evaluating the whole script (not just the exposed helper) means the
      // toolbar command also works when the automatic filter is off.
      return entry.view.webContents
        .executeJavaScript(WEBVIEW_CONSENT_SCRIPT, true)
        .then(() => null)
        .catch(() => null);
    },
  });
}

export function closeAllWebviews(): void {
  for (const label of [...webviews.keys()]) closeWebview(label);
}

/** Test/teardown helper: number of live previews. */
export function liveWebviewCount(): number {
  return webviews.size;
}
