import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OverlayPanel from "./OverlayPanel";
import {
  useOverlay,
  type OverlayContextValue,
} from "../../context/OverlayContext";
import { useLanguage } from "../../context/LanguageContext";
import { useOptionalGames } from "../../context/GameContext";

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
  return {
    collapsed: false,
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    corner: "bottom-right",
    settings: {
      enabled: true,
      hotkey: "Shift+F1",
      corner: "bottom-right",
      opacity: 0.9,
      tickerWidgets: ["fps"],
      panelWidgets,
      pollIntervalMs: 1000,
      showTemps: true,
      showGraphs: false,
      tickerWidth: 360,
      tickerHeight: 56,
      panelWidth: 480,
      panelHeight: 540,
    },
    metrics: null,
    history: [],
    session: null,
    providerReady: true,
    captureScreenshot: vi.fn().mockResolvedValue(null),
    recentScreenshots: [],
    deleteScreenshot: vi.fn().mockResolvedValue(true),
    isCapturing: false,
    lastCapturedScreenshot: null,
    openScreenshotsFolder: vi.fn().mockResolvedValue(undefined),
    refreshScreenshots: vi.fn().mockResolvedValue(undefined),
    flashScreen: false,
    updateSettings: vi.fn().mockResolvedValue(undefined),
  };
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

  it("defaults to the first enabled tab and shows only its content", () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    expect(screen.getByTestId("overlay-panel-tab-session")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("widget-session")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-performance")).toBeNull();
    expect(screen.queryByTestId("widget-achievements")).toBeNull();
  });

  it("switches the visible widgets when another tab is clicked", () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-performance"));

    expect(
      screen.getByTestId("overlay-panel-tab-performance"),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("widget-performance")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-session")).toBeNull();
  });

  it("groups the activity widgets under a single tab", () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-activity"));

    expect(screen.getByTestId("widget-achievements")).toBeInTheDocument();
    expect(screen.getByTestId("widget-downloads")).toBeInTheDocument();
    expect(screen.getByTestId("widget-notifications")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-session")).toBeNull();
  });

  it("switches to notes, captures, timer, and settings tabs", () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-notes"));
    expect(screen.getByTestId("widget-notes")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-panel-tab-captures"));
    expect(screen.getByTestId("widget-captures")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-panel-tab-timer"));
    expect(screen.getByTestId("widget-timer")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overlay-panel-tab-settings"));
    expect(screen.getByTestId("widget-settings")).toBeInTheDocument();
  });

  it("drops tabs for groups with no enabled widgets", () => {
    mockOverlay.mockReturnValue(overlayValue(["performance"]));
    render(<OverlayPanel />);

    expect(screen.getByTestId("overlay-panel-tab-performance")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-panel-tab-session")).toBeNull();
    expect(screen.queryByTestId("overlay-panel-tab-activity")).toBeNull();
    expect(screen.getByTestId("widget-performance")).toBeInTheDocument();
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
});

