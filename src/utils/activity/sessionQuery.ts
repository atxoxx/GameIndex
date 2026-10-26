import type { GameSession } from "../../types/game";
import { sessionDayKey } from "./sessionTime";

export type TelemetryFilter = "all" | "telemetry" | "notes";
export type DurationFilter = "all" | "quick" | "medium" | "long";
export type SessionSortField = "date" | "duration" | "fps" | "gpuTemp";
export type SortDirection = "asc" | "desc";
export type SessionDensity = "comfortable" | "compact";

export interface ActivitySessionFilters {
  telemetry: TelemetryFilter;
  duration: DurationFilter;
  sort: SessionSortField;
  dir: SortDirection;
  density: SessionDensity;
}

export const TELEMETRY_FILTERS: readonly TelemetryFilter[] = ["all", "telemetry", "notes"];
export const DURATION_FILTERS: readonly DurationFilter[] = ["all", "quick", "medium", "long"];
export const SESSION_SORT_FIELDS: readonly SessionSortField[] = [
  "date",
  "duration",
  "fps",
  "gpuTemp",
];
export const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];
export const SESSION_DENSITIES: readonly SessionDensity[] = ["comfortable", "compact"];

export const DEFAULT_SESSION_FILTERS: ActivitySessionFilters = {
  telemetry: "all",
  duration: "all",
  sort: "date",
  dir: "desc",
  density: "comfortable",
};

export interface SessionNoteLike {
  note: string;
  tags: string[];
}

export type SessionNoteIndex = Record<string, SessionNoteLike | undefined>;

function pick<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Validate a filter payload from the URL, localStorage or a saved view. */
export function sanitizeSessionFilters(
  raw: Partial<Record<keyof ActivitySessionFilters, unknown>> | null | undefined,
): ActivitySessionFilters {
  if (!raw) return { ...DEFAULT_SESSION_FILTERS };
  return {
    telemetry: pick(raw.telemetry as string | undefined, TELEMETRY_FILTERS, "all"),
    duration: pick(raw.duration as string | undefined, DURATION_FILTERS, "all"),
    sort: pick(raw.sort as string | undefined, SESSION_SORT_FIELDS, "date"),
    dir: pick(raw.dir as string | undefined, SORT_DIRECTIONS, "desc"),
    density: pick(raw.density as string | undefined, SESSION_DENSITIES, "comfortable"),
  };
}

export function countActiveSessionFilters(filters: ActivitySessionFilters): number {
  let count = 0;
  if (filters.telemetry !== "all") count += 1;
  if (filters.duration !== "all") count += 1;
  return count;
}

export function matchesDuration(minutes: number, filter: DurationFilter): boolean {
  if (filter === "all") return true;
  if (filter === "quick") return minutes < 30;
  if (filter === "medium") return minutes >= 30 && minutes <= 120;
  return minutes > 120;
}

export interface FilterSessionsOptions {
  query?: string;
  filters: ActivitySessionFilters;
  notes?: SessionNoteIndex;
}

/**
 * Search + filter. Search covers the game name, the local date, session notes
 * and note tags, so the same box works on the library-wide list and inside a
 * single game's tab.
 */
export function filterSessions(
  sessions: GameSession[],
  { query = "", filters, notes = {} }: FilterSessionsOptions,
): GameSession[] {
  const q = query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (!matchesDuration(session.durationMin, filters.duration)) return false;

    const note = notes[session.id];
    if (filters.telemetry === "telemetry") {
      if (!session.metrics || session.metrics.avgCpuUsage <= 0) return false;
    }
    if (filters.telemetry === "notes") {
      if (!note || (!note.note && note.tags.length === 0)) return false;
    }

    if (!q) return true;
    if (session.gameName.toLowerCase().includes(q)) return true;
    if (sessionDayKey(session).includes(q)) return true;
    if (note?.note.toLowerCase().includes(q)) return true;
    if (note?.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
    return false;
  });
}

export function sortSessions(
  sessions: GameSession[],
  filters: Pick<ActivitySessionFilters, "sort" | "dir">,
): GameSession[] {
  const direction = filters.dir === "asc" ? 1 : -1;
  const score = (session: GameSession): number => {
    switch (filters.sort) {
      case "duration":
        return session.durationMin;
      case "fps":
        return session.metrics?.avgFps ?? 0;
      case "gpuTemp":
        return session.metrics?.avgGpuTemp ?? 0;
      default:
        return new Date(session.date).getTime();
    }
  };
  return [...sessions].sort((a, b) => (score(a) - score(b)) * direction);
}

/** Stable label keys for the active filter chips (\`activitySessions.*\`). */
export function activeFilterChips(
  filters: ActivitySessionFilters,
): Array<{ key: "telemetry" | "duration"; labelKey: string }> {
  const chips: Array<{ key: "telemetry" | "duration"; labelKey: string }> = [];
  if (filters.telemetry === "telemetry") {
    chips.push({ key: "telemetry", labelKey: "activitySessions.filterWithTelemetry" });
  } else if (filters.telemetry === "notes") {
    chips.push({ key: "telemetry", labelKey: "activitySessions.filterWithNotes" });
  }
  if (filters.duration === "quick") {
    chips.push({ key: "duration", labelKey: "activityInsights.sessionBucket.quick" });
  } else if (filters.duration === "medium") {
    chips.push({ key: "duration", labelKey: "activityInsights.sessionBucket.short" });
  } else if (filters.duration === "long") {
    chips.push({ key: "duration", labelKey: "activityInsights.sessionBucket.long" });
  }
  return chips;
}
