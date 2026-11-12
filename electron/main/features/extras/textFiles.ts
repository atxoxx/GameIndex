/**
 * Plain-text import/export used by CSV/JSON exports, log downloads, the
 * emulator-config importer and the activity export.
 *
 * Ported from `src-tauri/src/media.rs` (`read_text_file` / `save_text_file`).
 * The Rust commands used `fs::read_to_string` / `fs::write`; this port keeps
 * the same UTF-8 contract but adds size limits and actionable errors so a
 * huge or binary file cannot be slurped into the renderer by accident.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

/** Imports are settings/JSON; anything larger is almost certainly wrong. */
const MAX_READ_BYTES = 32 * 1024 * 1024;
/** Exports can be larger, but still bounded. */
const MAX_WRITE_BYTES = 64 * 1024 * 1024;

function assertAbsolute(filePath: string, what: string): string {
  const trimmed = filePath?.trim();
  if (!trimmed) throw new Error(`A ${what} path is required.`);
  if (trimmed.includes("\0")) throw new Error(`Invalid ${what} path.`);
  if (!path.isAbsolute(trimmed)) throw new Error(`The ${what} path must be absolute.`);
  return trimmed;
}

/** `read_text_file` — UTF-8 only, 32 MB cap. */
export async function readTextFile(filePath: string): Promise<string> {
  const target = assertAbsolute(filePath, "text file");
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    throw new Error("Text file not found — it may have been moved or deleted.");
  }
  if (!stat.isFile()) throw new Error("That path is not a file.");
  if (stat.size > MAX_READ_BYTES) {
    throw new Error("File is too large to import (32 MB limit).");
  }
  const bytes = await fsp.readFile(target);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("File is not valid UTF-8 text — export it as UTF-8 and try again.");
  }
}

/** `save_text_file` — writes UTF-8, creating missing parent directories. */
export async function saveTextFile(filePath: string, contents: string): Promise<null> {
  const target = assertAbsolute(filePath, "text file");
  if (typeof contents !== "string") throw new Error("Text contents must be a string.");
  const bytes = Buffer.byteLength(contents, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error("Text export is too large (64 MB limit).");
  }
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, contents, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write file — ${message}`);
  }
  return null;
}
