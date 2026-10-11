import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecordingWidget from "./RecordingWidget";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { makeOverlayValue } from "../overlayTestValue";

vi.mock("../../../context/OverlayContext", () => ({ useOverlay: vi.fn() }));
vi.mock("../../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));

const mockOverlay = vi.mocked(useOverlay);
const mockLanguage = vi.mocked(useLanguage);

describe("RecordingWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage.mockReturnValue({
      t: (key: string) => key,
    } as unknown as ReturnType<typeof useLanguage>);
  });

  it("explains that video capture is Windows-only when unsupported", () => {
    mockOverlay.mockReturnValue(makeOverlayValue({ captureSupported: false }));
    render(<RecordingWidget />);
    expect(
      screen.getByText("overlay.recording.unsupported"),
    ).toBeInTheDocument();
  });

  it("starts a recording from the record button", () => {
    const startRecording = vi.fn().mockResolvedValue(undefined);
    mockOverlay.mockReturnValue(
      makeOverlayValue({ captureSupported: true, startRecording }),
    );
    render(<RecordingWidget />);

    fireEvent.click(screen.getByText("overlay.recording.start"));
    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it("lists recent clips with a delete action", () => {
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        captureSupported: true,
        recentClips: ["C:\\Videos\\Captures\\Game\\Replay_1.mp4"],
      }),
    );
    render(<RecordingWidget />);

    expect(screen.getByText("Replay_1.mp4")).toBeInTheDocument();
    expect(
      screen.getByLabelText("overlay.recording.delete"),
    ).toBeInTheDocument();
  });
});
