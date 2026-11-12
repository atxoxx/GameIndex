/**
 * In-app download resolver window.
 *
 * Ported from `src-tauri/src/downloads/browser_resolver.rs`, reduced to what
 * this build can do without a native webview download handler:
 *
 *  • a dedicated BrowserWindow lets the user clear CAPTCHAs/countdowns,
 *  • navigation to an archive/magnet is intercepted and handed to the
 *    existing downloads command (`direct_download_start` / `torrent_add`),
 *  • `download-intercepted` streams each captured part to the Downloads modal,
 *  • closing the window emits `resolver-session-ended`.
 *
 * The window label is `download-resolver:<sessionId>`, which is exactly what
 * the downloads workstream's existing `close_download_resolver` command closes.
 */
import { app, BrowserWindow, type DownloadItem } from "electron";

import { emit, setWindowLabel } from "../../ipc";
import { downloadCommands } from "../../commands/downloads";

const RESOLVER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface ResolverSessionStarted {
  sessionId: string;
  ok: boolean;
  message?: string;
}

const sessions = new Map<string, BrowserWindow>();

const DOWNLOAD_EXTENSIONS = [
  ".torrent",
  ".zip",
  ".rar",
  ".7z",
  ".iso",
  ".exe",
  ".bin",
  ".pkg",
  ".tar",
  ".gz",
  ".xz",
  ".zst",
  ".tar.gz",
  ".tar.xz",
  ".tar.zst",
  ".tar.bz2",
  ".tbz2",
  ".bz2",
  ".lzma",
  ".sz",
  ".lz4",
  ".tgz",
  ".dmg",
  ".apk",
  ".nsp",
  ".nsz",
  ".xci",
  ".xcz",
  ".cia",
  ".wua",
  ".rvz",
  ".chd",
  ".cso",
  ".gdi",
  ".cdi",
  ".vpk",
  ".wbfs",
  ".wad",
  ".img",
  ".wim",
  ".swm",
  ".esd",
  ".msi",
  ".appimage",
  ".rpm",
  ".deb",
];

/** True for a direct-download URL or magnet link. */
export function isDownloadableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("magnet:")) return true;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const path = parsed.pathname.toLowerCase();
  if (DOWNLOAD_EXTENSIONS.some((extension) => path.endsWith(extension))) return true;
  return /\.(?:r\d{2}|z\d{2}|\d{3})$/.test(path);
}

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
    if (last) return last;
  } catch {
    /* magnet / malformed */
  }
  return fallback;
}

function safeFilename(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "download.bin";
}

interface ResolverOptions {
  url: string;
  gameName: string;
  gameId: string | null;
  savePath: string | null;
  autoExtract: boolean;
  sourceName: string;
}

async function queueDownload(
  sessionId: string,
  options: ResolverOptions,
  url: string,
  filename: string,
  parts: { count: number },
  referer: string | null,
): Promise<void> {
  const id = `resolver-${sessionId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const savePath = options.savePath || app.getPath("downloads");
  const args = {
    id,
    url,
    savePath,
    gameId: options.gameId,
    sourceName: options.sourceName,
    autoExtract: options.autoExtract,
    referer,
  };
  const ctx = { window: null, sender: null };

  try {
    if (url.startsWith("magnet:")) {
      await downloadCommands.torrent_add({ ...args, magnetUri: url }, ctx);
    } else {
      await downloadCommands.direct_download_start(args, ctx);
    }
  } catch (error) {
    console.error("[resolver] failed to queue download:", error);
    return;
  }

  parts.count += 1;
  emit("download-intercepted", {
    sessionId,
    gameName: options.gameName,
    url,
    filename: safeFilename(filename),
    partIndex: parts.count,
    partsCaptured: parts.count,
  });
}

/** `open_download_resolver` — returns immediately; parts arrive via events. */
export async function openDownloadResolver(args: {
  url: unknown;
  gameName: unknown;
  gameId: unknown;
  savePath: unknown;
  autoExtract: unknown;
  sourceName: unknown;
}): Promise<ResolverSessionStarted> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) throw new Error("A URL is required to open the browser.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL '${url}'.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Refusing to open a non-HTTP URL in the resolver.");
  }

  // Single active session, like the Rust FR-7 rule: focus the existing window.
  for (const [sessionId, existing] of sessions) {
    if (!existing.isDestroyed()) {
      existing.focus();
      return {
        sessionId,
        ok: false,
        message: "A browser window is already open",
      };
    }
    sessions.delete(sessionId);
  }

  const gameName =
    typeof args.gameName === "string" && args.gameName.trim()
      ? args.gameName.trim()
      : "Download";
  const options: ResolverOptions = {
    url,
    gameName,
    gameId: typeof args.gameId === "string" && args.gameId ? args.gameId : null,
    savePath: typeof args.savePath === "string" && args.savePath ? args.savePath : null,
    autoExtract: args.autoExtract === true,
    sourceName:
      typeof args.sourceName === "string" && args.sourceName.trim()
        ? args.sourceName.trim()
        : "Web Resolver",
  };

  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const window = new BrowserWindow({
    title: `GameIndex Browser — ${gameName}`,
    width: 1080,
    height: 740,
    center: true,
    resizable: true,
    show: false,
    backgroundColor: "#111113",
    webPreferences: {
      partition: "persist:download-resolver",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  setWindowLabel(window, `download-resolver:${sessionId}`);
  sessions.set(sessionId, window);

  window.webContents.setUserAgent(RESOLVER_UA);
  const parts = { count: 0 };
  let lastPageUrl = url;

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) {
      void window.loadURL(target);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, target) => {
    if (!isDownloadableUrl(target)) return;
    event.preventDefault();
    void queueDownload(
      sessionId,
      options,
      target,
      filenameFromUrl(target, `${gameName}.bin`),
      parts,
      lastPageUrl,
    );
  });

  window.webContents.on("did-navigate", (_event, target) => {
    if (/^https?:/i.test(target)) lastPageUrl = target;
  });

  const session = window.webContents.session;
  const onWillDownload = (event: Electron.Event, item: DownloadItem) => {
    const itemUrl = item.getURL();
    // blob:/data: cannot be replayed by the HTTP engine; leave those to the
    // webview's native save path instead of cancelling them.
    if (/^(?:blob|data):/i.test(itemUrl)) return;
    event.preventDefault();
    void queueDownload(
      sessionId,
      options,
      itemUrl,
      item.getFilename() || filenameFromUrl(itemUrl, `${gameName}.bin`),
      parts,
      lastPageUrl,
    );
  };
  session.on("will-download", onWillDownload);

  window.on("closed", () => {
    session.removeListener("will-download", onWillDownload);
    sessions.delete(sessionId);
    emit("resolver-session-ended", {
      sessionId,
      partsCaptured: parts.count,
      cancelled: true,
    });
  });

  try {
    await window.loadURL(url);
    window.show();
  } catch (error) {
    window.destroy();
    throw new Error(
      `Could not open the resolver page — ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { sessionId, ok: true };
}
