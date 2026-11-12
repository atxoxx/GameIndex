/**
 * `store_artwork_file` — copy a user-picked image into the artwork store.
 *
 * Port of `db::artwork::store_file`. Artwork lives outside the library
 * document so a 4 MB cover does not sit in every `library.json` write. The
 * command returns the relative path the renderer feeds to
 * `artwork_asset_url`.
 *
 * Thumbnail generation from the Rust build (`cover_thumb.webp`) needs an image
 * codec the Electron build does not ship yet; the full-resolution file is
 * written and the renderer's existing fallback handles the missing sibling.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const ARTWORK_DIR = "artwork";
const VALID_SLOTS = new Set(["icon", "cover", "hero", "banner", "logo"]);

function safeComponent(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function extensionFor(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  if (ext === "jpeg") return "jpg";
  if (["png", "jpg", "webp", "gif", "ico", "jfif"].includes(ext)) return ext;
  return "jpg";
}

export function storeArtworkFile(
  gameId: string,
  slot: string,
  filePath: string,
): string | null {
  if (!gameId || !slot || !filePath) return null;
  if (!VALID_SLOTS.has(slot)) {
    throw new Error(
      `Unknown artwork slot "${slot}" — expected one of ${[...VALID_SLOTS].join(", ")}.`,
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const root = app.getPath("userData");
  const dir = path.join(root, ARTWORK_DIR, safeComponent(gameId));
  fs.mkdirSync(dir, { recursive: true });

  const relative = `${ARTWORK_DIR}/${safeComponent(gameId)}/${safeComponent(slot)}.${extensionFor(
    filePath,
  )}`;
  const destination = path.join(root, relative);
  const tmp = `${destination}.${process.pid}.tmp`;
  try {
    fs.copyFileSync(filePath, tmp);
    fs.renameSync(tmp, destination);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw new Error(
      `Could not store the artwork file — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return relative;
}
