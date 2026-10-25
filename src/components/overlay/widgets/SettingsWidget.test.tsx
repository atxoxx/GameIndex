import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsWidget from "./SettingsWidget";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { baseOverlaySettings, makeOverlayValue } from "../overlayTestValue";

vi.mock("../../../context/OverlayContext", () => ({
  useOverlay: vi.fn(),
  TICKER_WIDGETS: [
    "fps",
    "cpu",
    "gpu",
    "cpuTemp",
    "gpuTemp",
    "ram",
    "sparkline",
    "session",
    "mic",
    "record",
    "replay",
    "screenshot",
  ],
}));
vi.mock("../../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));

const invoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const mockOverlay = vi.mocked(useOverlay);
const mockLanguage = vi.mocked(useLanguage);

describe("SettingsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue(undefined);
    mockLanguage.mockReturnValue({
      t: (key: string) => key,
    } as unknown as ReturnType<typeof useLanguage>);
  });

  it("switches panel density", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        settings: { ...baseOverlaySettings, panelDensity: "comfortable" },
        updateSettings,
      }),
    );
    render(<SettingsWidget />);

    fireEvent.click(screen.getByText("overlay.density.compact"));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ panelDensity: "compact" }),
    );
  });

  it("toggles a ticker readout", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        settings: { ...baseOverlaySettings, tickerWidgets: ["fps"] },
        updateSettings,
      }),
    );
    render(<SettingsWidget />);

    fireEvent.click(screen.getByTitle("overlay.metric.cpu"));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        tickerWidgets: ["fps", "cpu"],
      }),
    );
  });

  it("rebinds a capture hotkey from the keyboard", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        settings: { ...baseOverlaySettings },
        updateSettings,
      }),
    );
    render(<SettingsWidget />);

    const recordButtons = screen.getAllByRole("button", {
      name: "overlay.settings.hotkeyRecord",
    });
    // Toggle, screenshot, record, replay — the screenshot row is second.
    fireEvent.click(recordButtons[1]);
    fireEvent.keyDown(window, { key: "F9" });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        screenshotHotkey: "F9",
      }),
    );
  });

  it("keeps the previous binding when the toggle hotkey is rejected", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    invoke.mockRejectedValueOnce(new Error("conflict"));
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        settings: { ...baseOverlaySettings, hotkey: "Shift+F1" },
        updateSettings,
      }),
    );
    render(<SettingsWidget />);

    const recordButtons = screen.getAllByRole("button", {
      name: "overlay.settings.hotkeyRecord",
    });
    fireEvent.click(recordButtons[0]);
    fireEvent.keyDown(window, { key: "F10" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("overlay_set_hotkey", {
        accelerator: "F10",
      }),
    );
    expect(updateSettings).not.toHaveBeenCalledWith({ hotkey: "F10" });
  });
});
