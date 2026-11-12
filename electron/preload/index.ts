/**
 * Electron preload: the only place the renderer's privileged capabilities are
 * declared.
 *
 * The exposed `window.__giBridge` object is what the `src/shims/tauri-*.ts`
 * modules consume. `__TAURI__` / `__TAURI_INTERNALS__` are also published as
 * inert markers because a number of feature gates in the UI still check
 * `"__TAURI__" in window` to decide whether native commands exist.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DropState, GiBridge } from "../../src/shims/bridge";

interface WindowInfo {
  label: string;
  id: number;
}

function readWindowInfo(): WindowInfo {
  try {
    const info = ipcRenderer.sendSync("gi:window-info") as WindowInfo | undefined;
    return info ?? { label: "main", id: 0 };
  } catch {
    return { label: "main", id: 0 };
  }
}

/** Strip Electron's IPC wrapper so renderers see the backend's own message. */
function cleanError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "");
  return new Error(cleaned || "backend command failed");
}

const invokeRaw = (cmd: string, args?: unknown): Promise<unknown> =>
  ipcRenderer.invoke("gi:invoke", { cmd, args }).catch((error: unknown) => {
    throw cleanError(error);
  });

let dragDepth = 0;

function installDragDrop(handler: (state: DropState) => void): () => void {
  const pathsOf = (event: DragEvent): string[] => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    return files
      .map((file) => {
        try {
          return webUtils.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter((value): value is string => value.length > 0);
  };

  const onDragEnter = (event: DragEvent) => {
    event.preventDefault();
    dragDepth += 1;
    if (dragDepth === 1) handler({ type: "enter", paths: pathsOf(event) });
  };
  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    handler({ type: "over", paths: pathsOf(event) });
  };
  const onDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      handler({ type: "leave", paths: [] });
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth = 0;
    handler({ type: "drop", paths: pathsOf(event) });
  };

  window.addEventListener("dragenter", onDragEnter, true);
  window.addEventListener("dragover", onDragOver, true);
  window.addEventListener("dragleave", onDragLeave, true);
  window.addEventListener("drop", onDrop, true);

  return () => {
    window.removeEventListener("dragenter", onDragEnter, true);
    window.removeEventListener("dragover", onDragOver, true);
    window.removeEventListener("dragleave", onDragLeave, true);
    window.removeEventListener("drop", onDrop, true);
  };
}

const bridge: GiBridge = {
  isElectron: true,
  windowInfo: readWindowInfo(),

  invoke: (cmd, args) => invokeRaw(cmd, args),

  listen: async (event, handler) => {
    const channel = "gi:event";
    const listener = (
      _event: Electron.IpcRendererEvent,
      message: { event: string; payload: unknown },
    ) => {
      if (message?.event === event) handler(message.payload);
    };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  emit: (event, payload) => ipcRenderer.invoke("gi:emit", { event, payload }),

  windowOp: (method, args) =>
    ipcRenderer.invoke("gi:window-op", { method, args }).catch((error: unknown) => {
      throw cleanError(error);
    }),

  dialog: (kind, options) =>
    ipcRenderer.invoke("gi:dialog", { kind, options }).catch((error: unknown) => {
      throw cleanError(error);
    }),

  shell: (kind, target) =>
    ipcRenderer.invoke("gi:shell", { kind, target }).catch((error: unknown) => {
      throw cleanError(error);
    }),

  webviewOp: (op, args) =>
    ipcRenderer.invoke("gi:webview-op", { op, args }).catch((error: unknown) => {
      throw cleanError(error);
    }),

  onDragDrop: (handler) => installDragDrop(handler),

  writeClipboardText: async (text) => {
    await ipcRenderer.invoke("gi:clipboard-text", text);
  },
};

contextBridge.exposeInMainWorld("__giBridge", bridge);

// Feature-gate markers. Deliberately minimal: the shims above do the real
// work, these only keep `isTauriRuntime()`-style checks truthful.
contextBridge.exposeInMainWorld("__TAURI_INTERNALS__", {
  metadata: { currentWindow: { label: bridge.windowInfo.label } },
});

contextBridge.exposeInMainWorld("__TAURI__", {
  core: { invoke: invokeRaw },
  metadata: { currentWindow: { label: bridge.windowInfo.label } },
  app: {
    getVersion: () => invokeRaw("__app_version"),
  },
});
