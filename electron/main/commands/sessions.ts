/**
 * Session history commands.
 *
 * Mirrors the Rust `sessions.rs` + `db/sessions.rs` contract:
 *  • `get_sessions` returns finished rows only, newest first, with the
 *    per-sample telemetry stripped (`metricsJson.samples` removed).
 *  • `get_session_samples` lazily returns just the curves for requested ids.
 *  • `insert_session` is the legacy-migration/import path.
 *
 * Persistence lives in `state/sessionsStore.ts` (shared with the launch
 * watcher), so a storage-backend change does not touch these handlers.
 */
import type { CommandHandler } from "../ipc";
import {
  deleteSession,
  deleteSessionsForGame,
  getSessionSamples,
  listFinishedSessions,
  readLegacySessions,
  relinkSessionsForGame,
  startSession,
  finishSession,
  stripSamples,
} from "../state/sessionsStore";

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function requiredNumber(value: unknown, field: string): number {
  const n = numeric(value);
  if (n === null) throw new Error(`insert_session expects a numeric \`${field}\``);
  return Math.max(0, Math.trunc(n));
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export const sessionCommands: Record<string, CommandHandler> = {
  get_sessions: () =>
    listFinishedSessions().map((row) => ({
      ...row,
      metricsJson: stripSamples(row.metricsJson),
    })),

  get_session_samples: (args) => {
    const ids = Array.isArray(args.ids) ? args.ids.map((id) => Number(id)) : [];
    return getSessionSamples(ids);
  },

  insert_session: (args) => {
    const gameId = stringValue(args.gameId ?? args.game_id);
    if (!gameId) throw new Error("insert_session expects a `gameId`");
    const gameName = stringValue(args.gameName ?? args.game_name);
    const startedAtMs = requiredNumber(
      args.startedAtMs ?? args.started_at_ms,
      "startedAtMs",
    );
    const elapsedSeconds = Math.max(
      0,
      Math.trunc(numeric(args.elapsedSeconds ?? args.elapsed_seconds) ?? 0),
    );

    const id = startSession({
      gameId,
      gameName,
      startedAtMs,
      elapsedSeconds,
      avgFps: numeric(args.avgFps ?? args.avg_fps),
      avgCpu: numeric(args.avgCpu ?? args.avg_cpu),
      avgGpu: numeric(args.avgGpu ?? args.avg_gpu),
      avgRam: numeric(args.avgRam ?? args.avg_ram),
      metricsJson: typeof args.metricsJson === "string" ? args.metricsJson : null,
    });
    finishSession(id, {
      endedAtMs: startedAtMs + elapsedSeconds * 1000,
      elapsedSeconds,
    });
    return id;
  },

  delete_session: (args) => {
    const id = numeric(args.id);
    if (id === null) return 0;
    return deleteSession(id);
  },

  delete_sessions_for_game: (args) =>
    deleteSessionsForGame(stringValue(args.gameId ?? args.game_id)),

  relink_sessions_for_game: (args) =>
    relinkSessionsForGame(
      stringValue(args.oldGameId ?? args.old_game_id),
      stringValue(args.newGameId ?? args.new_game_id),
      stringValue(args.newGameName ?? args.new_game_name),
    ),

  /** Legacy `sessions.json` migration source. Read-only. */
  load_sessions: () => readLegacySessions(),
};
