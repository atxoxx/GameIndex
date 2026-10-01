/**
 * Shared screenshot pipeline for every "save as image" button in the app
 * (Activity, per-game Activity, Stats, Gantt, ...).
 *
 * html2canvas + the native save dialog + the Tauri round-trip used to be
 * copy-pasted into each call site, which let them drift — one page passed
 * the wrong IPC argument names and silently failed on every click. Keeping
 * the whole flow here means the colour-mix scrubbing, SVG sizing, scroll
 * expansion, filename sanitising and error handling stay identical
 * everywhere, and a new screen only has to hand us an element.
 */
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  prepareClonedDocumentForCanvasCapture,
  resolveColorForCapture,
} from "./color";

export interface ScreenshotOptions {
  /** Element to rasterise. */
  element: HTMLElement;
  /** Base filename without extension; sanitised via `sanitizeFileName`. */
  fileName: string;
  /** Native save-dialog title. */
  title?: string;
  /** PNG filter label shown in the native save dialog. */
  filterLabel?: string;
  /** Capture width in CSS pixels (defaults to the element's scrollWidth). */
  width?: number;
  /** Capture height in CSS pixels (defaults to the element's scrollHeight). */
  height?: number;
  /** Render scale; automatically lowered for very tall captures. */
  scale?: number;
  /** Background colour expression resolved before html2canvas sees it. */
  backgroundColor?: string;
  /** Literal fallback when `backgroundColor` can't be resolved. */
  fallbackBackground?: string;
  /** Extra clone-side fixes applied after the shared preparation. */
  prepareClone?: (clonedDoc: Document) => void;
}

/**
 * Chromium refuses to rasterise canvases beyond roughly this many pixels on
 * a side; going over produces a blank or failed capture. Long activity
 * lists can realistically exceed it at scale 2, so the scale is tuned down
 * per capture rather than blowing up on the biggest pages.
 */
export const MAX_CANVAS_DIMENSION = 16384;
export const MIN_SCREENSHOT_SCALE = 0.5;

/** Turn an arbitrary label into a safe, lowercase, dash-joined filename. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return cleaned || "screenshot";
}

/** `YYYY-MM-DD` stamp shared by every suggested screenshot filename. */
function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve the scale that keeps both canvas sides within the browser limit.
 * Leaves the requested scale alone when it already fits.
 */
export function clampScreenshotScale(
  width: number,
  height: number,
  requested: number
): number {
  const longest = Math.max(width, height);
  if (longest <= 0) return Math.max(MIN_SCREENSHOT_SCALE, requested);
  const maxAllowed = MAX_CANVAS_DIMENSION / longest;
  return Math.max(MIN_SCREENSHOT_SCALE, Math.min(requested, maxAllowed));
}

/**
 * html2canvas computes gradient stop positions by dividing by the gradient's
 * line length. A collapsed or zero-sized box (common for decorative pseudo
 * elements and offscreen chips) makes that length 0, so `0 / 0` becomes NaN
 * and the browser's `CanvasGradient.addColorStop` throws "The provided double
 * value is non-finite", aborting the entire capture.
 *
 * html2canvas already clamps stops into 0..1, so a non-finite value only ever
 * means "degenerate gradient". Return `null` to signal that the stop should
 * be skipped; callers can then complete the capture with the rest of the page
 * intact.
 */
export function sanitizeGradientStopOffset(offset: number): number | null {
  if (!Number.isFinite(offset)) return null;
  return Math.min(1, Math.max(0, offset));
}

/**
 * Run an html2canvas capture with `CanvasGradient.addColorStop` guarded
 * against non-finite offsets. Restores the original method afterwards, so the
 * patch is invisible to every other canvas user in the app.
 */
async function withFiniteGradientStops<T>(run: () => Promise<T>): Promise<T> {
  const proto =
    typeof CanvasGradient !== "undefined" ? CanvasGradient.prototype : null;
  const original = proto?.addColorStop;
  if (proto && original) {
    proto.addColorStop = function (
      this: CanvasGradient,
      offset: number,
      color: string
    ) {
      const safe = sanitizeGradientStopOffset(offset);
      if (safe === null) return;
      original.call(this, safe, color);
    };
  }
  try {
    return await run();
  } finally {
    if (proto && original) {
      proto.addColorStop = original;
    }
  }
}

/**
 * Rasterise `element` to a PNG and persist it through the native save
 * dialog.
 *
 * Resolves to the written path when the user saved the file, or `null` when
 * they cancelled the dialog. Throws when capturing or writing failed, so
 * callers can surface a translated error toast.
 */
export async function captureAndSaveScreenshot(
  options: ScreenshotOptions
): Promise<string | null> {
  const {
    element,
    fileName,
    title,
    filterLabel = "PNG",
    scale = 2,
    backgroundColor = "var(--color-bg-primary)",
    fallbackBackground = "#0f1117",
    prepareClone,
  } = options;

  const width = options.width ?? element.scrollWidth;
  const height = options.height ?? element.scrollHeight;
  const effectiveScale = clampScreenshotScale(width, height, scale);

  // html2canvas lays the cloned document out inside an iframe sized
  // `windowWidth × windowHeight`. Using the element's crop size here (as the
  // old code did) shrinks the clone's app shell — `100vw`, the sidebar and
  // page paddings all recompute against that smaller viewport — so charts
  // whose SVG viewBox was measured live no longer fit their boxes and get
  // letterboxed/scaled. The clone must instead use the *real* viewport width.
  //
  // The height is inflated by a viewport of slack: the shell is
  // `height: var(--app-h); overflow: hidden`, so a short cloned viewport clips
  // the bottom of the page (the nav/padding). Extra height only adds empty
  // space below the content, which the crop discards.
  const viewportWidth =
    typeof window !== "undefined" && window.innerWidth > 0
      ? window.innerWidth
      : width;
  const viewportHeight =
    height + (typeof window !== "undefined" ? window.innerHeight : 0);

  // Captured live, before the clone reflows: the clone lays the shell out with
  // a tall viewport, so a scrollbar that narrowed the live content disappears
  // and children shift wider by its width. Pin the captured element back to its
  // live content width (plus its own borders, since `width` is border-box) so
  // charts whose SVG viewBox was measured live line up exactly. Skip elements
  // that scroll horizontally (e.g. the Gantt timeline) — pinning those would
  // clip the content the capture is meant to show in full.
  const liveStyle =
    typeof window !== "undefined" ? window.getComputedStyle(element) : null;
  const liveBorderX = liveStyle
    ? (parseFloat(liveStyle.borderLeftWidth) || 0) +
      (parseFloat(liveStyle.borderRightWidth) || 0)
    : 0;
  const scrollsHorizontally = element.scrollWidth > element.clientWidth + 1;
  const pinnedWidth = scrollsHorizontally
    ? 0
    : element.clientWidth + liveBorderX;

  const { default: html2canvas } = await import("html2canvas");
  const canvas = await withFiniteGradientStops(() =>
    html2canvas(element, {
      backgroundColor: resolveColorForCapture(backgroundColor, fallbackBackground),
      scale: effectiveScale,
      logging: false,
      useCORS: true,
      width,
      height,
      windowWidth: viewportWidth,
      windowHeight: viewportHeight,
      onclone: (clonedDoc, clonedElement) => {
        prepareClonedDocumentForCanvasCapture(clonedDoc);
        prepareClone?.(clonedDoc);
        if (clonedElement && pinnedWidth > 0) {
          clonedElement.style.width = `${pinnedWidth}px`;
          clonedElement.style.maxWidth = `${pinnedWidth}px`;
        }
      },
    })
  );

  const suggestedName = `${sanitizeFileName(fileName)}_${dateStamp()}.png`;
  const filePath = await save({
    title,
    defaultPath: suggestedName,
    filters: [{ name: filterLabel, extensions: ["png"] }],
  });
  if (!filePath) return null;

  const dataUrl = canvas.toDataURL("image/png");
  await invoke<string>("save_screenshot", { filePath, base64Data: dataUrl });
  return filePath;
}
