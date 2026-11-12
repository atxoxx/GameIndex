/**
 * `sessions` domain repository.
 *
 * Mirrors `src-tauri/src/db/sessions.rs` for the operations the launch/watcher
 * workstream and the Activity page need. The stable `SessionRecord` shape is
 * declared here and re-exported by `state/sessionsStore.ts`.
 */
import { openDb, prepare, type SqlRow } from "./sqlite";

export interface SessionRecord {
  id: number;
  gameId: string;
  gameName?: string | null;
  startedAtMs: number;
  endedAtMs?: number | null;
  elapsedSeconds?: number | null;
  avgFps?: number | null;
  avgCpu?: number | null;
  avgGpu?: number | null;
  avgRam?: number | null;
  metricsJson?: string | null;
}

export interface SessionStart {
  gameId: string;
  gameName?: string | null;
  startedAtMs: number;
  elapsedSeconds?: number;
  avgFps?: number | null;
  avgCpu?: number | null;
  avgGpu?: number | null;
  avgRam?: number | null;
  metricsJson?: string | null;
}

const SELECT_ALL =
  "SELECT id, game_id, game_name, started_at, ended_at, elapsed_seconds, " +
  "avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json FROM sessions";

const INSERT_SQL =
  "INSERT INTO sessions(game_id, game_name, started_at, ended_at, elapsed_seconds, " +
  "avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json) VALUES (?,?,?,?,?,?,?,?,?,?)";

const UPSERT_WITH_ID_SQL =
  "INSERT INTO sessions(id, game_id, game_name, started_at, ended_at, elapsed_seconds, " +
  "avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json) VALUES (?,?,?,?,?,?,?,?,?,?,?) " +
  "ON CONFLICT(id) DO UPDATE SET game_id = excluded.game_id, game_name = excluded.game_name, " +
  "started_at = excluded.started_at, ended_at = excluded.ended_at, " +
  "elapsed_seconds = excluded.elapsed_seconds, avg_fps = excluded.avg_fps, " +
  "avg_cpu = excluded.avg_cpu, avg_gpu = excluded.avg_gpu, avg_ram = excluded.avg_ram, " +
  "metrics_json = excluded.metrics_json";

const PATCH_COLUMNS: Record<string, string> = {
  endedAtMs: "ended_at",
  elapsedSeconds: "elapsed_seconds",
  avgFps: "avg_fps",
  avgCpu: "avg_cpu",
  avgGpu: "avg_gpu",
  avgRam: "avg_ram",
  metricsJson: "metrics_json",
};

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function decodeSession(row: SqlRow): SessionRecord {
  const gameName = nullableString(row.game_name);
  return {
    id: number(row.id),
    gameId: typeof row.game_id === "string" ? row.game_id : "",
    gameName: gameName && gameName.length > 0 ? gameName : null,
    startedAtMs: number(row.started_at),
    endedAtMs: nullableNumber(row.ended_at),
    elapsedSeconds: nullableNumber(row.elapsed_seconds),
    avgFps: nullableNumber(row.avg_fps),
    avgCpu: nullableNumber(row.avg_cpu),
    avgGpu: nullableNumber(row.avg_gpu),
    avgRam: nullableNumber(row.avg_ram),
    metricsJson: nullableString(row.metrics_json),
  };
}

export function countSessions(): number {
  const row = prepare("sessions", "SELECT COUNT(*) AS n FROM sessions").get() as
    | { n?: number | bigint }
    | undefined;
  return Number(row?.n ?? 0);
}

export function listSessionRows(): SessionRecord[] {
  const rows = prepare("sessions", `${SELECT_ALL} ORDER BY id ASC`).all() as SqlRow[];
  return rows.map(decodeSession);
}

/** Finished rows only, newest first (what the Activity page consumes). */
export function listFinishedSessionRows(): SessionRecord[] {
  const rows = prepare(
    "sessions",
    `${SELECT_ALL} WHERE ended_at IS NOT NULL ORDER BY started_at DESC`,
  ).all() as SqlRow[];
  return rows.map(decodeSession);
}

export function getSessionSamples(
  ids: number[],
): { id: number; samples: unknown[] }[] {
  const wanted = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (wanted.length === 0) return [];

  const placeholders = wanted.map(() => "?").join(", ");
  const rows = prepare(
    "sessions",
    `SELECT id, metrics_json FROM sessions WHERE id IN (${placeholders}) ORDER BY id ASC`,
  ).all(...wanted) as SqlRow[];

  const out: { id: number; samples: unknown[] }[] = [];
  for (const row of rows) {
    if (typeof row.metrics_json !== "string") continue;
    try {
      const parsed = JSON.parse(row.metrics_json) as { samples?: unknown };
      if (Array.isArray(parsed.samples) && parsed.samples.length > 0) {
        out.push({ id: number(row.id), samples: parsed.samples });
      }
    } catch {
      /* treat as no curves */
    }
  }
  return out;
}

export function startSessionRow(input: SessionStart): number {
  const result = prepare("sessions", INSERT_SQL).run(
    input.gameId,
    input.gameName ?? "",
    input.startedAtMs,
    null,
    input.elapsedSeconds ?? 0,
    input.avgFps ?? null,
    input.avgCpu ?? null,
    input.avgGpu ?? null,
    input.avgRam ?? null,
    input.metricsJson ?? null,
  );
  return Number(result.lastInsertRowid);
}

/** Close a running session and (optionally) replace its metric blob. */
export function finishSessionRow(
  id: number,
  patch: Partial<
    Pick<
      SessionRecord,
      "endedAtMs" | "elapsedSeconds" | "avgFps" | "avgCpu" | "avgGpu" | "avgRam" | "metricsJson"
    >
  >,
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  const patchRecord = patch as Record<string, unknown>;

  const hasExplicitEnd =
    typeof patchRecord.endedAtMs === "number" && Number.isFinite(patchRecord.endedAtMs);

  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patchRecord[key];
    if (key === "endedAtMs" && !hasExplicitEnd) continue;
    sets.push(`${column} = ?`);
    params.push(value === undefined ? null : value);
  }
  if (!hasExplicitEnd) {
    // The JSON store stamped `Date.now()` when a patch left `endedAtMs` unset
    // (or null) and kept an already-recorded end timestamp otherwise. A plain
    // `COALESCE` reproduces exactly that (the whole SET list is evaluated
    // against the pre-update row).
    sets.push("ended_at = COALESCE(ended_at, ?)");
    params.push(Date.now());
  }
  params.push(id);

  const result = prepare(
    "sessions",
    `UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`,
  ).run(...params);
  return result.changes > 0;
}

export function appendSessionSample(sessionId: number, sample: unknown): boolean {
  const db = openDb("sessions");
  const run = db.transaction(() => {
    const row = prepare("sessions", "SELECT metrics_json FROM sessions WHERE id = ?").get(
      sessionId,
    ) as { metrics_json?: string | null } | undefined;
    if (!row) return false;

    let metrics: Record<string, unknown> = {};
    if (typeof row.metrics_json === "string" && row.metrics_json.length > 0) {
      try {
        const parsed = JSON.parse(row.metrics_json) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metrics = parsed as Record<string, unknown>;
        }
      } catch {
        metrics = {};
      }
    }
    const samples = Array.isArray(metrics.samples) ? (metrics.samples as unknown[]) : [];
    samples.push(sample);
    metrics.samples = samples;

    prepare("sessions", "UPDATE sessions SET metrics_json = ? WHERE id = ?").run(
      JSON.stringify(metrics),
      sessionId,
    );
    return true;
  });
  return run();
}

export function deleteSessionRow(id: number): number {
  return prepare("sessions", "DELETE FROM sessions WHERE id = ?").run(id).changes;
}

export function deleteSessionRowsForGame(gameId: string): number {
  if (!gameId) return 0;
  return prepare("sessions", "DELETE FROM sessions WHERE game_id = ?").run(gameId).changes;
}

export function relinkSessionRows(
  oldGameId: string,
  newGameId: string,
  newGameName: string,
): number {
  if (!oldGameId || !newGameId) return 0;
  return prepare(
    "sessions",
    "UPDATE sessions SET game_id = ?, game_name = ? WHERE game_id = ?",
  ).run(newGameId, newGameName, oldGameId).changes;
}

/** Import helper: insert rows with their original ids (idempotent by id). */
export function insertSessionRecords(records: SessionRecord[]): number {
  const db = openDb("sessions");
  const run = db.transaction(() => {
    const insert = prepare("sessions", UPSERT_WITH_ID_SQL);
    let written = 0;
    for (const record of records) {
      insert.run(
        record.id,
        record.gameId,
        record.gameName ?? "",
        record.startedAtMs,
        record.endedAtMs ?? null,
        record.elapsedSeconds ?? null,
        record.avgFps ?? null,
        record.avgCpu ?? null,
        record.avgGpu ?? null,
        record.avgRam ?? null,
        record.metricsJson ?? null,
      );
      written += 1;
    }
    return written;
  });
  return run();
}

/**
 * Import helper: merge rows and skip a row when (game_id, started_at) is
 * already stored — the Rust `insert_batch` merge mode.
 */
export function mergeSessionRecords(records: SessionRecord[]): number {
  const db = openDb("sessions");
  const run = db.transaction(() => {
    const exists = prepare(
      "sessions",
      "SELECT 1 AS hit FROM sessions WHERE game_id = ? AND started_at = ? LIMIT 1",
    );
    const insert = prepare("sessions", INSERT_SQL);
    let written = 0;
    for (const record of records) {
      if (exists.get(record.gameId, record.startedAtMs)) continue;
      insert.run(
        record.gameId,
        record.gameName ?? "",
        record.startedAtMs,
        record.endedAtMs ?? null,
        record.elapsedSeconds ?? null,
        record.avgFps ?? null,
        record.avgCpu ?? null,
        record.avgGpu ?? null,
        record.avgRam ?? null,
        record.metricsJson ?? null,
      );
      written += 1;
    }
    return written;
  });
  return run();
}
