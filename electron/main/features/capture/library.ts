/**
 * Clip registry, reels and the on-disk clips folder.
 *
 * Ported from `src-tauri/src/db/clips.rs` (the `clips` / `reels` / `reel_items`
 * SQL schema) plus `capture/listing.rs` (folder discovery / deletion / reveal).
 * The Rust build kept this in `clips.db` (SQLite); the Electron pass stores the
 * same rows in one small JSON document, `userData/clips.json`, because the
 * documents only change on explicit user actions and reels are cheap playlists.
 *
 * Behaviour deliberately matched to the SQL DAO:
 *   • registering the same file path updates metadata instead of duplicating
 *   • reels sort by `updatedAt` desc, clips by `createdAt` desc
 *   • reel names are unique case-insensitively
 *   • deleting a clip removes it from every reel
 *   • reordering keeps clips the caller forgot to send, at the end
 *
 * Deliberate deviations (all documented in the port report):
 *   • `register_clip` fills `sizeBytes` from disk when the caller omitted it
 *     (the Reels page imports by path only, and "—" columns are useless).
 *   • deleting a clip *file* also drops its registry row, so the gallery cannot
 *     keep pointing at a file that no longer exists.
 */
import { app, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJsonStore } from "../../state/jsonStore";
import { getOverlaySettings } from "../../surfaces/overlay";
import type {
  ClipRow,
  RegisterClipPayload,
  ReelRow,
  ReelsSnapshot,
  UpdateClipPayload,
} from "./types";

const STORE_FILE = "clips.json";
/** Ceiling on the recent-clips list handed to the renderer. */
const MAX_RECENT_CLIPS = 500;
/** Extensions `capture/listing.rs` recognised, plus `ts` (our kill-safe
 *  transport stream, which is promoted to mp4 on a clean stop). */
const CLIP_EXTENSIONS = new Set(["mp4", "mkv", "webm", "mov", "ts"]);

interface ClipsDocument {
  version: number;
  clips: ClipRow[];
  reels: ReelRow[];
}

function emptyDocument(): ClipsDocument {
  return { version: 1, clips: [], reels: [] };
}

// ── Defensive normalization ─────────────────────────────────────────
function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  return asOptionalNumber(value) ?? fallback;
}

/** Set or drop an optional key so the JSON stays `skip_serializing_if`-clean. */
function withOptional<T extends object>(row: T, key: string, value: unknown): T {
  const next = { ...row } as Record<string, unknown>;
  if (value === undefined || value === null || value === "") delete next[key];
  else next[key] = value;
  return next as T;
}

function normalizeClipRow(value: unknown): ClipRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = asText(raw.id);
  const filePath = asText(raw.path);
  if (!id || !filePath) return null;
  const title = asText(raw.title) || path.basename(filePath);
  let row: ClipRow = {
    id,
    path: filePath,
    title,
    favorite: Boolean(raw.favorite),
    createdAt: asNumber(raw.createdAt),
    addedAt: asNumber(raw.addedAt),
  };
  row = withOptional(row, "gameId", asOptionalText(raw.gameId));
  row = withOptional(row, "gameName", asOptionalText(raw.gameName));
  row = withOptional(row, "kind", asOptionalText(raw.kind));
  row = withOptional(row, "durationMs", asOptionalNumber(raw.durationMs));
  row = withOptional(row, "sizeBytes", asOptionalNumber(raw.sizeBytes));
  return row;
}

function normalizeReelRow(value: unknown): ReelRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = asText(raw.id);
  const name = asText(raw.name).trim();
  if (!id || !name) return null;
  const clipIds = Array.isArray(raw.clipIds)
    ? [...new Set(raw.clipIds.filter((entry): entry is string => typeof entry === "string"))]
    : [];
  let row: ReelRow = {
    id,
    name,
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
    clipIds,
  };
  row = withOptional(row, "description", asOptionalText(raw.description));
  return row;
}

function normalizeDocument(value: unknown): ClipsDocument {
  const raw = (value ?? {}) as Partial<ClipsDocument>;
  return {
    version: 1,
    clips: Array.isArray(raw.clips)
      ? raw.clips.map(normalizeClipRow).filter((row): row is ClipRow => row !== null)
      : [],
    reels: Array.isArray(raw.reels)
      ? raw.reels.map(normalizeReelRow).filter((row): row is ReelRow => row !== null)
      : [],
  };
}

const store = createJsonStore<ClipsDocument>(STORE_FILE, emptyDocument, normalizeDocument);

function nowMs(): number {
  return Date.now();
}

function readDocument(): ClipsDocument {
  return store.read();
}

function writeDocument(document: ClipsDocument): void {
  store.write(document);
}

// ── Clips folder ────────────────────────────────────────────────────
/**
 * Where clips live: the configured `videoFolder`, else `Videos\GameIndex\Clips`.
 * (`app.getPath("videos")` is the real shell Videos folder.)
 */
export function clipFolder(): string {
  const custom = getOverlaySettings().videoFolder?.trim();
  if (custom) return custom;
  try {
    return path.join(app.getPath("videos"), "GameIndex", "Clips");
  } catch {
    return path.join(app.getPath("userData"), "clips");
  }
}

export function ensureClipFolder(): string {
  const folder = clipFolder();
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function clipExtension(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

export function isClipFile(filePath: string): boolean {
  return CLIP_EXTENSIONS.has(clipExtension(filePath));
}

/** Newest-first clip files in the configured folder, capped for IPC. */
export function listClipFiles(): string[] {
  const dir = clipFolder();
  let entries: Array<{ filePath: string; mtime: number }>;
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      // `.recording-*.ts` staging files belong to an in-flight recording.
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && isClipFile(entry.name))
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
  return entries.slice(0, MAX_RECENT_CLIPS).map((entry) => entry.filePath);
}

/**
 * Delete one clip file, refusing unknown extensions so a bad path cannot wipe
 * unrelated files (same guard as `capture/listing.rs`). Missing files are a
 * no-op. The registry row (and its reel memberships) is dropped with it.
 */
export function deleteClipFile(filePath: string): void {
  if (!isClipFile(filePath)) throw new Error("Invalid file type to delete");
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new Error(
        `failed to delete clip — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  forgetClipPath(filePath);
}

/** Reveal a file or open a folder in the OS file manager. */
export async function openClipLocation(target?: string | null): Promise<void> {
  const explicit = target?.trim();
  if (explicit) {
    let exists = false;
    try {
      exists = fs.existsSync(explicit);
    } catch {
      exists = false;
    }
    if (exists) {
      if (fs.statSync(explicit).isFile()) {
        shell.showItemInFolder(explicit);
        return;
      }
      const error = await shell.openPath(explicit);
      if (error) throw new Error(error);
      return;
    }
  }
  const folder = ensureClipFolder();
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
}

// ── Clip registry ───────────────────────────────────────────────────
/** Every registered clip, newest footage first. */
export function listClips(): ClipRow[] {
  return [...readDocument().clips].sort(
    (a, b) => b.createdAt - a.createdAt || b.addedAt - a.addedAt,
  );
}

export function getClip(id: string): ClipRow | null {
  return readDocument().clips.find((row) => row.id === id) ?? null;
}

export function getClipByPath(filePath: string): ClipRow | null {
  return readDocument().clips.find((row) => row.path === filePath) ?? null;
}

function fileSize(filePath: string): number | undefined {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Insert a clip, or update the metadata of the row that already owns the same
 * path (idempotent import). Returns the stored row.
 */
export function registerClip(payload: RegisterClipPayload): ClipRow {
  const filePath = asText(payload.path);
  const title = asText(payload.title);
  if (!filePath.trim()) throw new Error("clip path cannot be empty");
  if (!title.trim()) throw new Error("clip title cannot be empty");

  const meta = {
    gameId: asOptionalText(payload.gameId),
    gameName: asOptionalText(payload.gameName),
    kind: asOptionalText(payload.kind),
    durationMs: asOptionalNumber(payload.durationMs),
    sizeBytes: asOptionalNumber(payload.sizeBytes) ?? fileSize(filePath),
  };

  const document = readDocument();
  const index = document.clips.findIndex((row) => row.path === filePath);
  if (index >= 0) {
    const existing = document.clips[index];
    // The SQL upsert refreshed only these columns; the id, favorite and both
    // timestamps belong to the original registration.
    let row: ClipRow = { ...existing, title };
    row = withOptional(row, "gameId", meta.gameId);
    row = withOptional(row, "gameName", meta.gameName);
    row = withOptional(row, "kind", meta.kind);
    row = withOptional(row, "durationMs", meta.durationMs);
    row = withOptional(row, "sizeBytes", meta.sizeBytes);
    document.clips[index] = row;
    writeDocument(document);
    return row;
  }

  const stamp = nowMs();
  let row: ClipRow = {
    id: asText(payload.id).trim() || randomUUID(),
    path: filePath,
    title,
    favorite: false,
    createdAt: asOptionalNumber(payload.createdAt) ?? stamp,
    addedAt: stamp,
  };
  row = withOptional(row, "gameId", meta.gameId);
  row = withOptional(row, "gameName", meta.gameName);
  row = withOptional(row, "kind", meta.kind);
  row = withOptional(row, "durationMs", meta.durationMs);
  row = withOptional(row, "sizeBytes", meta.sizeBytes);
  document.clips.push(row);
  writeDocument(document);
  return row;
}

/** Update the editable fields of a clip (title / favorite / game link). */
export function updateClip(update: UpdateClipPayload): void {
  const id = asText(update.id).trim();
  if (!id) throw new Error("clip id cannot be empty");

  const document = readDocument();
  const index = document.clips.findIndex((row) => row.id === id);
  if (index < 0) throw new Error(`clip not found: ${id}`);

  let row = document.clips[index];
  if (update.title !== undefined) {
    const title = String(update.title);
    if (!title.trim()) throw new Error("clip title cannot be empty");
    row = { ...row, title };
  }
  if (typeof update.favorite === "boolean") {
    row = { ...row, favorite: update.favorite };
  }
  // Tri-state: absent leaves the link alone, `null` unlinks, a string relinks.
  if (update.gameId !== undefined) {
    row = withOptional(row, "gameId", typeof update.gameId === "string" ? update.gameId : undefined);
  }
  if (update.gameName !== undefined) {
    row = withOptional(
      row,
      "gameName",
      typeof update.gameName === "string" ? update.gameName : undefined,
    );
  }
  document.clips[index] = row;
  writeDocument(document);
}

/** Remove a clip from the registry and from every reel (file untouched). */
export function deleteClipById(id: string): void {
  const document = readDocument();
  const before = document.clips.length;
  document.clips = document.clips.filter((row) => row.id !== id);
  if (document.clips.length === before) return;
  for (const reel of document.reels) {
    if (reel.clipIds.includes(id)) {
      reel.clipIds = reel.clipIds.filter((clipId) => clipId !== id);
    }
  }
  writeDocument(document);
}

/** Drop registry rows that point at `filePath` (clip file deleted from disk). */
function forgetClipPath(filePath: string): void {
  const document = readDocument();
  const doomed = new Set(
    document.clips.filter((row) => row.path === filePath).map((row) => row.id),
  );
  if (doomed.size === 0) return;
  document.clips = document.clips.filter((row) => !doomed.has(row.id));
  for (const reel of document.reels) {
    if (reel.clipIds.some((clipId) => doomed.has(clipId))) {
      reel.clipIds = reel.clipIds.filter((clipId) => !doomed.has(clipId));
    }
  }
  writeDocument(document);
}

// ── Reels ───────────────────────────────────────────────────────────
/** All reels with their ordered clip ids, most recently touched first. */
export function listReels(): ReelRow[] {
  return [...readDocument().reels].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function reelsSnapshot(): ReelsSnapshot {
  return { clips: listClips(), reels: listReels() };
}

export function createReel(id: string, name: string, description?: string | null): void {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("reel name cannot be empty");
  const reelId = String(id ?? "").trim() || randomUUID();
  const document = readDocument();
  if (document.reels.some((reel) => reel.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`a reel named "${trimmed}" already exists`);
  }
  const stamp = nowMs();
  let row: ReelRow = {
    id: reelId,
    name: trimmed,
    createdAt: stamp,
    updatedAt: stamp,
    clipIds: [],
  };
  row = withOptional(row, "description", description ?? undefined);
  document.reels.push(row);
  writeDocument(document);
}

export function renameReel(
  id: string,
  name: string,
  description?: string | null,
): void {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("reel name cannot be empty");
  const document = readDocument();
  const reel = document.reels.find((row) => row.id === String(id ?? ""));
  if (!reel) throw new Error(`reel not found: ${id}`);
  reel.name = trimmed;
  // COALESCE semantics: a null description leaves the stored one alone.
  if (description !== undefined && description !== null) {
    reel.description = String(description);
  }
  reel.updatedAt = nowMs();
  writeDocument(document);
}

export function deleteReel(id: string): void {
  const document = readDocument();
  const before = document.reels.length;
  document.reels = document.reels.filter((row) => row.id !== id);
  if (document.reels.length !== before) writeDocument(document);
}

/** Append a clip to the end of a reel. Returns `true` when it was inserted. */
export function addClipToReel(reelId: string, clipId: string): boolean {
  const document = readDocument();
  const reel = document.reels.find((row) => row.id === reelId);
  if (!reel) throw new Error(`reel not found: ${reelId}`);
  if (!document.clips.some((row) => row.id === clipId)) {
    throw new Error(`clip not found: ${clipId}`);
  }
  const inserted = !reel.clipIds.includes(clipId);
  if (inserted) reel.clipIds.push(clipId);
  // The SQL DAO bumped `updated_at` even for the ignored duplicate insert.
  reel.updatedAt = nowMs();
  writeDocument(document);
  return inserted;
}

export function removeClipFromReel(reelId: string, clipId: string): void {
  const document = readDocument();
  const reel = document.reels.find((row) => row.id === reelId);
  if (!reel) return;
  reel.clipIds = reel.clipIds.filter((id) => id !== clipId);
  reel.updatedAt = nowMs();
  writeDocument(document);
}

/**
 * Rewrite a reel's order. Ids that are not in the reel are ignored; clips the
 * caller left out are appended in their previous relative order so a stale
 * payload cannot lose items.
 */
export function reorderReel(reelId: string, clipIds: string[]): void {
  const document = readDocument();
  const reel = document.reels.find((row) => row.id === reelId);
  if (!reel || reel.clipIds.length === 0) {
    throw new Error(`reel not found or empty: ${reelId}`);
  }
  const current = reel.clipIds;
  const ordered: string[] = [];
  for (const id of clipIds.map((value) => String(value))) {
    if (current.includes(id) && !ordered.includes(id)) ordered.push(id);
  }
  for (const id of current) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  reel.clipIds = ordered;
  reel.updatedAt = nowMs();
  writeDocument(document);
}
