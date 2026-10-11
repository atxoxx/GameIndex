import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OverlayTicker from "./OverlayTicker";
import {
  useOverlay,
  type OverlayContextValue,
} from "../../context/OverlayContext";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";
import { baseOverlaySettings, makeOverlayValue } from "./overlayTestValue";

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
  return makeOverlayValue({
    collapsed: true,
    expand,
    metrics: { cpu: 10, gpu: 20, ram: 30, cpuTemp: 40, gpuTemp: 50, fps: 60 },
  });
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

  it("toggles recording from the ticker record button", () => {
    const toggleRecording = vi.fn().mockResolvedValue(undefined);
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        captureSupported: true,
        toggleRecording,
        settings: { ...baseOverlaySettings, tickerWidgets: ["fps", "record"] },
      }),
    );
    render(<OverlayTicker />);

    fireEvent.click(screen.getByTestId("overlay-ticker-record"));
    expect(toggleRecording).toHaveBeenCalledTimes(1);
  });

  it("shows a live REC chip while recording", () => {
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        captureSupported: true,
        isRecording: true,
        recordingState: {
          recording: true,
          replayBuffering: false,
          startedAt: Date.now() - 5000,
          durationMs: 5000,
          error: null,
        },
        settings: { ...baseOverlaySettings, tickerWidgets: ["fps", "record"] },
      }),
    );
    render(<OverlayTicker />);

    expect(screen.getByTestId("overlay-ticker-rec-timer")).toHaveTextContent(
      "overlay.ticker.rec",
    );
  });

  it("renders the gauge cluster when the gauges layout is selected", () => {
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        metrics: { cpu: 10, gpu: 20, ram: 30, cpuTemp: 40, gpuTemp: 50, fps: 60 },
        settings: {
          ...baseOverlaySettings,
          tickerLayout: "gauges",
          tickerWidgets: ["fps", "cpu", "gpu", "ram"],
        },
      }),
    );
    render(<OverlayTicker />);

    expect(screen.getByTestId("overlay-ticker")).toHaveAttribute(
      "data-layout",
      "gauges",
    );
    expect(screen.getByTestId("overlay-ticker-gauges")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-gauge-fps")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-gauge-cpu")).toBeInTheDocument();
  });

  it("falls back to the strip layout for an unknown persisted preset", () => {
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        settings: {
          ...baseOverlaySettings,
          tickerLayout: "nonsense" as never,
        },
      }),
    );
    render(<OverlayTicker />);

    expect(screen.getByTestId("overlay-ticker")).toHaveAttribute(
      "data-layout",
      "strip",
    );
  });

  it("swaps the expand affordance for a click-through hint when click-through is on", () => {
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        settings: { ...baseOverlaySettings, tickerClickThrough: true },
      }),
    );
    render(<OverlayTicker />);

    expect(screen.getByTestId("overlay-ticker-clickthrough")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-ticker-expand")).toBeNull();
  });

  it("keeps the expand button and hides the hint when click-through is off", () => {
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        settings: { ...baseOverlaySettings, tickerClickThrough: false },
      }),
    );
    render(<OverlayTicker />);

    expect(screen.getByTestId("overlay-ticker-expand")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-ticker-clickthrough")).toBeNull();
  });

  it("renders a dash for an unknown temperature rather than a fabricated 0°", () => {
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        metrics: { cpu: 10, gpu: 20, ram: 30, cpuTemp: 0, gpuTemp: 67, fps: 60 },
        settings: {
          ...baseOverlaySettings,
          tickerWidgets: ["cpuTemp", "gpuTemp"],
        },
      }),
    );
    render(<OverlayTicker />);

    expect(screen.getByTestId("overlay-ticker-cpuTemp")).toHaveTextContent("—");
    expect(screen.getByTestId("overlay-ticker-gpuTemp")).toHaveTextContent("67°");
  });

  it("tags usage and temperature pills so CPU and GPU are distinguishable", () => {
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        metrics: { cpu: 14, gpu: 13, ram: 40, cpuTemp: 67, gpuTemp: 41, fps: 60 },
        settings: {
          ...baseOverlaySettings,
          tickerWidgets: ["fps", "cpu", "gpu", "cpuTemp", "gpuTemp", "ram"],
        },
      }),
    );
    render(<OverlayTicker />);

    expect(screen.getByTestId("overlay-ticker-cpu")).toHaveTextContent("CPU");
    expect(screen.getByTestId("overlay-ticker-gpu")).toHaveTextContent("GPU");
    expect(screen.getByTestId("overlay-ticker-cpuTemp")).toHaveTextContent("CPU");
    expect(screen.getByTestId("overlay-ticker-gpuTemp")).toHaveTextContent("GPU");
    expect(screen.getByTestId("overlay-ticker-ram")).toHaveTextContent("RAM");
  });
});
