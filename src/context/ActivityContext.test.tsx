import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ActivityProvider, useActivity } from "./ActivityContext";
import type { Game } from "../types/game";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

const { gamesHolder } = vi.hoisted(() => ({
  gamesHolder: { current: [] as import("../types/game").Game[] },
}));

vi.mock("./GameContext", () => ({
  useGames: () => ({ games: gamesHolder.current }),
}));

const mockedInvoke = vi.mocked(invoke);

// ─── Fixture builders ─────────────────────────────────────────────────────────

/** Stable past timestamp so daily/weekly buckets are empty and deterministic. */
const BASE_TS = 1_700_000_000_000;
const DAY_MS = 86_400_000;

interface SessionRecord {
  id: number;
  gameId: string;
  gameName: string;
  startedAt: number;
  endedAt?: number | null;
  elapsedSeconds?: number | null;
  avgFps?: number | null;
  avgCpu?: number | null;
  avgGpu?: number | null;
  avgRam?: number | null;
  metricsJson?: string | null;
}

function makeRec(
  id: number,
  gameId: string,
  gameName: string,
  minutes: number,
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    id,
    gameId,
    gameName,
    startedAt: BASE_TS - minutes * 60_000,
    endedAt: BASE_TS,
    elapsedSeconds: minutes * 60,
    avgFps: null,
    avgCpu: null,
    avgGpu: null,
    avgRam: null,
    metricsJson: null,
    ...overrides,
  };
}

function makeGame(
  id: string,
  name: string,
  platform: string,
  genres: string[],
): Game {
  return {
    id,
    name,
    path: `C:/games/${id}.exe`,
    platform,
    installed: true,
    playTime: "0h",
    addedAt: 1,
    genres,
  };
}

let sessionRecords: SessionRecord[] = [];

function installInvokeMock() {
  mockedInvoke.mockImplementation((command: string) => {
    switch (command) {
      case "get_sessions":
        return Promise.resolve(sessionRecords);
      case "detect_gpus":
        return Promise.resolve([]);
      case "get_system_ram_gb":
        return Promise.resolve(16);
      case "load_sessions":
        return Promise.resolve("[]");
      default:
        return Promise.resolve(null);
    }
  });
}

const activityRef: { current: ReturnType<typeof useActivity> | null } = {
  current: null,
};

function Probe() {
  activityRef.current = useActivity();
  return <span data-testid="sessions">{activityRef.current.sessions.length}</span>;
}

async function renderActivity() {
  render(
    <ActivityProvider>
      <Probe />
    </ActivityProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ActivityProvider aggregation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Force `deferToIdle` down its setTimeout path so advancing the fake
    // clock hydrates sessions deterministically.
    (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback =
      undefined;
    localStorage.clear();
    sessionRecords = [];
    gamesHolder.current = [];
    activityRef.current = null;
    mockedInvoke.mockReset();
    installInvokeMock();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("computes totals, per-game playtime and most-played ordering", async () => {
    gamesHolder.current = [
      makeGame("g1", "Alpha", "Steam", ["Action", "RPG"]),
      makeGame("g2", "Beta", "GOG", ["Action"]),
      makeGame("g3", "Gamma", "Local", ["Puzzle"]),
    ];
    sessionRecords = [
      makeRec(1, "g1", "Alpha", 60, { avgFps: 60, avgCpu: 40, avgGpu: 50 }),
      makeRec(2, "g1", "Alpha", 30),
      makeRec(3, "g2", "Beta", 10, { avgFps: 30, avgCpu: 20, avgGpu: 10 }),
      makeRec(4, "g3", "Gamma", 120),
    ];

    await renderActivity();
    const stats = activityRef.current!.getAllStats();

    expect(stats.totalSessions).toBe(4);
    expect(stats.totalPlayTimeMin).toBe(220);
    expect(stats.avgSessionMin).toBe(55);
    expect(stats.mostPlayedGame).toBe("Gamma");
    expect(stats.mostPlayedGameTimeMin).toBe(120);
    expect(stats.longestSessionMin).toBe(120);
    expect(stats.avgFpsAll).toBe(45);
    expect(stats.avgGpuAll).toBe(30);
    expect(stats.avgCpuAll).toBe(30);

    expect(stats.topGames).toEqual([
      { gameId: "g3", gameName: "Gamma", minutes: 120, sessions: 1 },
      { gameId: "g1", gameName: "Alpha", minutes: 90, sessions: 2 },
      { gameId: "g2", gameName: "Beta", minutes: 10, sessions: 1 },
    ]);
    expect(stats.genreBreakdown).toEqual([
      { genre: "Puzzle", minutes: 120 },
      { genre: "Action", minutes: 100 },
      { genre: "RPG", minutes: 90 },
    ]);
    expect(stats.platformBreakdown).toEqual([
      { platform: "Local", minutes: 120 },
      { platform: "Steam", minutes: 90 },
      { platform: "GOG", minutes: 10 },
    ]);
    expect(stats.dailyAvg).toHaveLength(7);
    expect(stats.dailyLabels).toHaveLength(7);
    expect(stats.weeklyAvg).toHaveLength(4);
    expect(stats.weeklyLabels).toHaveLength(4);
    // Fixture dates sit far in the past, so every bucket is empty.
    expect(stats.dailyAvg).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(stats.weeklyAvg).toEqual([0, 0, 0, 0]);
  });

  it("returns the documented defaults for empty history", async () => {
    gamesHolder.current = [makeGame("g1", "Alpha", "Steam", ["Action"])];
    sessionRecords = [];

    await renderActivity();
    const stats = activityRef.current!.getAllStats();

    expect(stats.totalSessions).toBe(0);
    expect(stats.totalPlayTimeMin).toBe(0);
    expect(stats.avgSessionMin).toBe(0);
    expect(stats.mostPlayedGame).toBe("-");
    expect(stats.mostPlayedGameTimeMin).toBe(0);
    expect(stats.dailyAvg).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(stats.weeklyAvg).toEqual([]);
    expect(stats.weeklyLabels).toEqual([]);
    expect(stats.genreBreakdown).toEqual([]);
    expect(stats.platformBreakdown).toEqual([]);
    expect(stats.topGames).toEqual([]);
    expect(stats.longestSessionMin).toBe(0);
    expect(stats.avgFpsAll).toBe(0);
    // A single-game query over empty history uses the same early return.
    expect(activityRef.current!.getGameStats("g1").totalSessions).toBe(0);
  });

  it("degrades to an empty history when the sessions read fails (error path)", async () => {
    gamesHolder.current = [makeGame("g1", "Alpha", "Steam", ["Action"])];
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "get_sessions") return Promise.reject(new Error("db locked"));
      if (command === "detect_gpus") return Promise.resolve([]);
      if (command === "get_system_ram_gb") return Promise.resolve(16);
      if (command === "load_sessions") return Promise.resolve("[]");
      return Promise.resolve(null);
    });

    await renderActivity();

    expect(activityRef.current!.sessions).toEqual([]);
    expect(activityRef.current!.getAllStats().totalSessions).toBe(0);
  });

  it("lazy-loads session samples into the matching session (happy path)", async () => {
    gamesHolder.current = [makeGame("g1", "Alpha", "Steam", [])];
    sessionRecords = [
      makeRec(1, "g1", "Alpha", 60, {
        metricsJson: JSON.stringify({
          avgFps: 60,
          avgCpuUsage: 40,
          avgGpuUsage: 50,
          avgRamUsage: 30,
          avgCpuTemp: 50,
          avgGpuTemp: 60,
          minFps: 40,
          maxFps: 90,
          resolution: "1080p",
        }),
      }),
    ];
    mockedInvoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "get_sessions") return Promise.resolve(sessionRecords);
      if (command === "get_session_samples") {
        const ids = (args as { ids: number[] }).ids;
        return Promise.resolve(
          ids.map((id) => ({
            id,
            samples: [
              { t: 0, cpu: 10, gpu: 20, ram: 30, cpuTemp: 40, gpuTemp: 50, fps: 60 },
            ],
          })),
        );
      }
      if (command === "detect_gpus") return Promise.resolve([]);
      if (command === "get_system_ram_gb") return Promise.resolve(16);
      if (command === "load_sessions") return Promise.resolve("[]");
      return Promise.resolve(null);
    });

    await renderActivity();
    // The history list ships summaries only — no samples before hydration.
    expect(activityRef.current!.sessions[0].metrics?.samples).toBeUndefined();

    await act(async () => {
      await activityRef.current!.ensureSamplesFor(["1"]);
    });

    const samples = activityRef.current!.sessions[0].metrics?.samples;
    expect(samples).toHaveLength(1);
    expect(samples?.[0].cpu).toBe(10);
  });

  it("keeps the session when the samples fetch fails and retries later (error path)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    gamesHolder.current = [makeGame("g1", "Alpha", "Steam", [])];
    sessionRecords = [
      makeRec(1, "g1", "Alpha", 60, {
        metricsJson: JSON.stringify({
          avgFps: 60,
          avgCpuUsage: 40,
          avgGpuUsage: 50,
          avgRamUsage: 30,
          avgCpuTemp: 50,
          avgGpuTemp: 60,
          minFps: 40,
          maxFps: 90,
          resolution: "1080p",
        }),
      }),
    ];
    let calls = 0;
    mockedInvoke.mockImplementation((command: string) => {
      if (command === "get_sessions") return Promise.resolve(sessionRecords);
      if (command === "get_session_samples") {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("backend down"))
          : Promise.resolve([
              {
                id: 1,
                samples: [
                  { t: 0, cpu: 10, gpu: 20, ram: 30, cpuTemp: 40, gpuTemp: 50, fps: 60 },
                ],
              },
            ]);
      }
      if (command === "detect_gpus") return Promise.resolve([]);
      if (command === "get_system_ram_gb") return Promise.resolve(16);
      if (command === "load_sessions") return Promise.resolve("[]");
      return Promise.resolve(null);
    });

    await renderActivity();
    await act(async () => {
      await activityRef.current!.ensureSamplesFor(["1"]);
    });
    // A failed fetch leaves the summary intact and is not marked hydrated.
    expect(activityRef.current!.sessions).toHaveLength(1);
    expect(activityRef.current!.sessions[0].metrics?.samples).toBeUndefined();

    await act(async () => {
      await activityRef.current!.ensureSamplesFor(["1"]);
    });
    expect(activityRef.current!.sessions[0].metrics?.samples).toHaveLength(1);

    errorSpy.mockRestore();
  });

  it("excludes an in-progress row (null ended_at / null elapsed) and sub-minute rows", async () => {
    gamesHolder.current = [makeGame("g1", "Alpha", "Steam", ["Action"])];
    sessionRecords = [
      makeRec(1, "g1", "Alpha", 60),
      makeRec(2, "g1", "Alpha", 0, { endedAt: null, elapsedSeconds: null }),
      makeRec(3, "g1", "Alpha", 0),
    ];

    await renderActivity();
    const stats = activityRef.current!.getAllStats();

    expect(activityRef.current!.sessions).toHaveLength(1);
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalPlayTimeMin).toBe(60);
  });

  it("counts a null ended_at row once a finalized elapsed is present (mapping ignores ended_at)", async () => {
    gamesHolder.current = [makeGame("g1", "Alpha", "Steam", ["Action"])];
    sessionRecords = [makeRec(1, "g1", "Alpha", 90, { endedAt: null })];

    await renderActivity();
    const stats = activityRef.current!.getAllStats();

    expect(activityRef.current!.sessions).toHaveLength(1);
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalPlayTimeMin).toBe(90);
  });

  it("keeps two games that share a name as separate most-played/top entries", async () => {
    gamesHolder.current = [
      makeGame("g1", "Same", "Steam", ["Action"]),
      makeGame("g2", "Same", "GOG", ["RPG"]),
    ];
    sessionRecords = [
      makeRec(1, "g1", "Same", 30),
      makeRec(2, "g2", "Same", 50),
    ];

    await renderActivity();
    const stats = activityRef.current!.getAllStats();

    // Playtime is not lost or double-counted — only the ranking is per entry.
    expect(stats.totalPlayTimeMin).toBe(80);
    expect(stats.mostPlayedGame).toBe("Same");
    // "Same" is two library entries: the largest single entry is 50, not 80.
    expect(stats.mostPlayedGameTimeMin).toBe(50);
    expect(stats.topGames).toEqual([
      { gameId: "g2", gameName: "Same", minutes: 50, sessions: 1 },
      { gameId: "g1", gameName: "Same", minutes: 30, sessions: 1 },
    ]);
    expect(stats.genreBreakdown).toEqual([
      { genre: "RPG", minutes: 50 },
      { genre: "Action", minutes: 30 },
    ]);
    expect(stats.platformBreakdown).toEqual([
      { platform: "GOG", minutes: 50 },
      { platform: "Steam", minutes: 30 },
    ]);

    const perGame = activityRef.current!.getGameStats("g2");
    expect(perGame.totalPlayTimeMin).toBe(50);
    expect(perGame.genreBreakdown).toEqual([{ genre: "RPG", minutes: 50 }]);
  });

  it("resolves a same-name entry's gameId to its own game, not the first name match", async () => {
    // g1 sits first in the library but has less playtime; a name-based lookup
    // would always resolve the group to g1. The top row must be g2 instead.
    gamesHolder.current = [
      makeGame("g1", "Same", "Steam", ["Action"]),
      makeGame("g2", "Same", "GOG", ["RPG"]),
    ];
    sessionRecords = [
      makeRec(1, "g1", "Same", 20),
      makeRec(2, "g2", "Same", 70),
    ];

    await renderActivity();
    const stats = activityRef.current!.getAllStats();

    expect(stats.topGames.map((g) => g.gameId)).toEqual(["g2", "g1"]);
    expect(stats.topGames[0]).toEqual({
      gameId: "g2",
      gameName: "Same",
      minutes: 70,
      sessions: 1,
    });
  });

  it("re-derives getGameSessions/getGameStats after sessions change", async () => {
    gamesHolder.current = [
      makeGame("g1", "Alpha", "Steam", ["Action", "RPG"]),
      makeGame("g2", "Beta", "GOG", ["Action"]),
    ];
    sessionRecords = [
      makeRec(1, "g1", "Alpha", 60),
      makeRec(2, "g1", "Alpha", 30),
      makeRec(3, "g2", "Beta", 10),
    ];

    await renderActivity();

    const alphaSessions = activityRef.current!.getGameSessions("g1");
    expect(alphaSessions.map((s) => s.id)).toEqual(["1", "2"]);
    expect(alphaSessions.every((s) => s.gameId === "g1")).toBe(true);
    expect(activityRef.current!.getGameSessions("g1")).toEqual(alphaSessions);
    expect(activityRef.current!.getGameSessions("g2")).toHaveLength(1);
    expect(activityRef.current!.getGameStats("g1").totalPlayTimeMin).toBe(90);
    expect(activityRef.current!.getAllStats().totalPlayTimeMin).toBe(100);

    sessionRecords = [makeRec(9, "g1", "Alpha", 45)];
    await act(async () => {
      await activityRef.current!.recordSession();
    });
    await flush();

    expect(activityRef.current!.getGameSessions("g1")).toHaveLength(1);
    expect(activityRef.current!.getGameSessions("g1")[0].id).toBe("9");
    expect(activityRef.current!.getGameStats("g1").totalPlayTimeMin).toBe(45);
    expect(activityRef.current!.getAllStats().totalSessions).toBe(1);
  });

  it("scales a small fixture to a few hundred sessions without changing the aggregate contract", async () => {
    gamesHolder.current = [
      makeGame("g1", "Alpha", "Steam", ["Action", "RPG"]),
      makeGame("g2", "Beta", "GOG", ["Action"]),
      makeGame("g3", "Gamma", "Local", ["Puzzle"]),
    ];

    const base = Date.now() - 3 * DAY_MS;
    const dateFor = (id: number) => base - (id % 5) * DAY_MS;
    const specs = [
      { id: 1, g: "g1", name: "Alpha", minutes: 60, metrics: { fps: 60, cpu: 40, gpu: 50 } },
      { id: 2, g: "g1", name: "Alpha", minutes: 30 },
      { id: 3, g: "g2", name: "Beta", minutes: 10, metrics: { fps: 30, cpu: 20, gpu: 10 } },
      { id: 4, g: "g3", name: "Gamma", minutes: 120 },
      { id: 5, g: "g2", name: "Beta", minutes: 45 },
      { id: 6, g: "g3", name: "Gamma", minutes: 15 },
    ];

    const buildRecords = (repeat: number): SessionRecord[] => {
      const out: SessionRecord[] = [];
      let id = 1;
      for (let k = 0; k < repeat; k++) {
        for (const s of specs) {
          out.push(
            makeRec(id++, s.g, s.name, s.minutes, {
              startedAt: dateFor(s.id),
              endedAt: dateFor(s.id),
              ...(s.metrics
                ? { avgFps: s.metrics.fps, avgCpu: s.metrics.cpu, avgGpu: s.metrics.gpu }
                : {}),
            }),
          );
        }
      }
      return out;
    };

    sessionRecords = buildRecords(1);
    await renderActivity();
    const small = activityRef.current!.getAllStats();

    const K = 50;
    sessionRecords = buildRecords(K);
    await act(async () => {
      await activityRef.current!.recordSession();
    });
    await flush();
    const large = activityRef.current!.getAllStats();

    expect(large.totalSessions).toBe(small.totalSessions * K);
    expect(large.totalPlayTimeMin).toBe(small.totalPlayTimeMin * K);
    expect(large.avgSessionMin).toBe(small.avgSessionMin);
    expect(large.mostPlayedGame).toBe(small.mostPlayedGame);
    expect(large.mostPlayedGameTimeMin).toBe(small.mostPlayedGameTimeMin * K);
    expect(large.longestSessionMin).toBe(small.longestSessionMin);
    expect(large.dailyAvg).toEqual(small.dailyAvg.map((v) => v * K));
    expect(large.weeklyAvg).toEqual(small.weeklyAvg.map((v) => v * K));
    expect(large.genreBreakdown).toEqual(
      small.genreBreakdown.map((g) => ({ ...g, minutes: g.minutes * K })),
    );
    expect(large.platformBreakdown).toEqual(
      small.platformBreakdown.map((p) => ({ ...p, minutes: p.minutes * K })),
    );
    expect(large.topGames).toEqual(
      small.topGames.map((t) => ({
        ...t,
        minutes: t.minutes * K,
        sessions: t.sessions * K,
      })),
    );
    expect(large.avgFpsAll).toBe(small.avgFpsAll);
    expect(large.avgGpuAll).toBe(small.avgGpuAll);
    expect(large.avgCpuAll).toBe(small.avgCpuAll);
  });
});
