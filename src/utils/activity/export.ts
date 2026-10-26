import { gameDisplayName, type Game, type GameSession } from "../../types/game";
import type { ActivityRange } from "./range";

export interface ActivityNoteLike {
  note: string;
  tags: string[];
}

const HEADERS = [
  "session_id",
  "game_name",
  "game_id",
  "played_at",
  "duration_min",
  "platform",
  "avg_fps",
  "min_fps",
  "max_fps",
  "avg_cpu",
  "avg_gpu",
  "avg_ram",
  "avg_cpu_temp",
  "avg_gpu_temp",
  "notes",
] as const;

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** CSV export shared by the page and a game's tab. */
export function buildActivityCsv(
  sessions: GameSession[],
  games: Game[],
  notes: Record<string, ActivityNoteLike | undefined> = {},
): string {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const rows = sessions.map((session) => {
    const game = gameById.get(session.gameId);
    return [
      session.id,
      game ? gameDisplayName(game) : session.gameName,
      session.gameId,
      session.date,
      session.durationMin,
      game?.platform || "Local",
      session.metrics?.avgFps ?? "",
      session.metrics?.minFps ?? "",
      session.metrics?.maxFps ?? "",
      session.metrics?.avgCpuUsage ?? "",
      session.metrics?.avgGpuUsage ?? "",
      session.metrics?.avgRamUsage ?? "",
      session.metrics?.avgCpuTemp ?? "",
      session.metrics?.avgGpuTemp ?? "",
      notes[session.id]?.note ?? "",
    ].map(csvCell);
  });
  return [HEADERS.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

export interface ActivityExportPayload {
  exportedAt: string;
  range: { from: string; to: string };
  totalSessions: number;
  sessions: Array<GameSession & { platform: string; notes: ActivityNoteLike | null }>;
}

export function buildActivityExportPayload(
  sessions: GameSession[],
  games: Game[],
  notes: Record<string, ActivityNoteLike | undefined>,
  range: ActivityRange,
): ActivityExportPayload {
  const gameById = new Map(games.map((game) => [game.id, game]));
  return {
    exportedAt: new Date().toISOString(),
    range: { from: range.startDate, to: range.endDate },
    totalSessions: sessions.length,
    sessions: sessions.map((session) => ({
      ...session,
      gameName: gameById.get(session.gameId)
        ? gameDisplayName(gameById.get(session.gameId)!)
        : session.gameName,
      platform: gameById.get(session.gameId)?.platform || "Local",
      notes: notes[session.id] ?? null,
    })),
  };
}

/** Client-side download used when the app runs outside the Tauri shell. */
export function downloadTextFile(contents: string, fileName: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
