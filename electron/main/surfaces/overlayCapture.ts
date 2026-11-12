/**
 * In-game screenshot capture + the "Captures" folder browser for the overlay.
 *
 * The Tauri build grabbed the frame with GDI (Windows) and encoded PNG/JPEG
 * itself. Electron's equivalent is `desktopCapturer`: Chromium grabs the
 * monitor at native resolution and hands back a `NativeImage`, which already
 * knows how to encode PNG and JPEG.
 *
 * Caveat (documented in the port notes): exclusive-fullscreen games and
 * protected video can come back black through the OS capture path; borderless
 * / windowed games capture fine.
 */
import { app, clipboard, desktopCapturer, screen, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { OverlaySettings } from "./overlaySettings";

/** Ceiling on the recent-captures list returned to the frontend. */
const MAX_RECENT_CAPTURES = 100;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "bmp", "webp"]);

export interface ScreenshotResult {
  filePath: string;
  fileName: string;
  gameTitle: string;
  timestamp: number;
  width: number;
  height: number;
}

/** Videos\Captures (`app.getPath("videos")` is the real shell folder). */
function capturesRoot(): string {
  try {
    return path.join(app.getPath("videos"), "Captures");
  } catch {
    return path.join(app.getPath("userData"), "Captures");
  }
}

function sanitizeTitle(title: string): string {
  const cleaned = title
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "GameIndex";
}

/** Where a capture for `title` belongs: the custom folder, else per game. */
export function captureDir(settings: OverlaySettings, title: string): string {
  const custom = settings.screenshotFolder?.trim();
  if (custom) return custom;
  return path.join(capturesRoot(), sanitizeTitle(title));
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/** Newest-first image listing for one game folder. */
export function listRecentScreenshots(
  settings: OverlaySettings,
  title: string,
): string[] {
  const dir = captureDir(settings, title);
  let entries: Array<{ filePath: string; mtime: number }> = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isImageFile(entry.name))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        let mtime = 0;
        try {
          mtime = fs.statSync(filePath).mtimeMs;
        } catch {
          /* vanished between readdir and stat */
        }
        return { filePath, mtime };
      });
  } catch {
    return [];
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries.slice(0, MAX_RECENT_CAPTURES).map((entry) => entry.filePath);
}

/** Delete one capture, refusing anything that is not an image. */
export function deleteScreenshotFile(filePath: string): void {
  if (!isImageFile(filePath)) throw new Error("Invalid file type to delete");
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw new Error(`failed to delete screenshot: ${String(error)}`);
  }
}

/**
 * Reveal a capture (or the captures folder) in the OS file manager. With no
 * path it opens the configured screenshot folder, else `Videos\Captures` — the
 * same target the Tauri build used.
 */
export async function openCaptureLocation(
  settings: OverlaySettings,
  fileOrDirPath?: string | null,
): Promise<void> {
  const explicit = fileOrDirPath?.trim();
  if (explicit && fs.existsSync(explicit)) {
    if (fs.statSync(explicit).isFile()) {
      shell.showItemInFolder(explicit);
      return;
    }
    const error = await shell.openPath(explicit);
    if (error) throw new Error(error);
    return;
  }
  const folder = settings.screenshotFolder?.trim() || capturesRoot();
  fs.mkdirSync(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
}

function timestampPrefix(date: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

let captureInFlight = false;

export interface GrabbedFrame {
  image: Electron.NativeImage;
  width: number;
  height: number;
}

/**
 * Grab the monitor under the cursor (the display a borderless game is usually
 * on) at native resolution. Serialized: two overlapping hotkey presses would
 * otherwise interleave their hide/show cycles.
 */
export async function grabScreenFrame(): Promise<GrabbedFrame> {
  if (captureInFlight) {
    throw new Error("another screen capture is already in progress");
  }
  captureInFlight = true;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const scale = display.scaleFactor || 1;
    const width = Math.max(1, Math.round(display.size.width * scale));
    const height = Math.max(1, Math.round(display.size.height * scale));

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });
    const source =
      sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("screen capture returned no frame");
    }
    return { image: source.thumbnail, width, height };
  } finally {
    captureInFlight = false;
  }
}

/** Write one grabbed frame into the capture folder and report it. */
export async function writeCapture(
  settings: OverlaySettings,
  title: string,
): Promise<ScreenshotResult> {
  const frame = await grabScreenFrame();
  const wantsJpeg =
    settings.screenshotFormat.toLowerCase() === "jpg" ||
    settings.screenshotFormat.toLowerCase() === "jpeg";

  let bytes: Buffer;
  let ext = "png";
  if (wantsJpeg) {
    try {
      bytes = frame.image.toJPEG(92);
      ext = "jpg";
    } catch {
      bytes = frame.image.toPNG();
      ext = "png";
    }
  } else {
    bytes = frame.image.toPNG();
  }

  const dir = captureDir(settings, title);
  fs.mkdirSync(dir, { recursive: true });

  const now = new Date();
  const timestamp = now.getTime();
  const fileName = `Capture_${timestampPrefix(now)}_${String(timestamp % 1000).padStart(3, "0")}.${ext}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, bytes);

  if (settings.screenshotCopyToClipboard) {
    try {
      clipboard.writeImage(frame.image);
    } catch (error) {
      console.warn("[overlay] clipboard image write failed:", error);
    }
  }

  return {
    filePath,
    fileName,
    gameTitle: title,
    timestamp,
    width: frame.width,
    height: frame.height,
  };
}
