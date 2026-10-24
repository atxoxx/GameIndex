import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StatsHeader } from "./StatsHeader";
import type { GamerLevelInfo, GamerPersona, TimeframePreset } from "./statsTypes";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../utils/screenshot", () => ({
  captureAndSaveScreenshot: vi.fn().mockResolvedValue(null),
}));

const levelInfo: GamerLevelInfo = {
  level: 27,
  title: "Veteran",
  currentXp: 3400,
  xpForNextLevel: 5000,
  progressPct: 68,
  totalXp: 94000,
};

const persona: GamerPersona = {
  id: "night_owl",
  titleKey: "stats.persona.nightOwl.title",
  subtitleKey: "stats.persona.nightOwl.subtitle",
  badgeEmoji: "",
  traits: [],
};

describe("StatsHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("changes the timeframe and exports the report", () => {
    const onTimeframeChange = vi.fn();
    const onExportJson = vi.fn();

    render(
      <StatsHeader
        levelInfo={levelInfo}
        persona={persona}
        streak={{ current: 6, longest: 12, playedToday: true }}
        totalPlaytimeMin={12840}
        totalSessions={214}
        totalGames={86}
        timeframe={"all" as TimeframePreset}
        onTimeframeChange={onTimeframeChange}
        onExportJson={onExportJson}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    expect(onTimeframeChange).toHaveBeenCalledWith("30d");

    fireEvent.click(screen.getByRole("button", { name: /JSON/ }));
    expect(onExportJson).toHaveBeenCalledTimes(1);
  });
});
