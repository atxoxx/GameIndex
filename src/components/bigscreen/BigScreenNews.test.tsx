import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BigScreenNews from "./BigScreenNews";

vi.mock("../../context/NewsContext", () => ({
  useNewsDemand: () => ({
    articles: [
      {
        title: "Headline one",
        link: "https://example.com/1",
        description: "Summary text",
        content: "",
        pubDate: "2026-01-01",
        sourceName: "Source A",
        sourceUrl: "https://example.com",
        imageUrl: null,
      },
    ],
    loading: false,
    error: null,
    refresh: () => {},
    loadArticle: async () => null,
  }),
}));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({ registerAction: () => () => {} }),
}));

describe("BigScreenNews article card", () => {
  it("announces itself as a button and nests no other control", () => {
    render(<BigScreenNews />);

    const card = screen.getByRole("button", { name: /Headline one/ });
    expect(card.querySelectorAll("button")).toHaveLength(0);
    // The reader it opens lives outside the card, so the card stays a single
    // control rather than an interactive container.
    expect(card.querySelector('[data-bigscreen-overlay="true"]')).toBeNull();
  });

  it("opens the reader when activated", () => {
    const { container } = render(<BigScreenNews />);

    fireEvent.click(screen.getByRole("button", { name: /Headline one/ }));

    expect(container.querySelector('[data-bigscreen-overlay="true"]')).not.toBeNull();
  });
});
