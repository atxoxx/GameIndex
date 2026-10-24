import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LibraryResumeStrip from "./LibraryResumeStrip";
import type { Game } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        "gameCard.continuePlaying": "Continue playing",
        "library.hero.jumpBackIn": "Jump Back In",
        "lib.rail.continue.subtitle": "Pick up where you left off",
        "library.hero.lastPlayed": "Last played {time}",
        "library.hero.resumePlaying": "Resume",
        "library.running": "Running",
        "game.play": "Play",
        "game.playAria": "Play {name}",
        "game.resumeAria": "Resume {name}",
        "lib.rail.continue.hoursAgo": "{n}h ago",
        "lib.rail.continue.daysAgo": "{n}d ago",
        "lib.rail.continue.weeksAgo": "{n}w ago",
        "lib.rail.continue.justNow": "Just now",
        "lib.rail.continue.underHourAgo": "<1h ago",
        "lib.rail.continue.never": "Never played",
      };
      if (key === "game.playAria") return `Play ${vars?.name}`;
      if (key === "game.resumeAria") return `Resume ${vars?.name}`;
      if (key === "library.hero.lastPlayed") return `Last played ${vars?.time}`;
      if (key === "lib.rail.continue.hoursAgo") return `${vars?.n}h ago`;
      return dict[key] ?? key;
    },
  }),
}));

vi.mock("../../hooks/useGameBackdropArt", () => ({
  useGameBackdropArt: () => ({ staticUrl: null, animatedUrl: null }),
}));

const HOUR = 60 * 60 * 1000;

const game = (id: string, lastPlayedHoursAgo: number): Game =>
  ({
    id,
    name: id,
    platform: "Steam",
    playTime: "10h",
    lastPlayed: Date.now() - lastPlayedHoursAgo * HOUR,
  }) as unknown as Game;

afterEach(cleanup);

describe("LibraryResumeStrip", () => {
  it("shows recently played games, most recent first", () => {
    render(
      <LibraryResumeStrip
        games={[game("Older", 20), game("Newest", 1), game("Middle", 6)]}
        onOpen={vi.fn()}
        onLaunch={vi.fn()}
      />
    );

    const names = screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent);
    expect(screen.getByText("Jump Back In")).toBeInTheDocument();
    expect(names).toEqual(["Newest", "Middle", "Older"]);
  });

  it("drops games played outside the window", () => {
    render(
      <LibraryResumeStrip
        games={[game("Fresh", 2), game("Stale", 24 * 90)]}
        onOpen={vi.fn()}
        onLaunch={vi.fn()}
      />
    );

    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("marks a running game and resumes it without opening details", () => {
    const onOpen = vi.fn();
    const onLaunch = vi.fn();
    const running = game("Hades II", 1);

    render(
      <LibraryResumeStrip
        games={[running]}
        runningIds={[running.id]}
        onOpen={onOpen}
        onLaunch={onLaunch}
      />
    );

    const resume = screen.getByRole("button", { name: "Resume Hades II" });
    expect(resume).toHaveTextContent("Running");

    fireEvent.click(resume);
    expect(onLaunch).toHaveBeenCalledWith(running);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders nothing when no session falls inside the window", () => {
    const { container } = render(
      <LibraryResumeStrip games={[game("Ancient", 24 * 400)]} onOpen={vi.fn()} onLaunch={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
