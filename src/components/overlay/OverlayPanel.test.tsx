import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
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
const { notificationState } = vi.hoisted(() => ({
  notificationState: { unreadCount: 0, markAllSeen: vi.fn() },
}));
vi.mock("./overlayNotifications", () => ({
  useOverlayNotifications: () => ({
    items: [],
    unread: [],
    unreadCount: notificationState.unreadCount,
    markAllSeen: notificationState.markAllSeen,
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue(undefined),
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
vi.mock("./widgets/RecordingWidget", () => ({
  default: () => <div data-testid="widget-clips" />,
}));
vi.mock("./widgets/TimerWidget", () => ({
  default: () => <div data-testid="widget-timer" />,
}));
vi.mock("./widgets/SettingsWidget", () => ({
  default: () => <div data-testid="widget-settings" />,
}));
vi.mock("./widgets/GuidesWidget", () => ({
  default: () => <div data-testid="widget-guides" />,
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
  "recording",
  "timer",
  "settings",
];

describe("OverlayPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
    notificationState.unreadCount = 0;
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

  it("splits the activity widgets into sub-tabs", async () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-activity"));

    expect(await screen.findByTestId("widget-achievements")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-downloads")).toBeNull();
    expect(screen.queryByTestId("widget-notifications")).toBeNull();

    fireEvent.click(screen.getByTestId("overlay-subtab-downloads"));
    expect(await screen.findByTestId("widget-downloads")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-achievements")).toBeNull();

    fireEvent.click(screen.getByTestId("overlay-subtab-notifications"));
    expect(await screen.findByTestId("widget-notifications")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-downloads")).toBeNull();
    expect(screen.queryByTestId("widget-session")).toBeNull();
  });

  it("clears the unread badge when the notification feed is opened", async () => {
    notificationState.unreadCount = 4;
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    expect(screen.getByTestId("overlay-rail-badge-activity")).toHaveTextContent(
      "4",
    );

    fireEvent.click(screen.getByTestId("overlay-panel-tab-activity"));
    expect(notificationState.markAllSeen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("overlay-subtab-notifications"));
    await waitFor(() =>
      expect(notificationState.markAllSeen).toHaveBeenCalledTimes(1),
    );
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

  it("keeps the always-on Guides tab when every toggleable widget is disabled", () => {
    mockOverlay.mockReturnValue(overlayValue([]));
    render(<OverlayPanel />);

    // Guides is not user-toggleable, so the bar stays even with nothing else.
    expect(screen.getByTestId("overlay-panel-tab-guides")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-panel-tab-performance")).toBeNull();
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

  it("resumes the remembered section on open", async () => {
    const val = overlayValue(ALL_WIDGETS);
    val.settings = { ...val.settings, lastPanelSection: "performance" };
    mockOverlay.mockReturnValue(val);
    render(<OverlayPanel />);

    expect(screen.getByTestId("overlay-panel-tab-performance")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("widget-performance")).toBeInTheDocument();
  });

  it("remembers a newly selected section", () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const val = overlayValue(ALL_WIDGETS);
    val.updateSettings = updateSettings;
    mockOverlay.mockReturnValue(val);
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-notes"));

    expect(updateSettings).toHaveBeenCalledWith({ lastPanelSection: "notes" });
  });

  it("moves through sections with the arrow keys", () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    const rail = screen.getByTestId("overlay-rail");
    fireEvent.keyDown(rail, { key: "ArrowDown" });

    expect(screen.getByTestId("overlay-panel-tab-performance")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(rail, { key: "End" });
    expect(screen.getByTestId("overlay-panel-tab-settings")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("reflects the density preset on the panel", () => {
    const val = overlayValue(ALL_WIDGETS);
    val.settings = { ...val.settings, panelDensity: "compact" };
    mockOverlay.mockReturnValue(val);
    render(<OverlayPanel />);

    expect(screen.getByTestId("overlay-panel")).toHaveAttribute(
      "data-density",
      "compact",
    );
  });

  it("switches captures sub-tabs even when the section was remembered", async () => {
    const val = overlayValue(ALL_WIDGETS);
    val.settings = { ...val.settings, lastPanelSection: "captures" };
    mockOverlay.mockReturnValue(val);
    render(<OverlayPanel />);

    expect(await screen.findByTestId("widget-captures")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overlay-subtab-clips"));

    expect(await screen.findByTestId("widget-clips")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-captures")).toBeNull();
  });

  it("opens the full settings page from the panel header", async () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-settings"));
    fireEvent.click(await screen.findByTestId("overlay-open-full-settings"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("overlay_open_settings"),
    );
  });

  it("keeps the panel usable when the settings deep link fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no runtime"));
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-tab-settings"));
    const action = await screen.findByTestId("overlay-open-full-settings");
    fireEvent.click(action);

    await waitFor(() => expect(action).not.toBeDisabled());
    expect(screen.getByTestId("overlay-panel")).toBeInTheDocument();
  });

  it("opens the hotkey cheatsheet and closes it with Escape", () => {
    mockOverlay.mockReturnValue(overlayValue(ALL_WIDGETS));
    render(<OverlayPanel />);

    fireEvent.click(screen.getByTestId("overlay-panel-help"));
    expect(screen.getByTestId("overlay-hotkeys")).toBeInTheDocument();
    expect(screen.getByText("overlay.help.toggle")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("overlay-hotkeys")).toBeNull();
  });
});

