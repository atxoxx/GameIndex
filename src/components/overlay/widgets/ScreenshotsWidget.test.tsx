import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ScreenshotsWidget from "./ScreenshotsWidget";
import { useOverlay } from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useOptionalGames } from "../../../context/GameContext";
import { makeOverlayValue } from "../overlayTestValue";

vi.mock("../../../context/OverlayContext", () => ({ useOverlay: vi.fn() }));
vi.mock("../../../context/LanguageContext", () => ({ useLanguage: vi.fn() }));
vi.mock("../../../context/GameContext", () => ({
  useOptionalGames: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockOverlay = vi.mocked(useOverlay);
const mockLanguage = vi.mocked(useLanguage);
const mockGames = vi.mocked(useOptionalGames);

const SHOTS = ["C:/Videos/Captures/Game/shot1.png", "C:/Videos/Captures/Game/shot2.png"];

function openLightbox() {
  render(<ScreenshotsWidget bare />);
  fireEvent.click(screen.getAllByTitle("shot1.png")[0]);
  return screen.getByTestId("overlay-screenshot-lightbox");
}

describe("ScreenshotsWidget preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLanguage.mockReturnValue({
      t: (key: string) => key,
    } as unknown as ReturnType<typeof useLanguage>);
    mockGames.mockReturnValue({ games: [], runningGameIds: [] } as any);
    mockOverlay.mockReturnValue(
      makeOverlayValue({
        session: null,
        recentScreenshots: SHOTS,
        openScreenshotsFolder: vi.fn().mockResolvedValue(undefined),
        deleteScreenshot: vi.fn().mockResolvedValue(true),
      }),
    );
  });

  it("opens a full-window preview with a back control", () => {
    const lightbox = openLightbox();

    expect(lightbox).toBeInTheDocument();
    expect(
      within(lightbox).getByTestId("overlay-lightbox-back"),
    ).toHaveTextContent("overlay.screenshot.back");
    expect(within(lightbox).getByText("shot1.png")).toBeInTheDocument();
  });

  it("browses to the next screenshot and back to the gallery", () => {
    const lightbox = openLightbox();

    fireEvent.click(within(lightbox).getByTestId("overlay-lightbox-next"));
    expect(within(lightbox).getByText("shot2.png")).toBeInTheDocument();

    fireEvent.click(within(lightbox).getByTestId("overlay-lightbox-back"));
    expect(screen.queryByTestId("overlay-screenshot-lightbox")).toBeNull();
  });

  it("closes with Escape and browses with the arrow keys", () => {
    const lightbox = openLightbox();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(lightbox).getByText("shot2.png")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("overlay-screenshot-lightbox")).toBeNull();
  });

  it("toggles actual-size mode", () => {
    const lightbox = openLightbox();
    const stage = lightbox.querySelector(
      ".overlay-screenshot-lightbox__stage",
    );

    expect(stage).toHaveAttribute("data-zoomed", "false");
    fireEvent.click(within(lightbox).getByTestId("overlay-lightbox-zoom"));
    expect(stage).toHaveAttribute("data-zoomed", "true");
  });
});
