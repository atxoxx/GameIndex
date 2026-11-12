/**
 * Disk-backed artwork storage and asset URLs.
 *
 * Ported from `media.rs` / `db/artwork.rs`. Artwork lives outside the
 * library document under `<userData>/artwork/<game-id>/` and is exposed to
 * the renderer through a `file://` URL, which the renderer then converts to
 * the `giasset://` protocol itself (`toWebviewAssetUrl` → `convertFileSrc`).
 */
import { app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { userDataPath } from "../../lib/paths";
import { httpBuffer } from "../../lib/http";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export function artworkRoot(): string {
  return userDataPath("artwork");
}

export function safeArtworkComponent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function extensionFromUrl(url: string): string {
  const clean = url.split("?")[0].toLowerCase();
  const match = clean.match(/\.(png|jpe?g|webp|gif|ico|avif)$/);
  if (!match) return "jpg";
  return match[1] === "jpeg" ? "jpg" : match[1];
}

/** `artwork_asset_url` — only resolves files that actually exist. */
export function artworkAssetUrl(relativePath: string): string {
  const relative = relativePath.replace(/^[/\\]+/, "");
  const absolute = path.join(app.getPath("userData"), relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error("Artwork file not found — re-download the artwork for this game.");
  }
  return pathToFileURL(absolute).toString();
}

interface ThumbSpec {
  width: number;
  height: number;
}

function thumbSpec(slot: string): ThumbSpec | null {
  if (slot === "cover") return { width: 300, height: 450 };
  if (slot === "banner" || slot === "hero") return { width: 720, height: 405 };
  return null;
}

function thumbRelativePath(gameId: string, slot: string): string | null {
  if (!thumbSpec(slot)) return null;
  return `artwork/${safeArtworkComponent(gameId)}/${safeArtworkComponent(slot)}_thumb.webp`;
}

/**
 * Downscale one image into the `_thumb.webp` sibling the renderer requests.
 *
 * Electron's `nativeImage` can resize but cannot encode WebP, so the bytes
 * are PNG in a `.webp` container name. Chromium sniffs the image payload and
 * renders it; if anything refuses it the card falls back to the full-size
 * artwork, which is the same fallback used when no thumbnail exists.
 */
function writeThumbnail(absoluteArtwork: string, gameId: string, slot: string): boolean {
  const spec = thumbSpec(slot);
  const relative = thumbRelativePath(gameId, slot);
  if (!spec || !relative) return false;
  const destination = path.join(app.getPath("userData"), relative);
  if (fs.existsSync(destination)) return false;
  try {
    const image = nativeImage.createFromPath(absoluteArtwork);
    if (image.isEmpty()) return false;
    const size = image.getSize();
    if (size.width <= 0 || size.height <= 0) return false;
    const scale = Math.min(1, spec.width / size.width, spec.height / size.height);
    const resized =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "good",
          })
        : image;
    const bytes = resized.toPNG();
    if (!bytes.length) return false;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temp = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, destination);
    return true;
  } catch (error) {
    console.warn(`[metadata] thumbnail failed for ${gameId}/${slot}:`, error);
    return false;
  }
}

function writeBytes(destination: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, destination);
}

/** Store downloaded bytes at the canonical slot path and return the relative path. */
function storeBytes(gameId: string, slot: string, bytes: Buffer, extension: string): string {
  const safeGame = safeArtworkComponent(gameId);
  const safeSlot = safeArtworkComponent(slot);
  const relative = `artwork/${safeGame}/${safeSlot}.${extension}`;
  const absolute = path.join(app.getPath("userData"), relative);
  writeBytes(absolute, bytes);
  writeThumbnail(absolute, gameId, slot);
  return relative;
}

/** `download_image` — data URL for a remote image, or `null` on failure. */
export async function downloadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await httpBuffer(url, {
      timeoutMs: 20_000,
      retries: 1,
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    if (response.byteLength > MAX_IMAGE_BYTES) return null;
    const clean = url.split("?")[0].toLowerCase();
    const extension = extensionFromUrl(clean);
    const mime = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    return `data:${mime};base64,${response.toString("base64")}`;
  } catch {
    return null;
  }
}

/** `download_artwork` — fetch and persist a slot, returning its relative path. */
export async function downloadArtwork(
  gameId: string,
  slot: string,
  url: string,
): Promise<string | null> {
  try {
    const bytes = await httpBuffer(url, {
      timeoutMs: 20_000,
      retries: 1,
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return storeBytes(gameId, slot, bytes, extensionFromUrl(url));
  } catch {
    return null;
  }
}

/** `store_artwork_file` — copy a user-picked local image into the store. */
export function storeArtworkFile(
  gameId: string,
  slot: string,
  filePath: string,
): string | null {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_IMAGE_BYTES) return null;
    const bytes = fs.readFileSync(filePath);
    const extension = path.extname(filePath).replace(/^\./, "").toLowerCase() || "jpg";
    return storeBytes(gameId, slot, bytes, extension === "jpeg" ? "jpg" : extension);
  } catch {
    return null;
  }
}

/** `ensure_artwork_thumbnails` — backfill missing thumbnails, return the count. */
export async function ensureArtworkThumbnails(): Promise<number> {
  const root = artworkRoot();
  let written = 0;
  let processed = 0;
  let games: fs.Dirent[];
  try {
    games = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const game of games) {
    if (!game.isDirectory()) continue;
    const gameDir = path.join(root, game.name);
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(gameDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile()) continue;
      const match = file.name.match(/^(cover|banner|hero)\.([a-z0-9]+)$/i);
      if (!match) continue;
      if (writeThumbnail(path.join(gameDir, file.name), game.name, match[1].toLowerCase())) {
        written += 1;
      }
      processed += 1;
      // Decoding is synchronous; yield periodically so a large library does
      // not monopolise the main process while the window paints.
      if (processed % 8 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return written;
}
