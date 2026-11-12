/**
 * Play-session persistence — SQLite backed.
 *
 * Stable API used by the command layer *and* the launch/watcher workstream, so
 * the storage backend can change without touching callers. Storage is
 * `<userData>/db/sessions.db` (`electron/main/state/db/sessions.ts`), mirroring
 * `src-tauri/src/db/schema_sessions.sql`: one row per session, `ended_at` NULL
 * while it runs, samples kept as compact JSON in `metrics_json`.
 */
import { readUserDataText } from "./jsonStore";
import {
  appendSessionSample,
  closeAllDatabases,
  deleteSessionRow,
  deleteSessionRowsForGame,
  ensureStorage,
  finishSessionRow,
  getSessionSamples as readSessionSamples,
  listFinishedSessionRows,
  listSessionRows,
  relinkSessionRows,
  startSessionRow,
} from "./db";
import type { SessionRecord, SessionStart } from "./db/sessions";

export type { SessionRecord, SessionStart };

export function flushSessionsSync(): void {
  // WAL checkpoint + close, same as the library store; idempotent.
  closeAllDatabases();
}

/** Drop the bulky `samples` array, keeping every other metric field. */
export function stripSamples(
  metricsJson: string | null | undefined,
): string | null | undefined {
  if (typeof metricsJson !== "string" || metricsJson.length === 0) return metricsJson;
  try {
    const parsed = JSON.parse(metricsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      delete (parsed as Record<string, unknown>).samples;
      return JSON.stringify(parsed);
    }
  } catch {
    // Legacy/corrupt blob: pass it through unchanged.
  }
  return metricsJson;
}

export function listSessions(): SessionRecord[] {
  ensureStorage("sessions");
  return listSessionRows();
}

/** Finished rows only, newest first (what the Activity page consumes). */
export function listFinishedSessions(): SessionRecord[] {
  ensureStorage("sessions");
  return listFinishedSessionRows();
}

export function getSessionSamples(
  ids: number[],
): { id: number; samples: unknown[] }[] {
  ensureStorage("sessions");
  return readSessionSamples(ids);
}

export function startSession(input: SessionStart): number {
  ensureStorage("sessions");
  return startSessionRow(input);
}

/** Close a running session and (optionally) replace its metric blob. */
export function finishSession(
  id: number,
  patch: Partial<
    Pick<
      SessionRecord,
      "endedAtMs" | "elapsedSeconds" | "avgFps" | "avgCpu" | "avgGpu" | "avgRam" | "metricsJson"
    >
  >,
): boolean {
  ensureStorage("sessions");
  return finishSessionRow(id, patch);
}

export function appendSample(sessionId: number, sample: unknown): boolean {
  ensureStorage("sessions");
  return appendSessionSample(sessionId, sample);
}

export function deleteSession(id: number): number {
  ensureStorage("sessions");
  return deleteSessionRow(id);
}

export function deleteSessionsForGame(gameId: string): number {
  if (!gameId) return 0;
  ensureStorage("sessions");
  return deleteSessionRowsForGame(gameId);
}

export function relinkSessionsForGame(
  oldGameId: string,
  newGameId: string,
  newGameName: string,
): number {
  if (!oldGameId || !newGameId) return 0;
  ensureStorage("sessions");
  return relinkSessionRows(oldGameId, newGameId, newGameName);
}

/** Legacy `sessions.json` migration source (read-only, original array shape). */
export function readLegacySessions(): string {
  return readUserDataText("sessions.json", "[]");
}
