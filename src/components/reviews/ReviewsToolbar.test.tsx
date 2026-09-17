import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewsToolbar } from "./ReviewsToolbar";

const { registerAction, registered } = vi.hoisted(() => {
  const registered: { element: HTMLElement; onActivate: () => void }[] = [];
  return {
    registered,
    registerAction: (element: HTMLElement, onActivate: () => void) => {
      registered.push({ element, onActivate });
      return () => {
        const i = registered.findIndex((e) => e.element === element);
        if (i >= 0) registered.splice(i, 1);
      };
    },
  };
});

vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ showDeckVerified: false }),
}));

function renderToolbar() {
  const onDisplayChange = vi.fn();
  const onReviewTypeChange = vi.fn();
  render(
    <ReviewsToolbar
      display="all"
      onDisplayChange={onDisplayChange}
      reviewType="all"
      onReviewTypeChange={onReviewTypeChange}
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
      searchQuery=""
      onSearchQueryChange={vi.fn()}
      sourceFilter="all"
      onSourceFilterChange={vi.fn()}
      totalAll={10}
      steamCount={10}
      criticCounts={{ metacritic: 0, opencritic: 0 }}
      criticLoading={{ metacritic: false, opencritic: false }}
      onResetFilters={vi.fn()}
    />,
  );
  return { onDisplayChange, onReviewTypeChange };
}

describe("ReviewsToolbar controller focus", () => {
  beforeEach(() => {
    registered.length = 0;
  });

  it("registers the display segmented control and activates it through the gamepad handler", () => {
    const { onDisplayChange } = renderToolbar();

    const summaryButton = screen.getByText("review.summary");
    expect(summaryButton.tagName).toBe("BUTTON");
    expect((summaryButton as HTMLButtonElement).tabIndex).toBe(0);

    const entry = registered.find((e) => e.element === summaryButton);
    expect(entry).toBeTruthy();

    entry!.onActivate();
    expect(onDisplayChange).toHaveBeenCalledWith("summary");
  });

  it("registers the review-type segmented control", () => {
    const { onReviewTypeChange } = renderToolbar();

    const positiveButton = screen.getByText("review.recommended");
    expect((positiveButton as HTMLButtonElement).tabIndex).toBe(0);

    const entry = registered.find((e) => e.element === positiveButton);
    expect(entry).toBeTruthy();

    entry!.onActivate();
    expect(onReviewTypeChange).toHaveBeenCalledWith("positive");
  });
});
