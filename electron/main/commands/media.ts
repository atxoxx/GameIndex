/**
 * Media library: screenshot folders, orphaned artwork, shared image/video files.
 *
 * Workstream: `media`. Reference: `git show 1b4a698b:src-tauri/src/media.rs`,
 * `system_screenshots.rs`, `library_health.rs`.
 */
import { registerCommands, type CommandHandler } from "../ipc";
import {
  deleteMediaFile,
  detectSteamScreenshotFolders,
  detectSystemScreenshotFolders,
  listMediaFiles,
} from "../features/media/captures";
import {
  deleteOrphanedArtwork,
  scanOrphanedArtwork,
} from "../features/media/artworkScan";

function text(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

export const mediaCommands: Record<string, CommandHandler> = {
  list_media_files: (args) => listMediaFiles(text(args, "folderPath")),

  delete_media_file: (args) => deleteMediaFile(text(args, "path")),

  detect_steam_screenshot_folders: () => detectSteamScreenshotFolders(),

  detect_system_screenshot_folders: () => detectSystemScreenshotFolders(),

  scan_orphaned_artwork: () => scanOrphanedArtwork(),

  delete_orphaned_artwork: (args) => {
    const relativePaths = Array.isArray(args.relativePaths)
      ? args.relativePaths.filter((entry): entry is string => typeof entry === "string")
      : [];
    return deleteOrphanedArtwork(relativePaths);
  },
};

export function registerMediaCommands(): void {
  registerCommands(mediaCommands, { override: true });
}
