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
import { BrowserWindow, app, dialog, net, shell } from "electron";
import { installAssetProtocol, registerAssetScheme } from "./assetProtocol";
import { emit, registerCommand, registerIpcHandlers } from "./ipc";
import { markQuitting } from "./quitState";
import { createSurfaces, getSurfaces } from "./surfaces";
import { readTelemetry, shutdownTelemetry, startTelemetry, telemetryDiagnostics } from "./features/telemetry";
import { allowMainWindowClose } from "./surfaces/mainWindow";
import { registerCommandHandlers } from "./commands";
import { startDiscordPresence } from "./features/discord/presence";
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
      // Discord Rich Presence owns the IPC pipe to the desktop client; the
      // renderer only decides what to advertise.
      startDiscordPresence();

      // Internal helpers that are not part of the migrated command list.
      registerCommand("__app_version", () => app.getVersion(), { override: true });
      // Diagnostics probe used by the smoke harness: shows what the telemetry
      // sources currently report (`GI_SMOKE_COMMANDS|__telemetry_readout`).
      registerCommand(
        "__telemetry_readout",
        (args) => {
          const exePath = typeof args.exePath === "string" ? args.exePath : "";
          const pid = Number(args.pid ?? 0) || 0;
          const gameId = typeof args.gameId === "string" ? args.gameId : undefined;
          startTelemetry();
          return {
            ...readTelemetry(exePath, pid, gameId),
            diagnostics: telemetryDiagnostics(),
          };
        },
        { override: true },
      );
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

      // Smoke-harness helper: verify that the giasset:// protocol really serves
      // a stored artwork file (the renderer-side URL rewriting is only half).
      registerCommand(
        "__asset_probe",
        async (args) => {
          const url = String(args.url ?? "");
          const response = await net.fetch(url);
          const buffer = await response.arrayBuffer();
          return {
            status: response.status,
            bytes: buffer.byteLength,
            type: response.headers.get("content-type"),
          };
        },
        { override: true },
      );

      // Packaging check: proves a runtime dependency really loads from the
      // asar (dynamic ESM imports such as webtorrent / parse-torrent are easy
      // to break with a `files` filter).
      registerCommand(
        "__module_probe",
        async (args) => {
          const name = String(args.name ?? "");
          if (!name) throw new Error("__module_probe expects a module name");
          const loaded = (await import(name)) as Record<string, unknown>;
          return { module: name, exports: Object.keys(loaded).slice(0, 24) };
        },
        { override: true },
      );

      await createSurfaces();
      registerCommandHandlers();
      // Warm the telemetry probes while the app boots, so the first game does
      // not wait for PowerShell + the C# compile before FPS/temps appear.
      startTelemetry();
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
  shutdownTelemetry();
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
