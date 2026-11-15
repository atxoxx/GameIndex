import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OverlayAchievementToast from "./OverlayAchievementToast";

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.percent != null ? `${key} ${vars.percent}` : key,
  }),
}));

const notice = {
  id: "g1:First Steps:0",
  gameId: "g1",
  gameName: "Test Game",
  displayName: "First Steps",
  description: "Finish the tutorial.",
  icon: "https://example.test/icon.png",
  percent: 4.2,
  isRare: true,
};

describe("OverlayAchievementToast", () => {
  it("renders the achievement identity, rarity and global percentage", () => {
    render(<OverlayAchievementToast notice={notice} onDismiss={() => {}} pending={2} />);

    const toast = screen.getByTestId("overlay-achievement-toast");
    expect(toast).toHaveTextContent("overlay.achievement.unlocked");
    expect(toast).toHaveTextContent("First Steps");
    expect(toast).toHaveTextContent("Finish the tutorial.");
    expect(toast).toHaveTextContent("overlay.achievement.rare");
    expect(toast).toHaveTextContent("Test Game");
    expect(toast).toHaveTextContent("4.2");
    expect(toast).toHaveTextContent("+2");
  });

  it("omits the rare badge for ordinary achievements", () => {
    render(
      <OverlayAchievementToast
        notice={{ ...notice, isRare: false }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId("overlay-achievement-toast")).not.toHaveTextContent(
      "overlay.achievement.rare",
    );
  });

  it("dismisses from the close button", () => {
    const onDismiss = vi.fn();
    render(<OverlayAchievementToast notice={notice} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("overlay.achievement.dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
