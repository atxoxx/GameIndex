import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OverlayPage from "./OverlayPage";
import { useOverlay, type OverlayContextValue } from "../context/OverlayContext";

vi.mock("../context/OverlayContext", () => ({
  useOverlay: vi.fn(),
}));

// The switcher is under test — stub the two children so neither has to pull
// in the full provider tree.
vi.mock("../components/overlay/OverlayTicker", () => ({
  default: () => <div data-testid="overlay-ticker" />,
}));
vi.mock("../components/overlay/OverlayPanel", () => ({
  default: () => <div data-testid="overlay-panel" />,
}));

const mockOverlay = vi.mocked(useOverlay);

function overlayValue(
  collapsed: boolean,
  collapse = vi.fn(),
): OverlayContextValue {
  return {
    collapsed,
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse,
    corner: "bottom-right",
    settings: {
      enabled: true,
      hotkey: "Shift+F1",
      corner: "bottom-right",
      opacity: 0.9,
      tickerWidgets: ["fps", "cpu", "gpu", "session"],
      panelWidgets: [
        "session",
        "performance",
        "achievements",
        "downloads",
        "notifications",
        "notes",
      ],
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
    isCapturing: false,
    lastCapturedScreenshot: null,
    openScreenshotsFolder: vi.fn().mockResolvedValue(undefined),
    refreshScreenshots: vi.fn().mockResolvedValue(undefined),
    flashScreen: false,
    updateSettings: vi.fn().mockResolvedValue(undefined),
  };
}

describe("OverlayPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the ticker while collapsed", () => {
    mockOverlay.mockReturnValue(overlayValue(true));
    render(<OverlayPage />);

    expect(screen.getByTestId("overlay-ticker")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-panel")).toBeNull();
  });

  it("renders the panel while expanded and collapses on Escape", () => {
    const collapse = vi.fn();
    mockOverlay.mockReturnValue(overlayValue(false, collapse));
    render(<OverlayPage />);

    expect(screen.getByTestId("overlay-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-ticker")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(collapse).toHaveBeenCalledTimes(1);
  });
});
