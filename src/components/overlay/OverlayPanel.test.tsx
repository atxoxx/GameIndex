import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import OverlayPanel from "./OverlayPanel";
import {
  useOverlay,
  type OverlayContextValue,
} from "../../context/OverlayContext";
import { useLanguage } from "../../context/LanguageContext";
import { useOptionalGames } from "../../context/GameContext";
import { baseOverlaySettings, makeOverlayValue } from "./overlayTestValue";

vi.mock("../../context/OverlayContext", () => ({ useOverlay: vi.fn() }));
vi.mock("../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));
vi.mock("../../context/GameContext", () => ({ useOptionalGames: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

// Stub each widget so the panel's tab switching can be asserted without
// dragging the whole overlay provider tree in.
vi.mock("./widgets/SessionWidget", () => ({
  default: () => <div data-testid="widget-session" />,
}));
vi.mock("./widgets/PerformanceWidget", () => ({
  default: () => <div data-testid="widget-performance" />,
}));
vi.mock("./widgets/AchievementsWidget", () => ({
  default: () => <div data-testid="widget-achievements" />,
}));
vi.mock("./widgets/DownloadsWidget", () => ({
  default: () => <div data-testid="widget-downloads" />,
}));
vi.mock("./widgets/NotificationsWidget", () => ({
  default: () => <div data-testid="widget-notifications" />,
}));
vi.mock("./widgets/NotesWidget", () => ({
  default: () => <div data-testid="widget-notes" />,
}));
vi.mock("./widgets/ScreenshotsWidget", () => ({
  default: () => <div data-testid="widget-captures" />,
}));
vi.mock("./widgets/TimerWidget", () => ({
  default: () => <div data-testid="widget-timer" />,
}));
vi.mock("./widgets/SettingsWidget", () => ({
  default: () => <div data-testid="widget-settings" />,
}));

const mockOverlay = vi.mocked(useOverlay);
const mockLanguage = vi.mocked(useLanguage);
const mockOptionalGames = vi.mocked(useOptionalGames);

function overlayValue(panelWidgets: string[]): OverlayContextValue {
  return makeOverlayValue({
    settings: {
      ...baseOverlaySettings,
      tickerWidgets: ["fps"],
      panelWidgets,
    },
  });
}

const ALL_WIDGETS = [
  "session",
  "performance",
  "achievements",
  "downloads",
  "notifications",
  "notes",
  "captures",
  "timer",
  "settings",
];

describe("OverlayPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOptionalGames.mockReturnValue({
      games: [],
      runningGameIds: [],
    } as any);
    mockLanguage.mockReturnValue({
      t: (key: string) => key,
    } as unknown as ReturnType<typeof useLanguage>);
  });

  it("defaults to the first enabled tab and shows only its content", async () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    expect(screen.getByTestId("overlay-panel-tab-session")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("widget-session")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-performance")).toBeNull();
    expect(screen.queryByTestId("widget-achievements")).toBeNull();
  });

  it("switches the visible widgets when another tab is clicked", async () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-performance"));

    expect(
      screen.getByTestId("overlay-panel-tab-performance"),
    ).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("widget-performance")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-session")).toBeNull();
  });

  it("groups the activity widgets under a single tab", async () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-activity"));

    expect(await screen.findByTestId("widget-achievements")).toBeInTheDocument();
    expect(await screen.findByTestId("widget-downloads")).toBeInTheDocument();
    expect(
      await screen.findByTestId("widget-notifications"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("widget-session")).toBeNull();
  });

  it("switches to notes, captures, timer, and settings tabs", async () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-notes"));
    expect(await screen.findByTestId("widget-notes")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-panel-tab-captures"));
    expect(await screen.findByTestId("widget-captures")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-panel-tab-timer"));
    expect(await screen.findByTestId("widget-timer")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-panel-tab-settings"));
    expect(await screen.findByTestId("widget-settings")).toBeInTheDocument();
  });

  it("drops tabs for groups with no enabled widgets", async () => {
    mockOverlay.mockReturnValue(overlayValue(["performance"]));
    render(<OverlayPanel />);

    expect(screen.getByTestId("overlay-panel-tab-performance")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-panel-tab-session")).toBeNull();
    expect(screen.queryByTestId("overlay-panel-tab-activity")).toBeNull();
    expect(await screen.findByTestId("widget-performance")).toBeInTheDocument();
  });

  it("renders no tab bar when every widget is disabled", () => {
    mockOverlay.mockReturnValue(overlayValue([]));
    render(<OverlayPanel />);

    expect(screen.queryByTestId("overlay-panel-tabs")).toBeNull();
    expect(screen.queryByTestId("overlay-panel-tabbody")).toBeNull();
  });

  it("renders game logo and thumbnail in the header when an active game is running", () => {
    const val = overlayValue(ALL_WIDGETS);
    val.session = {
      gameId: "game-10",
      startedAt: Date.now(),
      pid: 1234,
    };
    mockOverlay.mockReturnValue(val);
    mockOptionalGames.mockReturnValue({
      games: [
        {
          id: "game-10",
          name: "Hades II",
          coverArtUrl: "https://example.com/hades2-cover.jpg",
          logoUrl: "https://example.com/hades2-logo.png",
          installed: true,
          addedAt: 0,
        },
      ],
      runningGameIds: ["game-10"],
    } as any);

    render(<OverlayPanel />);

    const logoImg = screen.getByAltText("Hades II");
    expect(logoImg).toHaveAttribute("src", "https://example.com/hades2-logo.png");
    expect(logoImg).toHaveClass("overlay-panel__game-logo");
  });

  it("does not render the capture toast before anything is captured", () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    expect(screen.queryByText("overlay.screenshot.captured")).toBeNull();
  });

  it("shows the capture toast and auto-dismisses it", () => {
    vi.useFakeTimers();
    try {
      const val = overlayValue(ALL_WIDGETS);
      val.lastCapturedScreenshot = {
        filePath: "C:/Videos/Captures/Hades II/shot.png",
        fileName: "shot.png",
        gameTitle: "Hades II",
        timestamp: Date.now(),
        width: 1920,
        height: 1080,
      };
      mockOverlay.mockReturnValue(val);
      render(<OverlayPanel />);

      expect(screen.getByText("overlay.screenshot.captured")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(6000);
      });

      expect(screen.queryByText("overlay.screenshot.captured")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

