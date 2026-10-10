import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OverlayTicker from "./OverlayTicker";
import {
  useOverlay,
  type OverlayContextValue,
} from "../../context/OverlayContext";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";

// `TICKER_WIDGETS` is read by the component, so the mock must carry it.
vi.mock("../../context/OverlayContext", () => ({
  useOverlay: vi.fn(),
  TICKER_WIDGETS: ["fps", "cpu", "gpu", "session"],
}));
vi.mock("../../context/DownloadContext", () => ({ useDownloads: vi.fn() }));
vi.mock("../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));
vi.mock("./widgets/NotificationsWidget", () => ({
  useOverlayNotifications: () => [],
}));
vi.mock("./widgets/SessionWidget", () => ({
  useSessionElapsed: () => 0,
  formatClock: () => "0:00",
}));

const mockOverlay = vi.mocked(useOverlay);
const mockDownloads = vi.mocked(useDownloads);
const mockLanguage = vi.mocked(useLanguage);

function overlayValue(expand = vi.fn()): OverlayContextValue {
  return {
    collapsed: true,
    toggle: vi.fn(),
    expand,
    collapse: vi.fn(),
    corner: "bottom-right",
    settings: {
      enabled: true,
      hotkey: "Shift+F1",
      corner: "bottom-right",
      opacity: 0.9,
      tickerWidgets: ["fps"],
      panelWidgets: ["session"],
      pollIntervalMs: 1000,
      showTemps: true,
      showGraphs: false,
      tickerWidth: 360,
      tickerHeight: 56,
      panelWidth: 480,
      panelHeight: 540,
    },
    metrics: { cpu: 10, gpu: 20, ram: 30, cpuTemp: 40, gpuTemp: 50, fps: 60 },
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

describe("OverlayTicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloads.mockReturnValue({ activeCount: 0 } as unknown as ReturnType<
      typeof useDownloads
    >);
    mockLanguage.mockReturnValue({ t: (key: string) => key } as unknown as ReturnType<
      typeof useLanguage
    >);
  });

  it("expands to the panel when the expand button is clicked", () => {
    const expand = vi.fn();
    mockOverlay.mockReturnValue(overlayValue(expand));
    render(<OverlayTicker />);

    fireEvent.click(screen.getByTestId("overlay-ticker-expand"));
    expect(expand).toHaveBeenCalledTimes(1);
  });

  it("shows a dash for missing FPS rather than a fabricated value", () => {
    mockOverlay.mockReturnValue({
      ...overlayValue(),
      metrics: { cpu: 10, gpu: 20, ram: 30, cpuTemp: 40, gpuTemp: 50 },
    });
    render(<OverlayTicker />);

    expect(screen.getByTestId("overlay-ticker")).toHaveTextContent(
      "overlay.metric.fps —",
    );
  });
});
