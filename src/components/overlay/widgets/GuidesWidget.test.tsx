import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GuidesWidget from "./GuidesWidget";
import { invoke } from "@tauri-apps/api/core";
import { useOverlay } from "../../../context/OverlayContext";
import { useOptionalGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useGameMaps } from "../../../hooks/useGameMaps";
import type { MapSourceResult } from "../../../types/game";

vi.mock("../../../context/OverlayContext", () => ({ useOverlay: vi.fn() }));
vi.mock("../../../context/GameContext", () => ({ useOptionalGames: vi.fn() }));
vi.mock("../../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));
vi.mock("../../../hooks/useGameMaps", () => ({ useGameMaps: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const mockOverlay = vi.mocked(useOverlay);
const mockOptionalGames = vi.mocked(useOptionalGames);
const mockLanguage = vi.mocked(useLanguage);
const mockGameMaps = vi.mocked(useGameMaps);
const invokeMock = vi.mocked(invoke);

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

const mapSources: MapSourceResult[] = [
  {
    id: "mapgenie",
    label: "MapGenie",
    title: "Hollow Knight",
    url: "https://mapgenie.io/hollow-knight",
    maps: [
      { title: "Hollow Knight Map", url: "https://mapgenie.io/hollow-knight" },
      { title: "Godhome Map", url: "https://mapgenie.io/hollow-knight/godhome" },
    ],
  },
];

function renderRunningGame(overrides: Record<string, unknown> = {}) {
  mockOverlay.mockReturnValue({
    session: { gameId: "g1", startedAt: Date.now(), pid: 100 },
  } as any);
  mockOptionalGames.mockReturnValue({
    games: [game(overrides)],
    runningGameIds: ["g1"],
  } as any);
  render(<GuidesWidget />);
}

describe("GuidesWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage.mockReturnValue({
      t: (key: string) => key,
    } as unknown as ReturnType<typeof useLanguage>);
    mockGameMaps.mockReturnValue({ status: "ready", sources: [] });
  });

  it("prompts to start a game when none is running", () => {
    mockOverlay.mockReturnValue({ session: null } as any);
    mockOptionalGames.mockReturnValue({ games: [], runningGameIds: [] } as any);

    render(<GuidesWidget />);

    expect(screen.getByTestId("overlay-guides")).toBeInTheDocument();
    expect(screen.getByText("overlay.guides.empty")).toBeInTheDocument();
  });

  it("offers every registered WebLinks source in the always-visible dropdown", () => {
    renderRunningGame({
      websites: ["https://hollowknight.fandom.com/wiki/Hollow_Knight_Wiki"],
    });

    expect(screen.getByTestId("overlay-guides-select")).toBeInTheDocument();

    // Every fixed WebLinks source is offered, not just the old curated subset.
    for (const label of [
      "Steam",
      "SteamDB",
      "IsThereAnyDeal",
      "GOG",
      "Epic Games",
      "PCGamingWiki",
      "HowLongToBeat",
      "Metacritic",
      "YouTube",
      "Twitch",
      "Reddit",
      "NexusMods",
      "ModDB",
      "SteamGridDB",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }

    // Links registered in the game's WebLinks "My Links" list show up too.
    expect(screen.getByRole("option", { name: "Fandom" })).toBeInTheDocument();
  });

  it("keeps the dropdown visible while a page is open", () => {
    renderRunningGame();

    const select = screen.getByTestId<HTMLSelectElement>("overlay-guides-select");
    const option = screen.getByRole<HTMLOptionElement>("option", { name: "PCGamingWiki" });
    fireEvent.change(select, { target: { value: option.value } });

    expect(screen.getByTestId("overlay-guides-select")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith(
      "create_preview_webview",
      expect.objectContaining({ url: option.value })
    );
  });

  it("lists map provider maps in the Map tab and opens the chosen one", () => {
    mockGameMaps.mockReturnValue({ status: "ready", sources: mapSources });
    renderRunningGame();

    fireEvent.click(screen.getByTestId("overlay-guides-tab-maps"));

    const select = screen.getByTestId<HTMLSelectElement>("overlay-guides-select");
    const option = screen.getByRole<HTMLOptionElement>("option", { name: "Godhome Map" });
    fireEvent.change(select, { target: { value: option.value } });

    expect(invokeMock).toHaveBeenCalledWith(
      "create_preview_webview",
      expect.objectContaining({ url: "https://mapgenie.io/hollow-knight/godhome" })
    );
  });

  it("shows an empty state when no map provider has a map", () => {
    renderRunningGame();

    fireEvent.click(screen.getByTestId("overlay-guides-tab-maps"));

    expect(screen.getByText("overlay.guides.noMaps")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-guides-select")).toBeDisabled();
  });
});
