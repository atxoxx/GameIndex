import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../context/LanguageContext";
import ReviewsFilterPopover from "./ReviewsFilterPopover";

function renderFilters(
  overrides: Partial<React.ComponentProps<typeof ReviewsFilterPopover>> = {},
) {
  const props: React.ComponentProps<typeof ReviewsFilterPopover> = {
    open: true,
    onClose: vi.fn(),
    display: "all",
    onDisplayChange: vi.fn(),
    purchaseType: "all",
    onPurchaseTypeChange: vi.fn(),
    languageFilter: "all",
    onLanguageFilterChange: vi.fn(),
    playtimePreset: "none",
    onPlaytimePresetChange: vi.fn(),
    playtimeMinHours: 0,
    onPlaytimeMinHoursChange: vi.fn(),
    playtimeMaxHours: 0,
    onPlaytimeMaxHoursChange: vi.fn(),
    playtimeDevice: "all",
    onPlaytimeDeviceChange: vi.fn(),
    useHelpfulSystem: false,
    onUseHelpfulSystemChange: vi.fn(),
    showDeckVerified: true,
    onReset: vi.fn(),
    ...overrides,
  };

  render(
    <LanguageProvider>
      <ReviewsFilterPopover {...props} />
    </LanguageProvider>,
  );
  return props;
}

describe("ReviewsFilterPopover", () => {
  it("reports ordering and purchase changes", () => {
    const props = renderFilters();

    fireEvent.change(screen.getByLabelText("Display"), {
      target: { value: "recent" },
    });
    expect(props.onDisplayChange).toHaveBeenCalledWith("recent");

    fireEvent.change(screen.getByLabelText("Purchase Type"), {
      target: { value: "steam" },
    });
    expect(props.onPurchaseTypeChange).toHaveBeenCalledWith("steam");
  });

  it("shows the custom playtime range only for the custom preset", () => {
    const { rerender } = render(
      <LanguageProvider>
        <ReviewsFilterPopover
          open
          onClose={vi.fn()}
          display="all"
          onDisplayChange={vi.fn()}
          purchaseType="all"
          onPurchaseTypeChange={vi.fn()}
          languageFilter="all"
          onLanguageFilterChange={vi.fn()}
          playtimePreset="custom"
          onPlaytimePresetChange={vi.fn()}
          playtimeMinHours={1}
          onPlaytimeMinHoursChange={vi.fn()}
          playtimeMaxHours={10}
          onPlaytimeMaxHoursChange={vi.fn()}
          playtimeDevice="all"
          onPlaytimeDeviceChange={vi.fn()}
          useHelpfulSystem={false}
          onUseHelpfulSystemChange={vi.fn()}
          showDeckVerified
          onReset={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(screen.getByLabelText("Min hours")).toHaveValue(1);
    expect(screen.getByLabelText("Max hours")).toHaveValue(10);

    rerender(
      <LanguageProvider>
        <ReviewsFilterPopover
          open
          onClose={vi.fn()}
          display="all"
          onDisplayChange={vi.fn()}
          purchaseType="all"
          onPurchaseTypeChange={vi.fn()}
          languageFilter="all"
          onLanguageFilterChange={vi.fn()}
          playtimePreset="none"
          onPlaytimePresetChange={vi.fn()}
          playtimeMinHours={0}
          onPlaytimeMinHoursChange={vi.fn()}
          playtimeMaxHours={0}
          onPlaytimeMaxHoursChange={vi.fn()}
          playtimeDevice="all"
          onPlaytimeDeviceChange={vi.fn()}
          useHelpfulSystem={false}
          onUseHelpfulSystemChange={vi.fn()}
          showDeckVerified
          onReset={vi.fn()}
        />
      </LanguageProvider>,
    );
    expect(screen.queryByLabelText("Min hours")).toBeNull();
  });

  it("closes on Escape and resets from the footer", () => {
    const onClose = vi.fn();
    const onReset = vi.fn();
    renderFilters({ onClose, onReset });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Reset filters/ }));
    expect(onReset).toHaveBeenCalled();
  });
});
