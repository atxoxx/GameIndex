/**
 * Reusable embedded login window for store accounts.
 *
 * The old Tauri build opened a provider page in a WebView and intercepted the
 * OAuth redirect (Epic/GOG) or the post-login page (Humble/Battle.net/itch).
 * This is the Electron equivalent: an isolated persistent partition per
 * provider, a normal BrowserWindow, strict success-URL matching and cookie
 * capture before the window is closed.
 */
import { BrowserWindow, session } from "electron";
import { setWindowLabel } from "../ipc";

export interface AuthCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export type AuthSuccess =
  | {
      kind: "code";
      matches: (url: URL) => boolean;
      param?: string;
      /** Also snapshot these cookie domains before closing (GOG needs both). */
      captureDomains?: string[];
    }
  | {
      kind: "cookies";
      matches: (url: URL) => boolean;
      domains: string[];
      settleMs?: number;
    }
  | {
      kind: "sentinel";
      matches: (url: URL) => boolean;
    };

export interface AuthWindowOptions {
  provider: string;
  url: string;
  title: string;
  width?: number;
  height?: number;
  userAgent?: string;
  success: AuthSuccess;
  timeoutMs?: number;
}

export interface AuthWindowResult {
  callbackUrl: string;
  code?: string;
  cookies?: AuthCookie[];
  sentinel?: string;
}

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const active = new Map<string, BrowserWindow>();
const authContents = new WeakSet<Electron.WebContents>();
let creatingAuthWindow = 0;

/** True for windows that install their own navigation policy. */
export function isAuthWindowContents(contents: Electron.WebContents): boolean {
  return authContents.has(contents);
}

/** True while a provider login BrowserWindow is being constructed. */
export function isAuthWindowCreationInProgress(): boolean {
  return creatingAuthWindow > 0;
}

function domainMatches(cookieDomain: string, allowed: string): boolean {
  const domain = cookieDomain.replace(/^\./, "").toLowerCase();
  const target = allowed.replace(/^\./, "").toLowerCase();
  return domain === target || domain.endsWith(`.${target}`);
}

async function captureCookies(
  ses: Electron.Session,
  domains: string[],
): Promise<AuthCookie[]> {
  const all = await ses.cookies.get({});
  await ses.cookies.flushStore().catch(() => undefined);
  return all
    .filter((cookie) => domains.some((domain) => domainMatches(cookie.domain ?? "", domain)))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
    }));
}

/** Close a provider's login window (logout / teardown). */
export function closeAuthWindow(provider: string): void {
  const win = active.get(provider);
  if (win && !win.isDestroyed()) win.destroy();
  active.delete(provider);
}

/**
 * Open the provider login page and resolve once `success` matches.
 * Rejects on timeout or when the user closes the window.
 */
export function openAuthWindow(options: AuthWindowOptions): Promise<AuthWindowResult> {
  const provider = options.provider.trim().toLowerCase();
  const existing = active.get(provider);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return Promise.reject(new Error("A login window is already open"));
  }

  const partition = `persist:auth-${provider}`;
  const ses = session.fromPartition(partition, { cache: true });
  ses.setUserAgent(options.userAgent ?? CHROME_UA);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const win = (() => {
    creatingAuthWindow += 1;
    try {
      return new BrowserWindow({
        title: options.title,
        width: options.width ?? 580,
        height: options.height ?? 700,
        show: true,
        resizable: true,
        autoHideMenuBar: true,
        backgroundColor: "#111114",
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          spellcheck: false,
          devTools: Boolean(process.env.ELECTRON_RENDERER_URL),
        },
      });
    } finally {
      creatingAuthWindow -= 1;
    }
  })();
  active.set(provider, win);
  setWindowLabel(win, `auth:${provider}`);
  authContents.add(win.webContents);

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Keep the login flow in this window; do not spawn uncontrolled popups
    // that would bypass the success/cookie interception.
    if (/^https?:/i.test(url)) {
      void win.loadURL(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());

  return new Promise<AuthWindowResult>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      active.delete(provider);
      if (!win.isDestroyed()) win.destroy();
    };

    const finish = (result: AuthWindowResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleCandidate = async (rawUrl: string) => {
      if (settled) return;
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return;
      }
      if (!options.success.matches(url)) return;

      if (options.success.kind === "code") {
        const param = options.success.param ?? "code";
        const code = url.searchParams.get(param);
        if (code) {
          try {
            const cookies = options.success.captureDomains
              ? await captureCookies(ses, options.success.captureDomains)
              : undefined;
            finish({ callbackUrl: rawUrl, code, cookies });
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        }
        return;
      }
      if (options.success.kind === "sentinel") {
        finish({ callbackUrl: rawUrl, sentinel: url.search || url.hash });
        return;
      }

      try {
        const settleMs = options.success.settleMs ?? 0;
        if (settleMs > 0) {
          await new Promise((resolveWait) => setTimeout(resolveWait, settleMs));
        }
        const cookies = await captureCookies(ses, options.success.domains);
        finish({ callbackUrl: rawUrl, cookies });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const onNavigate = (event: Electron.Event, url: string) => {
      const matched = (() => {
        try {
          return options.success.matches(new URL(url));
        } catch {
          return false;
        }
      })();
      if (matched) {
        // Keep the redirect from actually loading (for OAuth codes) and stop
        // the page's own navigation; cookie flows wait for the load instead.
        if (options.success.kind !== "cookies") event.preventDefault();
        void handleCandidate(url);
      }
    };

    win.webContents.on("will-navigate", onNavigate);
    win.webContents.on("will-redirect", onNavigate);
    win.webContents.on("did-navigate", (_event, url) => {
      void handleCandidate(url);
    });

    win.on("closed", () => {
      active.delete(provider);
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        reject(new Error("Login window closed"));
      }
    });

    timer = setTimeout(() => {
      fail(new Error(`Login timed out after ${Math.round((options.timeoutMs ?? 300_000) / 1000)} seconds`));
    }, options.timeoutMs ?? 300_000);

    void win.loadURL(options.url).catch((error) => fail(error));
  });
}

export const AUTH_USER_AGENT = CHROME_UA;
