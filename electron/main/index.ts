/**
 * Electron main entry.
 *
 * Boot order matters:
 *   1. asset scheme privileges (before `ready`)
 *   2. IPC router + handlers
 *   3. surfaces (tray, embedded webview controller)
 *   4. backend commands (real implementations, then stubs for the rest)
 *   5. windows (boot splash + main window)
 */
import { BrowserWindow, app, dialog, shell } from "electron";
import { installAssetProtocol, registerAssetScheme } from "./assetProtocol";
import { emit, registerCommand, registerIpcHandlers } from "./ipc";
import { markQuitting } from "./quitState";
import { createSurfaces, getSurfaces } from "./surfaces";
import { allowMainWindowClose } from "./surfaces/mainWindow";
import { registerCommandHandlers } from "./commands";
import { installSmokeTest } from "./smoke";

/** Must run before the app is ready. */
registerAssetScheme();
installSmokeTest();

app.setAppUserModelId("com.gameindex.app");
app.setName("GameIndex");

const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    try {
      getSurfaces().revealMainWindow();
    } catch {
      /* not booted yet */
    }
  });

  app
    .whenReady()
    .then(async () => {
      installAssetProtocol();
      registerIpcHandlers();

      // Internal helpers that are not part of the migrated command list.
      registerCommand("__app_version", () => app.getVersion(), { override: true });
      registerCommand(
        "__app_paths",
        () => ({
          userData: app.getPath("userData"),
          appData: app.getPath("appData"),
          documents: app.getPath("documents"),
          pictures: app.getPath("pictures"),
          videos: app.getPath("videos"),
        }),
        { override: true },
      );

      await createSurfaces();
      registerCommandHandlers();
      await getSurfaces().boot();
    })
    .catch((error: unknown) => {
      console.error("[main] failed to start:", error);
      dialog.showErrorBox(
        "GameIndex failed to start",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      app.quit();
    });
}

// ── App lifecycle ───────────────────────────────────────────────────
app.on("before-quit", () => {
  markQuitting();
  allowMainWindowClose();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  let keepRunning = false;
  try {
    keepRunning = getSurfaces().shouldKeepRunningInTray();
  } catch {
    keepRunning = false;
  }
  if (!keepRunning) app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      getSurfaces().revealMainWindow();
    } catch {
      /* ignore */
    }
  }
});

// ── Renderer guard rails ────────────────────────────────────────────
// Only top-level app windows are constrained: embedded WebContentsViews must
// stay free to navigate the web (store pages, news readers, map previews).
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "window") return;

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    const devServer = process.env.ELECTRON_RENDERER_URL;
    const allowed =
      url.startsWith("file://") ||
      url.startsWith("giasset://") ||
      (devServer ? url.startsWith(devServer) : false);
    if (allowed) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  contents.on("render-process-gone", (_e, details) => {
    console.error("[renderer] process gone:", details.reason);
    emit("__gi_renderer-gone", details.reason);
  });
});
