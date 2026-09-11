import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimeToBeatCard from "./TimeToBeatCard";
import type { Game } from "../../types/game";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("../../context/BigScreenContext", () => ({
  useBigScreen: () => ({ isBigScreen: false }),
}));

vi.mock("../../hooks/useFocusable", () => ({
  useFocusable: (onActivate: () => void) => ({
    ref: () => {},
    tabIndex: 0,
    role: "option",
    onClick: onActivate,
    onKeyDown: () => {},
  }),
}));

vi.mock("./HltbDetailsModal", () => ({
  default: () => <div data-testid="hltb-modal">modal</div>,
  HltbDetailsContent: () => <div>content</div>,
}));

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    name: "Portal 2",
    platform: "PC",
    path: "",
    installed: true,
    playTime: "5h",
    addedAt: 1,
    timeToBeat: {
      normally: 8 * 3600,
      mainExtra: 11 * 3600,
      completely: 20 * 3600,
      allStyles: 13 * 3600,
      hltb: {
        gameId: 7270,
        gameName: "Portal 2",
        mainStory: { average: 8 * 3600, count: 12000 },
        mainExtra: { average: 11 * 3600, count: 6000 },
        completionist: { average: 20 * 3600, count: 2000 },
        allStyles: { average: 13 * 3600, count: 8000 },
      },
    },
    ...overrides,
  } as Game;
}

describe("TimeToBeatCard", () => {
  it("renders HLTB headline stats and opens the details modal", () => {
    render(<TimeToBeatCard game={makeGame()} />);

    expect(screen.getAllByText("gameInfo.mainStory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gameInfo.mainExtra").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gameInfo.completionist").length).toBeGreaterThan(0);
    expect(screen.getAllByText("hltb.allStyles").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gameInfo.hltbTitle").length).toBeGreaterThan(0);
    expect(screen.getAllByText("8h").length).toBeGreaterThan(0);

    const detailsButton = screen.getByRole("button", { name: /common.details/ });
    fireEvent.click(detailsButton);
    expect(screen.getByTestId("hltb-modal")).toBeTruthy();
  });

  it("renders legacy data without a details button", () => {
    render(
      <TimeToBeatCard
        game={makeGame({ timeToBeat: { normally: 8 * 3600, completely: 20 * 3600 } })}
      />
    );
    expect(screen.getByText("game.timeToBeatTitle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /common.details/ })).toBeNull();
  });

  it("renders nothing when no time-to-beat data exists", () => {
    const { container } = render(
      <TimeToBeatCard game={makeGame({ timeToBeat: undefined })} />
    );
    expect(container.firstChild).toBeNull();
  });
});
