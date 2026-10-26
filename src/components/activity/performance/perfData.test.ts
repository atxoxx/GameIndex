import { describe, it, expect } from "vitest";
import { buildTimelineBundle, type TimelineI18n } from "./perfData";
import type { GameSession, SessionMetrics } from "../../../types/game";

const i18n: TimelineI18n = {
  cpuUsage: "CPU",
  gpuUsage: "GPU",
  cpuTemp: "CPU temp",
  gpuTemp: "GPU temp",
  ramUsage: "RAM",
  fps: "FPS",
};

function metrics(patch: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    avgFps: 0,
    avgCpuUsage: 0,
    avgGpuUsage: 0,
    avgRamUsage: 0,
    avgCpuTemp: 0,
    avgGpuTemp: 0,
    minFps: 0,
    maxFps: 0,
    resolution: "1920x1080",
    ...patch,
  };
}

function session(id: string, patch: Partial<SessionMetrics> = {}): GameSession {
  return {
    id,
    gameId: "g1",
    gameName: "Test Game",
    date: "2026-05-01T10:00:00.000Z",
    durationMin: 30,
    metrics: metrics(patch),
  };
}

describe("buildTimelineBundle", () => {
  it("keeps the curves that were captured and drops the missing ones", () => {
    const bundle = buildTimelineBundle({
      sessions: [session("s1", { avgFps: 60, avgCpuUsage: 40, avgRamUsage: 55, avgCpuTemp: 70 })],
      gameAverages: [],
      gameId: "all",
      sessionId: null,
      i18n,
    });

    expect(bundle).not.toBeNull();
    expect(bundle!.cpuGpu.map((s) => s.label)).toEqual(["CPU"]);
    expect(bundle!.temps.map((s) => s.label)).toEqual(["CPU temp"]);
    expect(bundle!.ram.map((s) => s.label)).toEqual(["RAM"]);
    expect(bundle!.fps.map((s) => s.label)).toEqual(["FPS"]);
  });

  it("still exposes zeroed sparkline slots for the missing metrics", () => {
    const bundle = buildTimelineBundle({
      sessions: [session("s1", { avgFps: 60, avgCpuTemp: 70 })],
      gameAverages: [],
      gameId: "all",
      sessionId: null,
      i18n,
    });

    expect(bundle!.sparklines.gpuTemp).toHaveLength(45);
    expect(bundle!.sparklines.gpuTemp.every((p) => p.y === 0)).toBe(true);
    expect(bundle!.readouts.gpuTemp).toEqual({ max: 0, min: 0 });
  });

  it("returns null when the selected game is not in the supplied averages", () => {
    expect(
      buildTimelineBundle({
        sessions: [session("s1", { avgFps: 60 })],
        gameAverages: [],
        gameId: "missing-game",
        sessionId: null,
        i18n,
      })
    ).toBeNull();
  });
});
