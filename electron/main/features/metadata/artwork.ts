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
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { userDataPath } from "../../lib/paths";
import { httpBuffer } from "../../lib/http";
import { getGame, patchGameRecord } from "../../state/libraryStore";
import { percentDecodeArtworkUrl } from "../media/artworkScan";
import type {
  DeleteGameArtworkResult,
  GameArtworkFile,
  GameArtworkSlot,
} from "../../../../src/types/artwork";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

/** Read the first bytes of a file without loading the whole image. */
function readHead(file: string, length = 8192): Buffer {
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(handle, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * True when the file carries more than one frame: GIF, APNG (an `acTL` chunk)
 * or an animated WebP (`ANIM`/`ANMF` chunk).
 *
 * `nativeImage` decodes only the first frame, so running these through the
 * thumbnail downscaler silently turned a community animated cover into a
 * still image everywhere a card requested `_thumb.webp`.
 */
export function isAnimatedImageFile(file: string): boolean {
  try {
    const head = readHead(file);
    if (head.length < 12) return false;
    const ascii = head.toString("latin1");
    if (ascii.startsWith("GIF8")) return true;
    if (head.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return head.includes("acTL");
    }
    if (ascii.startsWith("RIFF") && head.subarray(8, 12).toString("latin1") === "WEBP") {
      return head.includes("ANIM") || head.includes("ANMF");
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Downscale one image into the `_thumb.webp` sibling the renderer requests.
 *
 * Electron's `nativeImage` can resize but cannot encode WebP, so the bytes
 * are PNG in a `.webp` container name. Chromium sniffs the image payload and
 * renders it; if anything refuses it the card falls back to the full-size
 * artwork, which is the same fallback used when no thumbnail exists.
 *
 * Animated sources are copied verbatim instead of downscaled: a static
 * thumbnail would replace the animation the user picked. The copy also
 * replaces a still thumbnail written by an earlier build, so existing
 * animated covers start playing again on the next start-up backfill.
 */
function writeThumbnail(absoluteArtwork: string, gameId: string, slot: string): boolean {
  const spec = thumbSpec(slot);
  const relative = thumbRelativePath(gameId, slot);
  if (!spec || !relative) return false;
  const destination = path.join(app.getPath("userData"), relative);

  if (isAnimatedImageFile(absoluteArtwork)) {
    try {
      if (
        fs.existsSync(destination) &&
        fs.statSync(destination).size === fs.statSync(absoluteArtwork).size
      ) {
        return false;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temp = `${destination}.${process.pid}.tmp`;
      fs.copyFileSync(absoluteArtwork, temp);
      fs.renameSync(temp, destination);
      return true;
    } catch (error) {
      console.warn(`[metadata] animated thumbnail failed for ${gameId}/${slot}:`, error);
      return false;
    }
  }

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

/** `store_artwork_file` - copy a user-picked local image into the store. */
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

const ARTWORK_IMAGE_EXT = /\.(jpe?g|png|webp|gif|ico|avif)$/i;

/** Canonical slot for a stored file stem (`banner` is written as `hero`). */
export function artworkSlotForFile(fileName: string): GameArtworkSlot | null {
  const stem = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  if (stem === "banner") return "hero";
  if (stem === "cover" || stem === "hero" || stem === "logo" || stem === "icon") {
    return stem;
  }
  return null;
}

const ARTWORK_URL_FIELDS: {
  field: string;
  sourceField?: string;
  slot: GameArtworkSlot;
}[] = [
  { field: "coverArtUrl", sourceField: "coverSourceUrl", slot: "cover" },
  { field: "iconUrl", slot: "icon" },
  { field: "bannerUrl", slot: "hero" },
  { field: "logoUrl", sourceField: "logoSourceUrl", slot: "logo" },
];

/** True when a stored artwork URL points at this exact absolute file. */
function artworkUrlPointsAt(
  record: Record<string, unknown>,
  field: string,
  absoluteLower: string,
): boolean {
  const value = record[field];
  if (typeof value !== "string" || !value) return false;
  const decoded = percentDecodeArtworkUrl(value).replace(/\\/g, "/").toLowerCase();
  return decoded.includes(absoluteLower);
}

function referencedArtworkFields(
  game: ReturnType<typeof getGame>,
  absolute: string,
): { field: string; sourceField?: string; slot: GameArtworkSlot }[] {
  if (!game) return [];
  const record = game as unknown as Record<string, unknown>;
  const absoluteLower = absolute.replace(/\\/g, "/").toLowerCase();
  return ARTWORK_URL_FIELDS.filter((entry) =>
    artworkUrlPointsAt(record, entry.field, absoluteLower),
  );
}

interface ArtworkRoot {
  key: string;
  dir: string;
  location: "current" | "legacy";
}

/** The current store plus the pre-Electron artwork folders that legacy game
 *  rows still reference. Keys are stable so the renderer can delete a file
 *  without ever sending an absolute path. */
function artworkRoots(): ArtworkRoot[] {
  const roots: ArtworkRoot[] = [
    { key: "current", dir: artworkRoot(), location: "current" },
  ];
  const appData = app.getPath("appData");
  const currentRoot = path.resolve(artworkRoot());
  const samePath = (a: string, b: string): boolean =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  for (const name of ["com.gameindex.app", "GameIndex"]) {
    const dir = path.join(appData, name, "artwork");
    // On Windows `%APPDATA%\GameIndex` and `...\gameindex` are the same folder
    // as the current store, only cased differently.
    if (samePath(path.resolve(dir), currentRoot)) continue;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    roots.push({ key: name, dir, location: "legacy" });
  }
  return roots;
}

function artworkFileKey(root: ArtworkRoot, safeGame: string, fileName: string): string {
  return root.location === "current"
    ? `artwork/${safeGame}/${fileName}`
    : `legacy/${root.key}/${safeGame}/${fileName}`;
}

function resolveArtworkFileKey(
  roots: ArtworkRoot[],
  fileKey: string,
): { root: ArtworkRoot; safeGame: string; fileName: string } | null {
  const normalized = String(fileKey ?? "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts[0] === "artwork" && parts.length === 3) {
    const current = roots.find((root) => root.location === "current");
    return current ? { root: current, safeGame: parts[1], fileName: parts[2] } : null;
  }
  if (parts[0] === "legacy" && parts.length === 4) {
    const root = roots.find((entry) => entry.key === parts[1] && entry.location === "legacy");
    return root ? { root, safeGame: parts[2], fileName: parts[3] } : null;
  }
  return null;
}

/**
 * Every artwork file currently stored for one game.
 *
 * Generated `_thumb.webp` siblings are hidden by default: they are a cache, not
 * a user choice, and deleting the full-size file removes its thumbnail with it.
 */
export async function listGameArtwork(gameId: string): Promise<GameArtworkFile[]> {
  const safeGame = safeArtworkComponent(gameId);
  const game = getGame(gameId);
  const out: GameArtworkFile[] = [];

  for (const root of artworkRoots()) {
    const gameDir = path.join(root.dir, safeGame);
    const entries = await fsp.readdir(gameDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !ARTWORK_IMAGE_EXT.test(entry.name)) continue;
      if (/_thumb\.webp$/i.test(entry.name)) continue;
      const absolute = path.join(gameDir, entry.name);
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(absolute);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      out.push({
        fileKey: artworkFileKey(root, safeGame, entry.name),
        fileName: entry.name,
        slot: artworkSlotForFile(entry.name),
        thumbnail: false,
        sizeBytes: stat.size,
        modifiedAt: Math.floor(stat.mtimeMs / 1000),
        url: pathToFileURL(absolute).toString(),
        referenced: referencedArtworkFields(game, absolute).length > 0,
        location: root.location,
      });
    }
  }

  out.sort((a, b) => b.modifiedAt - a.modifiedAt || a.fileName.localeCompare(b.fileName));
  return out;
}

/**
 * Delete one stored artwork file and clear any game column that referenced it.
 *
 * The relative path is anchored to this game's artwork folder, so a stale
 * renderer list cannot remove another game's file. Deleting a full-size image
 * also removes its generated `_thumb.webp` sibling.
 */
export async function deleteGameArtwork(
  gameId: string,
  fileKey: string,
): Promise<DeleteGameArtworkResult> {
  const safeGame = safeArtworkComponent(gameId);
  const roots = artworkRoots();
  const resolved = resolveArtworkFileKey(roots, fileKey);
  if (!resolved || resolved.safeGame !== safeGame) {
    throw new Error("That file does not belong to this game's artwork folder.");
  }
  const { root, fileName } = resolved;
  if (
    !fileName ||
    fileName !== path.basename(fileName) ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..")
  ) {
    throw new Error("Invalid artwork file name.");
  }

  const gameDir = path.resolve(root.dir, safeGame);
  const absolute = path.resolve(gameDir, fileName);
  if (!absolute.startsWith(`${gameDir}${path.sep}`)) {
    throw new Error("Invalid artwork file path.");
  }

  const game = getGame(gameId);
  const patch: Record<string, string> = {};
  const cleared = new Set<GameArtworkSlot>();
  for (const entry of referencedArtworkFields(game, absolute)) {
    patch[entry.field] = "";
    if (entry.sourceField) patch[entry.sourceField] = "";
    cleared.add(entry.slot);
  }
  if (Object.keys(patch).length > 0) patchGameRecord(gameId, patch);

  let freedBytes = 0;
  let deleted = false;
  const remove = async (file: string): Promise<void> => {
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile()) return;
      await fsp.unlink(file);
      freedBytes += stat.size;
      deleted = true;
    } catch {
      /* already gone or locked */
    }
  };
  await remove(absolute);
  if (!/_thumb\.webp$/i.test(fileName)) {
    await remove(
      path.join(path.dirname(absolute), `${fileName.replace(/\.[^.]+$/, "")}_thumb.webp`),
    );
  }

  return { deleted, freedBytes, clearedSlots: [...cleared] };
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
