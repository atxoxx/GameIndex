import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GuidesWidget from "./GuidesWidget";
import { useOverlay } from "../../../context/OverlayContext";
import { useOptionalGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";

vi.mock("../../../context/OverlayContext", () => ({ useOverlay: vi.fn() }));
vi.mock("../../../context/GameContext", () => ({ useOptionalGames: vi.fn() }));
vi.mock("../../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));
vi.mock("../../../hooks/useGameMaps", () => ({
  useGameMaps: () => ({ status: "ready", sources: [] }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const mockOverlay = vi.mocked(useOverlay);
const mockOptionalGames = vi.mocked(useOptionalGames);
const mockLanguage = vi.mocked(useLanguage);

function game(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    name: "Hollow Knight",
    path: "C:/Games/HollowKnight/hollow_knight.exe",
    platform: "Steam",
    installed: true,
    playTime: "0h",
    addedAt: 0,
    ...overrides,
  } as any;
}

describe("GuidesWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage.mockReturnValue({
      t: (key: string) => key,
    } as unknown as ReturnType<typeof useLanguage>);
  });

  it("prompts to start a game when none is running", () => {
    mockOverlay.mockReturnValue({ session: null } as any);
    mockOptionalGames.mockReturnValue({ games: [], runningGameIds: [] } as any);

    render(<GuidesWidget />);

    expect(screen.getByTestId("overlay-guides")).toBeInTheDocument();
    expect(screen.getByText("overlay.guides.empty")).toBeInTheDocument();
  });

  it("lists wiki and guide links for the current game", () => {
    mockOverlay.mockReturnValue({
      session: { gameId: "g1", startedAt: Date.now(), pid: 100 },
    } as any);
    mockOptionalGames.mockReturnValue({
      games: [game()],
      runningGameIds: ["g1"],
    } as any);

    render(<GuidesWidget />);

    const grid = screen.getByTestId("overlay-guides-grid");
    expect(grid).toBeInTheDocument();
    // A fixed source and a search-based source are both offered.
    expect(screen.getByText("PCGamingWiki")).toBeInTheDocument();
    expect(screen.getByText("HowLongToBeat")).toBeInTheDocument();
  });
});
