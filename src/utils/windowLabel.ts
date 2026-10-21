import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Label of the Tauri window this webview belongs to, or `undefined` when the
 * frontend runs outside Tauri (`npm run dev`).
 *
 * Commands that embed a child webview default to the `main` window, so any
 * caller that can also render in a popout must say which window it is.
 */
export function currentWindowLabel(): string | undefined {
  try {
    return getCurrentWindow().label;
  } catch {
    return undefined;
  }
}
