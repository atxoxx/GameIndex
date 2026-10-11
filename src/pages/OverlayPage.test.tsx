import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OverlayPage from "./OverlayPage";
import { useOverlay, type OverlayContextValue } from "../context/OverlayContext";
import {
  baseOverlaySettings,
  makeOverlayValue,
} from "../components/overlay/overlayTestValue";

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
  return makeOverlayValue({
    collapsed,
    collapse,
    settings: {
      ...baseOverlaySettings,
      tickerWidgets: ["fps", "cpu", "gpu", "session"],
      panelWidgets: [
        "session",
        "performance",
        "achievements",
        "downloads",
        "notifications",
        "notes",
      ],
    },
  });
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
