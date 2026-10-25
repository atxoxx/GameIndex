import { loadCustomFolders, loadScreenshotCache } from "../statsStorage";
import type { MediaFile } from "../statsTypes";

export const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv"];

export function isVideoPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.includes(ext);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "steam":
      return "Steam";
    case "nvidia":
      return "NVIDIA";
    case "amd":
      return "AMD";
    case "obs":
      return "OBS";
    case "windows":
      return "Xbox";
    case "custom":
      return "Custom";
    default:
      return source;
  }
}

export const SOURCE_IDS = ["steam", "nvidia", "amd", "obs", "windows", "custom"] as const;

/** Locale-aware short date for a capture timestamp (0 renders nothing). */
export function formatCaptureDate(modifiedAt: number, locale?: string): string {
  if (!modifiedAt) return "";
  return new Date(modifiedAt * 1000).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Newest captures known from the last scan, across every detected folder.
 * Used by the Overview digest, which must stay cheap — it reads the cache
 * instead of walking the filesystem again.
 */
export function readRecentCaptures(limit: number): MediaFile[] {
  const all: MediaFile[] = [];
  for (const group of loadScreenshotCache()) all.push(...group.screenshots);
  for (const folder of loadCustomFolders()) all.push(...folder.media);
  return all
    .slice()
    .sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path))
    .slice(0, limit);
}
