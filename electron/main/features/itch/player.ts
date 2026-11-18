/**
 * The in-app itch.io player.
 *
 * HTML5 itch games are served from `html-classic.itch.zone`. The game page
 * already carries a ready-made iframe for them (`div[data-iframe]`), and that
 * URL also works as a top-level document — which is exactly what a dedicated
 * window wants: no store chrome, no iframe limits, native fullscreen, pointer
 * lock and gamepad input intact.
 *
 * The window shares the `persist:auth-itch` partition with the itch.io login
 * flow, so a paid game the account owns authenticates from the same cookies.
 * When the playable URL fails (game delisted, purchase required, author removed
 * the web build) the window falls back to the store page, where itch's own
 * "Run game" / "Download" UI takes over.
 */
import { BrowserWindow, shell, type WebContents } from "electron";
import { getWindowByLabel } from "../../ipc";

const PLAYER_PARTITION = "persist:auth-itch";

const players = new Map<string, BrowserWindow>();

function isItchHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "itch.io" ||
    host.endsWith(".itch.io") ||
    host === "itch.zone" ||
    host.endsWith(".itch.zone")
  );
}

function isAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "about:") return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isItchHost(parsed.hostname);
  } catch {
    return false;
  }
}

function errorPage(title: string, detail: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#101014;color:#e6e6ea;
    font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:32px}
  h1{font-size:17px;margin:0 0 8px}
  p{margin:0;opacity:.7;max-width:46ch}
</style></head><body><div><h1>${escape(title)}</h1><p>${escape(detail)}</p></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function installShortcuts(window: BrowserWindow): void {
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    if (key === "f11" || (input.alt && key === "enter")) {
      window.setFullScreen(!window.isFullScreen());
      event.preventDefault();
      return;
    }
    if (key === "escape" && window.isFullScreen()) {
      window.setFullScreen(false);
      event.preventDefault();
      return;
    }
    if (input.control && key === "r") {
      window.webContents.reload();
      event.preventDefault();
    }
    if (input.control && key === "w") {
      window.close();
      event.preventDefault();
    }
  });
}

function attachGuards(window: BrowserWindow): void {
  const contents: WebContents = window.webContents;

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isAllowed(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  // Keep the window a player, not a browser: no new windows, no devtools in
  // production builds.
  contents.on("did-create-window", (child) => {
    child.close();
  });
}

export interface ItchPlayerRequest {
  gameId: string;
  title: string;
  playUrl?: string | null;
  pageUrl: string;
}

export function openItchPlayer(request: ItchPlayerRequest): null {
  const gameId = String(request.gameId ?? "").trim() || request.pageUrl;
  const existing = players.get(gameId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return null;
  }

  const pageUrl = String(request.pageUrl ?? "").trim();
  const playUrl = request.playUrl ? String(request.playUrl).trim() : "";
  if (!pageUrl && !playUrl) throw new Error("itch.io: no URL to play.");

  const owner = getWindowByLabel("main");
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: `${request.title || "itch.io"} — itch.io`,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    show: false,
    parent: owner && !owner.isDestroyed() ? owner : undefined,
    webPreferences: {
      // The player is untrusted third-party content: no bridge, no Node.
      partition: PLAYER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  window.removeMenu();
  installShortcuts(window);
  attachGuards(window);

  let fellBack = false;
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 /* ABORTED: user navigated away */) return;
      if (!fellBack && playUrl && pageUrl && validatedURL !== pageUrl) {
        fellBack = true;
        void window.webContents.loadURL(pageUrl).catch(() => undefined);
        return;
      }
      void window.webContents
        .loadURL(
          errorPage(
            "This game could not be opened",
            `${errorDescription || "The page did not load"} — it may need a purchase, or the author may have removed the web build.`,
          ),
        )
        .catch(() => undefined);
    },
  );

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (players.get(gameId) === window) players.delete(gameId);
  });
  players.set(gameId, window);

  const initial = playUrl || pageUrl;
  void window.webContents.loadURL(initial).catch((error: unknown) => {
    console.error(`[itch] failed to open ${initial}:`, error);
  });

  return null;
}

export function closeItchPlayer(rawGameId: unknown): null {
  const gameId = String(rawGameId ?? "").trim();
  if (!gameId) {
    for (const window of players.values()) {
      if (!window.isDestroyed()) window.close();
    }
    players.clear();
    return null;
  }
  const window = players.get(gameId);
  if (window && !window.isDestroyed()) window.close();
  players.delete(gameId);
  return null;
}
