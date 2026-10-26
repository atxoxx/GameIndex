import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_FILTERS,
  activeFilterChips,
  countActiveSessionFilters,
  filterSessions,
  sanitizeSessionFilters,
  sortSessions,
} from "./sessionQuery";
import type { GameSession, SessionMetrics } from "../../types/game";

function metrics(avgFps: number, avgCpuUsage = 20, avgGpuTemp = 60): SessionMetrics {
  return {
    avgFps,
    avgCpuUsage,
    avgGpuUsage: 40,
    avgRamUsage: 50,
    avgCpuTemp: 55,
    avgGpuTemp,
    minFps: Math.max(0, avgFps - 10),
    maxFps: avgFps + 10,
    resolution: "1920x1080",
  };
}

function session(
  id: string,
  date: string,
  durationMin: number,
  options: { gameName?: string; metrics?: SessionMetrics } = {},
): GameSession {
  return {
    id,
    gameId: id,
    gameName: options.gameName ?? `Game ${id}`,
    date,
    durationMin,
    metrics: options.metrics,
  };
}

const list = [
  session("a", "2026-08-01T10:00:00", 20, { gameName: "Elden Ring", metrics: metrics(60) }),
  session("b", "2026-08-02T22:00:00", 45, { gameName: "Hades II" }),
  session("c", "2026-08-03T20:00:00", 150, { gameName: "Baldur's Gate 3", metrics: metrics(90, 40, 80) }),
];

const notes = {
  b: { note: "Great run into the underworld", tags: ["roguelike", "evening"] },
};

describe("filterSessions", () => {
  it("filters by duration bucket boundaries", () => {
    const quick = filterSessions(list, { filters: { ...DEFAULT_SESSION_FILTERS, duration: "quick" } });
    const medium = filterSessions(list, { filters: { ...DEFAULT_SESSION_FILTERS, duration: "medium" } });
    const long = filterSessions(list, { filters: { ...DEFAULT_SESSION_FILTERS, duration: "long" } });
    expect(quick.map((s) => s.id)).toEqual(["a"]);
    expect(medium.map((s) => s.id)).toEqual(["b"]);
    expect(long.map((s) => s.id)).toEqual(["c"]);
  });

  it("requires captured telemetry for the telemetry filter", () => {
    const result = filterSessions(list, {
      filters: { ...DEFAULT_SESSION_FILTERS, telemetry: "telemetry" },
      notes,
    });
    expect(result.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("matches notes by body and tag", () => {
    expect(
      filterSessions(list, { filters: DEFAULT_SESSION_FILTERS, notes, query: "underworld" }).map((s) => s.id),
    ).toEqual(["b"]);
    expect(
      filterSessions(list, { filters: DEFAULT_SESSION_FILTERS, notes, query: "ROGUELIKE" }).map((s) => s.id),
    ).toEqual(["b"]);
  });

  it("matches game names and local dates", () => {
    expect(
      filterSessions(list, { filters: DEFAULT_SESSION_FILTERS, notes, query: "elden" }).map((s) => s.id),
    ).toEqual(["a"]);
    expect(
      filterSessions(list, { filters: DEFAULT_SESSION_FILTERS, notes, query: "2026-08-03" }).map((s) => s.id),
    ).toEqual(["c"]);
  });

  it("returns everything for an empty query with no active filters", () => {
    expect(filterSessions(list, { filters: DEFAULT_SESSION_FILTERS, notes })).toHaveLength(3);
  });
});

describe("sortSessions", () => {
  it("sorts by each metric and direction without mutating the input", () => {
    const input = [...list];
    expect(sortSessions(input, { sort: "fps", dir: "desc" }).map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(sortSessions(input, { sort: "duration", dir: "asc" }).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(input.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("sanitizeSessionFilters", () => {
  it("drops unknown values and keeps valid ones", () => {
    expect(
      sanitizeSessionFilters({ telemetry: "notes", duration: "never", sort: "fps", dir: "sideways", density: "compact" }),
    ).toEqual({
      telemetry: "notes",
      duration: "all",
      sort: "fps",
      dir: "desc",
      density: "compact",
    });
  });

  it("returns defaults for empty input", () => {
    expect(sanitizeSessionFilters(null)).toEqual(DEFAULT_SESSION_FILTERS);
  });
});

describe("filter counts", () => {
  it("counts only real filters, not sort or density", () => {
    expect(countActiveSessionFilters(DEFAULT_SESSION_FILTERS)).toBe(0);
    expect(
      countActiveSessionFilters({ ...DEFAULT_SESSION_FILTERS, telemetry: "notes", duration: "long", density: "compact" }),
    ).toBe(2);
  });

  it("describes active chips", () => {
    const chips = activeFilterChips({ ...DEFAULT_SESSION_FILTERS, telemetry: "notes", duration: "quick" });
    expect(chips.map((chip) => chip.labelKey)).toEqual([
      "activitySessions.filterWithNotes",
      "activityInsights.sessionBucket.quick",
    ]);
  });
});
