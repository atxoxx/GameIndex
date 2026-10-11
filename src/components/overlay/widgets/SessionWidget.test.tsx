import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SessionWidget, { formatClock } from "./SessionWidget";
import { useOverlay } from "../../../context/OverlayContext";
import { useGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import type { Game } from "../../../types/game";

vi.mock("../../../context/OverlayContext", () => ({ useOverlay: vi.fn() }));
vi.mock("../../../context/GameContext", () => ({ useGames: vi.fn() }));
vi.mock("../../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

const mockOverlay = vi.mocked(useOverlay);
const mockGames = vi.mocked(useGames);
const mockLanguage = vi.mocked(useLanguage);

const testGame: Game = {
  id: "game-1",
  name: "Cyberpunk 2077",
  path: "C:\\Games\\Cyberpunk2077\\bin\\x64\\Cyberpunk2077.exe",
  platform: "Steam",
  installed: true,
  playTime: "2h 30m",
  addedAt: 123456789,
  steamAppId: 1091500,
  logoUrl: "https://example.com/cyberpunk-logo.png",
  bannerUrl: "https://example.com/cyberpunk-banner.jpg",
  coverArtUrl: "https://example.com/cyberpunk-cover.jpg",
  developer: "CD Projekt Red",
  genres: ["RPG", "Action"],
};

describe("formatClock helper", () => {
  it("formats seconds under one hour as mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(599)).toBe("09:59");
  });

  it("formats seconds over one hour as h:mm:ss", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3665)).toBe("1:01:05");
    expect(formatClock(7322)).toBe("2:02:02");
  });

  it("handles negative numbers safely", () => {
    expect(formatClock(-10)).toBe("00:00");
  });
});

describe("SessionWidget", () => {
  const captureScreenshotMock = vi.fn().mockResolvedValue("shot.png");
  const openScreenshotsFolderMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage.mockReturnValue({
      t: (k: string) => k,
    } as unknown as ReturnType<typeof useLanguage>);
  });

  it("renders empty state when there is no active session or game", () => {
    mockOverlay.mockReturnValue({
      session: null,
      metrics: null,
      captureScreenshot: captureScreenshotMock,
      isCapturing: false,
      openScreenshotsFolder: openScreenshotsFolderMock,
    } as unknown as ReturnType<typeof useOverlay>);

    mockGames.mockReturnValue({
      games: [],
      runningGameIds: [],
    } as unknown as ReturnType<typeof useGames>);

    render(<SessionWidget />);

    expect(screen.getByTestId("overlay-session-empty")).toBeInTheDocument();
    expect(screen.getByText("overlay.noSession")).toBeInTheDocument();
    expect(screen.getByText("overlay.session.noGameDesc")).toBeInTheDocument();
  });

  it("renders active game session with hero banner, logo, and KPIs", () => {
    const startedAt = Date.now() - 120_000; // 2 minutes ago
    mockOverlay.mockReturnValue({
      session: {
        gameId: "game-1",
        startedAt,
        pid: 4321,
      },
      metrics: {
        fps: 144,
        cpu: 25,
        gpu: 60,
      },
      captureScreenshot: captureScreenshotMock,
      isCapturing: false,
      openScreenshotsFolder: openScreenshotsFolderMock,
    } as unknown as ReturnType<typeof useOverlay>);

    mockGames.mockReturnValue({
      games: [testGame],
      runningGameIds: ["game-1"],
    } as unknown as ReturnType<typeof useGames>);

    render(<SessionWidget />);

    expect(screen.getByTestId("overlay-session-widget")).toBeInTheDocument();
    expect(screen.getByAltText("Cyberpunk 2077")).toHaveAttribute(
      "src",
      "https://example.com/cyberpunk-logo.png",
    );
    expect(screen.getByText("Steam")).toBeInTheDocument();
    expect(screen.getByText("PID 4321")).toBeInTheDocument();
    expect(screen.getByText("144 FPS")).toBeInTheDocument();
    expect(screen.getByText("CD Projekt Red")).toBeInTheDocument();
    expect(screen.getByText(/RPG, Action/)).toBeInTheDocument();
  });

  it("falls back to game title when logo fails to load", () => {
    mockOverlay.mockReturnValue({
      session: {
        gameId: "game-1",
        startedAt: Date.now() - 30_000,
        pid: 4321,
      },
      metrics: null,
      captureScreenshot: captureScreenshotMock,
      isCapturing: false,
      openScreenshotsFolder: openScreenshotsFolderMock,
    } as unknown as ReturnType<typeof useOverlay>);

    mockGames.mockReturnValue({
      games: [testGame],
      runningGameIds: ["game-1"],
    } as unknown as ReturnType<typeof useGames>);

    render(<SessionWidget />);

    const logoImg = screen.getByAltText("Cyberpunk 2077");
    fireEvent.error(logoImg);

    expect(screen.getByRole("heading", { name: "Cyberpunk 2077" })).toBeInTheDocument();
  });

  it("triggers captureScreenshot when quick action button is clicked", () => {
    mockOverlay.mockReturnValue({
      session: {
        gameId: "game-1",
        startedAt: Date.now() - 10_000,
      },
      metrics: null,
      captureScreenshot: captureScreenshotMock,
      isCapturing: false,
      openScreenshotsFolder: openScreenshotsFolderMock,
    } as unknown as ReturnType<typeof useOverlay>);

    mockGames.mockReturnValue({
      games: [testGame],
      runningGameIds: ["game-1"],
    } as unknown as ReturnType<typeof useGames>);

    render(<SessionWidget />);

    const captureBtn = screen.getByText("overlay.session.takeScreenshot").closest("button");
    expect(captureBtn).not.toBeNull();
    fireEvent.click(captureBtn!);

    expect(captureScreenshotMock).toHaveBeenCalledWith("Cyberpunk 2077");
  });

  it("triggers openScreenshotsFolder when folder action button is clicked", () => {
    mockOverlay.mockReturnValue({
      session: {
        gameId: "game-1",
        startedAt: Date.now() - 10_000,
      },
      metrics: null,
      captureScreenshot: captureScreenshotMock,
      isCapturing: false,
      openScreenshotsFolder: openScreenshotsFolderMock,
    } as unknown as ReturnType<typeof useOverlay>);

    mockGames.mockReturnValue({
      games: [testGame],
      runningGameIds: ["game-1"],
    } as unknown as ReturnType<typeof useGames>);

    render(<SessionWidget />);

    const folderBtn = screen.getByText("overlay.session.openCaptures").closest("button");
    expect(folderBtn).not.toBeNull();
    fireEvent.click(folderBtn!);

    expect(openScreenshotsFolderMock).toHaveBeenCalled();
  });

  it("falls back to runningGameIds when session has no gameId", () => {
    mockOverlay.mockReturnValue({
      session: {
        gameId: "",
        startedAt: Date.now() - 5_000,
      },
      metrics: null,
      captureScreenshot: captureScreenshotMock,
      isCapturing: false,
      openScreenshotsFolder: openScreenshotsFolderMock,
    } as unknown as ReturnType<typeof useOverlay>);

    mockGames.mockReturnValue({
      games: [testGame],
      runningGameIds: ["game-1"],
    } as unknown as ReturnType<typeof useGames>);

    render(<SessionWidget />);

    expect(screen.getByTestId("overlay-session-widget")).toBeInTheDocument();
    expect(screen.getByAltText("Cyberpunk 2077")).toBeInTheDocument();
  });
});
