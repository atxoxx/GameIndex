/**
 * The main-process side of the renderer bridge.
 *
 * One IPC channel (`gi:invoke`) carries every backend command. Handlers live in
 * `electron/main/commands/*` and are registered into the map below, which is
 * intentionally the same shape the Rust `generate_handler!` list had: a flat
 * name → function table.
 *
 * Events run the other way through `gi:event`, so `listen()` in the renderer
 * keeps working for the ~30 event names the UI subscribes to.
 */
import {
  BrowserWindow,
  app,
  clipboard,
  dialog,
  ipcMain,
  screen,
  shell,
  type WebContents,
} from "electron";

export interface CommandContext {
  /** Window that issued the call, when it came from a renderer. */
  window: BrowserWindow | null;
  sender: WebContents | null;
}

export type CommandArgs = Record<string, unknown>;

export type CommandHandler = (
  args: CommandArgs,
  ctx: CommandContext,
) => unknown | Promise<unknown>;

const commands = new Map<string, CommandHandler>();

export interface RegisterOptions {
  /**
   * Replace an existing handler. Stub registration passes `false` (default) so
   * a real implementation installed earlier is never clobbered by a stub.
   */
  override?: boolean;
}

export function registerCommand(
  name: string,
  handler: CommandHandler,
  { override = false }: RegisterOptions = {},
): void {
  if (!override && commands.has(name)) return;
  commands.set(name, handler);
}

export function registerCommands(
  handlers: Record<string, CommandHandler>,
  options?: RegisterOptions,
): void {
  for (const [name, handler] of Object.entries(handlers)) {
    registerCommand(name, handler, options);
  }
}

export function hasCommand(name: string): boolean {
  return commands.has(name);
}

export function listCommands(): string[] {
  return [...commands.keys()].sort();
}

// ── Window labels ───────────────────────────────────────────────────
// Electron's BrowserWindow has no `label`, but the renderer relies on ones like
// "main", "overlay" and "splashscreen". Keep a side table keyed by window id.
const windowLabels = new Map<number, string>();

export function setWindowLabel(win: BrowserWindow, label: string): void {
  windowLabels.set(win.id, label);
  win.once("closed", () => windowLabels.delete(win.id));
}

export function getWindowLabel(win: BrowserWindow | null): string {
  if (!win) return "main";
  return windowLabels.get(win.id) ?? "main";
}

export function getWindowByLabel(label: string): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (getWindowLabel(win) === label) return win;
  }
  return null;
}

// ── Events ──────────────────────────────────────────────────────────
type EventListener = (payload: unknown) => void;
const mainListeners = new Map<string, Set<EventListener>>();

/** Listen in the main process (mirrors the Rust `AppHandle::listen`). */
export function onEvent(event: string, listener: EventListener): () => void {
  let set = mainListeners.get(event);
  if (!set) {
    set = new Set();
    mainListeners.set(event, set);
  }
  set.add(listener);
  return () => set?.delete(listener);
}

export function emit(event: string, payload?: unknown): void {
  for (const listener of mainListeners.get(event) ?? []) {
    try {
      listener(payload);
    } catch (error) {
      console.error(`[events] main listener for "${event}" failed:`, error);
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("gi:event", { event, payload });
    }
  }
}

export function emitTo(win: BrowserWindow | null, event: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send("gi:event", { event, payload });
  }
}

/** Push a message into a `Channel<T>` created in the renderer. */
export function sendChannel(
  sender: WebContents | null,
  channelId: number,
  message: unknown,
): void {
  sender?.send("gi:event", { event: `__gi_channel:${channelId}`, payload: message });
}

// ── Geometry helpers ────────────────────────────────────────────────
function scaleFactorFor(win: BrowserWindow): number {
  try {
    return screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
  } catch {
    return 1;
  }
}

type SizeArg = { width: number; height: number; type?: string };
type PositionArg = { x: number; y: number; type?: string };

function applySize(win: BrowserWindow, size: SizeArg): void {
  const scale = scaleFactorFor(win);
  const logical =
    size.type === "Physical"
      ? { width: size.width / scale, height: size.height / scale }
      : { width: size.width, height: size.height };
  win.setContentSize(
    Math.max(1, Math.round(logical.width)),
    Math.max(1, Math.round(logical.height)),
  );
}

function applyPosition(win: BrowserWindow, position: PositionArg): void {
  const scale = scaleFactorFor(win);
  const logical =
    position.type === "Physical"
      ? { x: position.x / scale, y: position.y / scale }
      : { x: position.x, y: position.y };
  win.setPosition(Math.round(logical.x), Math.round(logical.y));
}

function toPhysicalSize(win: BrowserWindow, size: { width: number; height: number }) {
  const scale = scaleFactorFor(win);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale), type: "Physical" };
}

function toPhysicalPosition(win: BrowserWindow, pos: { x: number; y: number }) {
  const scale = scaleFactorFor(win);
  return { x: Math.round(pos.x * scale), y: Math.round(pos.y * scale), type: "Physical" };
}

/** Every window verb the renderer shim can ask for. */
export async function applyWindowOp(
  win: BrowserWindow,
  method: string,
  args: unknown,
): Promise<unknown> {
  const payload = (args ?? {}) as Record<string, unknown>;
  switch (method) {
    case "minimize":
      win.minimize();
      return;
    case "maximize":
      win.maximize();
      return;
    case "unmaximize":
      win.unmaximize();
      return;
    case "toggleMaximize":
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return;
    case "isMaximized":
      return win.isMaximized();
    case "isFullscreen":
      return win.isFullScreen();
    case "isVisible":
      return win.isVisible();
    case "isFocused":
      return win.isFocused();
    case "setFullscreen":
      win.setFullScreen(Boolean(payload.fullscreen));
      return;
    case "setResizable":
      win.setResizable(Boolean(payload.resizable));
      return;
    case "setAlwaysOnTop":
      win.setAlwaysOnTop(Boolean(payload.alwaysOnTop));
      return;
    case "setSkipTaskbar":
      win.setSkipTaskbar(Boolean(payload.skip));
      return;
    case "setIgnoreCursorEvents":
      win.setIgnoreMouseEvents(Boolean(payload.ignore), { forward: true });
      return;
    case "setDecorations":
      // Runtime decoration toggling is not supported by Electron; windows are
      // created frameless and stay that way.
      return;
    case "setTitle":
      win.setTitle(String(payload.title ?? ""));
      return;
    case "setSize":
      applySize(win, payload as unknown as SizeArg);
      return;
    case "setPosition":
      applyPosition(win, payload as unknown as PositionArg);
      return;
    case "setFocus":
      win.focus();
      return;
    case "center":
      win.center();
      return;
    case "show":
      win.show();
      return;
    case "hide":
      win.hide();
      return;
    case "close":
      win.close();
      return;
    case "destroy":
      win.destroy();
      return;
    case "innerSize":
      return toPhysicalSize(win, {
        width: win.getContentSize()[0],
        height: win.getContentSize()[1],
      });
    case "outerSize":
      return toPhysicalSize(win, {
        width: win.getBounds().width,
        height: win.getBounds().height,
      });
    case "innerPosition":
      return toPhysicalPosition(win, {
        x: win.getContentBounds().x,
        y: win.getContentBounds().y,
      });
    case "outerPosition":
      return toPhysicalPosition(win, { x: win.getBounds().x, y: win.getBounds().y });
    case "relaunch":
      app.relaunch();
      app.exit(0);
      return;
    default:
      if (method.startsWith("exit:")) {
        app.exit(Number(method.slice("exit:".length)) || 0);
        return;
      }
      throw new Error(`[gameindex] unknown window operation: ${method}`);
  }
}

// ── Dialogs / shell ─────────────────────────────────────────────────
interface DialogFilter {
  name?: string;
  extensions: string[];
}

async function handleDialog(
  win: BrowserWindow | null,
  kind: string,
  rawOptions: unknown,
): Promise<unknown> {
  const options = (rawOptions ?? {}) as Record<string, unknown>;
  const filters = (options.filters as DialogFilter[] | undefined)?.map((filter) => ({
    name: filter.name ?? "Files",
    extensions: filter.extensions ?? [],
  }));

  switch (kind) {
    case "open": {
      const properties: Array<
        "openFile" | "openDirectory" | "multiSelections" | "createDirectory"
      > = [];
      properties.push(options.directory ? "openDirectory" : "openFile");
      if (options.multiple) properties.push("multiSelections");
      if (options.canCreateDirectories) properties.push("createDirectory");
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        title: options.title as string | undefined,
        defaultPath: options.defaultPath as string | undefined,
        filters,
        properties,
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return options.multiple ? result.filePaths : result.filePaths[0];
    }
    case "save": {
      const result = await dialog.showSaveDialog(win ?? undefined!, {
        title: options.title as string | undefined,
        defaultPath: options.defaultPath as string | undefined,
        filters,
      });
      return result.canceled ? null : (result.filePath ?? null);
    }
    case "ask":
    case "confirm": {
      const result = await dialog.showMessageBox(win ?? undefined!, {
        type: (options.kind as "info" | "warning" | "error") ?? "question",
        title: (options.title as string) ?? "GameIndex",
        message: String(options.message ?? ""),
        buttons: [
          (options.okLabel as string) ?? "OK",
          (options.cancelLabel as string) ?? "Cancel",
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      return result.response === 0;
    }
    case "message": {
      await dialog.showMessageBox(win ?? undefined!, {
        type: (options.kind as "info" | "warning" | "error") ?? "info",
        title: (options.title as string) ?? "GameIndex",
        message: String(options.message ?? ""),
        buttons: [(options.okLabel as string) ?? "OK"],
        noLink: true,
      });
      return;
    }
    default:
      throw new Error(`[gameindex] unknown dialog kind: ${kind}`);
  }
}

async function handleShell(kind: string, target: string): Promise<void> {
  switch (kind) {
    case "openUrl":
      await shell.openExternal(target);
      return;
    case "openPath": {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return;
    }
    case "revealItemInDir":
      shell.showItemInFolder(target);
      return;
    default:
      throw new Error(`[gameindex] unknown shell operation: ${kind}`);
  }
}

// ── Embedded webviews ───────────────────────────────────────────────
// The controller lives with the other surfaces (it owns WebContentsViews); it
// installs itself here so this module stays window-agnostic.
export type WebviewOpHandler = (
  op: string,
  args: CommandArgs,
  ctx: CommandContext,
) => unknown | Promise<unknown>;

let webviewOpHandler: WebviewOpHandler | null = null;

export function setWebviewOpHandler(handler: WebviewOpHandler): void {
  webviewOpHandler = handler;
}

// ── IPC wiring ──────────────────────────────────────────────────────
let installed = false;

export function registerIpcHandlers(): void {
  if (installed) return;
  installed = true;

  ipcMain.handle("gi:invoke", async (event, request: { cmd: string; args?: unknown }) => {
    const { cmd, args } = request ?? ({} as { cmd: string; args?: unknown });

    // Tauri plugin commands are the only names outside the flat registry. The
    // UI (and the static splash page) reaches a few raw plugin paths; everything
    // else goes through `background`/`plugin:*` commands we do not ship.
    if (cmd === "plugin:clipboard-manager|write_text") {
      const text = (args as { text?: unknown } | undefined)?.text;
      clipboard.writeText(String(text ?? ""));
      return;
    }
    if (cmd === "plugin:app|version") {
      return app.getVersion();
    }
    if (cmd === "plugin:app|name") {
      return app.getName();
    }

    const handler = commands.get(cmd);
    if (!handler) {
      throw new Error(`[gameindex] command not implemented yet: ${cmd}`);
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    return handler((args as CommandArgs) ?? {}, { window: win, sender: event.sender });
  });

  ipcMain.handle("gi:emit", (_event, request: { event: string; payload?: unknown }) => {
    emit(request.event, request.payload);
  });

  ipcMain.handle("gi:window-op", async (event, request: { method: string; args?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("[gameindex] no window for this sender");
    return applyWindowOp(win, request.method, request.args);
  });

  ipcMain.handle("gi:dialog", async (event, request: { kind: string; options?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return handleDialog(win, request.kind, request.options);
  });

  ipcMain.handle("gi:shell", async (_event, request: { kind: string; target: string }) => {
    await handleShell(request.kind, request.target);
  });

  ipcMain.handle("gi:webview-op", async (event, request: { op: string; args?: unknown }) => {
    if (!webviewOpHandler) {
      throw new Error("[gameindex] embedded webviews are not available yet");
    }
    return webviewOpHandler(request.op, (request.args ?? {}) as CommandArgs, {
      window: BrowserWindow.fromWebContents(event.sender),
      sender: event.sender,
    });
  });

  ipcMain.handle("gi:clipboard-text", (_event, text: string) => {
    clipboard.writeText(String(text ?? ""));
  });

  ipcMain.on("gi:window-info", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    event.returnValue = {
      label: getWindowLabel(win),
      id: win?.id ?? 0,
    };
  });
}
