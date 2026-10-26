import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActivityRecapModal } from "./ActivityRecapModal";
import type { GameSession } from "../../types/game";
import type { ActivityRange } from "../../utils/activity/range";

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction: () => () => {} }),
}));

const sessions: GameSession[] = [
  {
    id: "s1",
    gameId: "g1",
    gameName: "Test Game",
    date: "2026-10-01T10:00:00.000Z",
    durationMin: 120,
  },
];

const range: ActivityRange = {
  key: "30d",
  startDate: "2026-09-27",
  endDate: "2026-10-26",
};

describe("ActivityRecapModal", () => {
  it("previews the period card inside a dialog", () => {
    render(
      <ActivityRecapModal
        open
        onClose={() => {}}
        sessions={sessions}
        games={[]}
        range={range}
        rangeLabel="27 Sep – 26 Oct 2026"
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("GameIndex").length).toBeGreaterThan(0);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <ActivityRecapModal
        open
        onClose={onClose}
        sessions={sessions}
        games={[]}
        range={range}
        rangeLabel="27 Sep – 26 Oct 2026"
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while closed", () => {
    render(
      <ActivityRecapModal
        open={false}
        onClose={() => {}}
        sessions={sessions}
        games={[]}
        range={range}
        rangeLabel="27 Sep – 26 Oct 2026"
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
