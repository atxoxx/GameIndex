import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PerformanceWidget from "./PerformanceWidget";
import {
  useOverlay,
  type OverlayContextValue,
  type OverlayMetrics,
  type OverlaySettings,
} from "../../../context/OverlayContext";

vi.mock("../../../context/OverlayContext", () => ({
  useOverlay: vi.fn(),
}));

const mockOverlay = vi.mocked(useOverlay);

function overlayValue(
  metrics: OverlayMetrics | null,
  overrides: Partial<OverlaySettings> = {},
  history: OverlayMetrics[] = [],
): OverlayContextValue {
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
      panelWidgets: ["performance"],
      pollIntervalMs: 1000,
      showTemps: true,
      showGraphs: false,
      tickerWidth: 360,
      tickerHeight: 56,
      panelWidth: 480,
      panelHeight: 540,
      ...overrides,
    },
    metrics,
    history,
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

describe("PerformanceWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an em dash for FPS when no sample has arrived", () => {
    mockOverlay.mockReturnValue(overlayValue(null));
    render(<PerformanceWidget />);

    expect(
      within(screen.getByTestId("overlay-metric-fps")).getByText("—"),
    ).toBeInTheDocument();
  });

  it("never fabricates FPS when the sample omits it", () => {
    mockOverlay.mockReturnValue(
      overlayValue({ cpu: 42, gpu: 88, ram: 51, cpuTemp: 60, gpuTemp: 65 }),
    );
    render(<PerformanceWidget />);

    expect(
      within(screen.getByTestId("overlay-metric-fps")).getByText("—"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("overlay-metric-cpu")).getByText("42%"),
    ).toBeInTheDocument();
  });

  it("renders a provided FPS value", () => {
    mockOverlay.mockReturnValue(
      overlayValue({
        cpu: 10,
        gpu: 20,
        ram: 30,
        cpuTemp: 40,
        gpuTemp: 50,
        fps: 144,
      }),
    );
    render(<PerformanceWidget />);

    expect(
      within(screen.getByTestId("overlay-metric-fps")).getByText("144"),
    ).toBeInTheDocument();
  });

  it("renders temperature tiles when showTemps is enabled", () => {
    mockOverlay.mockReturnValue(
      overlayValue({ cpu: 42, gpu: 88, ram: 51, cpuTemp: 60, gpuTemp: 65 }),
    );
    render(<PerformanceWidget />);

    expect(screen.getByTestId("overlay-metric-cpuTemp")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-metric-gpuTemp")).toBeInTheDocument();
  });

  it("hides temperature tiles when showTemps is disabled", () => {
    mockOverlay.mockReturnValue(
      overlayValue(
        { cpu: 42, gpu: 88, ram: 51, cpuTemp: 60, gpuTemp: 65 },
        { showTemps: false },
      ),
    );
    render(<PerformanceWidget />);

    expect(screen.queryByTestId("overlay-metric-cpuTemp")).toBeNull();
    expect(screen.queryByTestId("overlay-metric-gpuTemp")).toBeNull();
  });

  it("graphs every hardware metric when showGraphs and showTemps are on", () => {
    const history: OverlayMetrics[] = [
      { cpu: 10, gpu: 20, ram: 30, cpuTemp: 40, gpuTemp: 50, fps: 60 },
      { cpu: 20, gpu: 30, ram: 35, cpuTemp: 42, gpuTemp: 52, fps: 75 },
    ];
    mockOverlay.mockReturnValue(
      overlayValue(history[1], { showGraphs: true }, history),
    );
    render(<PerformanceWidget />);

    expect(screen.getByTestId("overlay-graphs")).toBeInTheDocument();
    for (const key of ["fps", "cpu", "gpu", "ram", "cpuTemp", "gpuTemp"]) {
      expect(screen.getByTestId(`overlay-graph-${key}`)).toBeInTheDocument();
    }
  });

  it("omits the temperature graphs when showTemps is disabled", () => {
    const history: OverlayMetrics[] = [
      { cpu: 10, gpu: 20, ram: 30, cpuTemp: 40, gpuTemp: 50, fps: 60 },
      { cpu: 20, gpu: 30, ram: 35, cpuTemp: 42, gpuTemp: 52, fps: 75 },
    ];
    mockOverlay.mockReturnValue(
      overlayValue(
        history[1],
        { showGraphs: true, showTemps: false },
        history,
      ),
    );
    render(<PerformanceWidget />);

    expect(screen.getByTestId("overlay-graph-fps")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-graph-ram")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-graph-cpuTemp")).toBeNull();
    expect(screen.queryByTestId("overlay-graph-gpuTemp")).toBeNull();
  });

  it("hides the sparklines when showGraphs is disabled", () => {
    mockOverlay.mockReturnValue(overlayValue(null));
    render(<PerformanceWidget />);

    expect(screen.queryByTestId("overlay-graphs")).toBeNull();
  });
});
