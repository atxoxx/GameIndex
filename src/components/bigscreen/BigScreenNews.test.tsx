import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BigScreenNews from "./BigScreenNews";

const { openUrlMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
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
      {
        title: "Patch notes two",
        link: "https://example.com/2",
        description: "Steam patch notes",
        content:
          "[h1]Update 1.2[/h1]<br>" +
          "[b]Bold lead[/b]<br>" +
          "[list][*]first fix[*]second fix[/list]<br>" +
          "[url=https://example.com/notes]full notes[/url]<br>" +
          "[spoiler]The final boss is a dragon.[/spoiler]",
        pubDate: "2026-01-02",
        sourceName: "Source B",
        sourceUrl: "https://example.com",
        imageUrl: null,
      },
      {
        title: "Empty story",
        link: "https://example.com/3",
        description: "",
        content: "",
        pubDate: "2026-01-03",
        sourceName: "Source C",
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
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("../../hooks/GamepadProvider", () => ({
  useGamepad: () => ({
    registerAction: () => () => {},
    registerTabCycler: () => () => {},
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <BigScreenNews />
    </MemoryRouter>,
  );
}

function openReader(title: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(title) }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BigScreenNews article card", () => {
  it("announces itself as a button and nests no other control", () => {
    renderPage();

    const card = screen.getByRole("button", { name: /Headline one/ });
    expect(card.querySelectorAll("button")).toHaveLength(0);
    // The reader it opens lives outside the card, so the card stays a single
    // control rather than an interactive container.
    expect(card.querySelector('[data-bigscreen-overlay="true"]')).toBeNull();
  });

  it("opens the reader when activated", () => {
    const { container } = renderPage();

    openReader("Headline one");

    expect(container.querySelector('[data-bigscreen-overlay="true"]')).not.toBeNull();
  });
});

describe("BigScreenNews reader", () => {
  it("renders a rich BBCode body instead of the raw summary", () => {
    renderPage();

    openReader("Patch notes two");

    expect(screen.getByRole("heading", { level: 3, name: "Update 1.2" })).toBeInTheDocument();
    expect(screen.getByText("Bold lead").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.querySelector(".news-rich--bigscreen")).not.toBeNull();
  });

  it("keeps spoilers collapsed", () => {
    renderPage();

    openReader("Patch notes two");

    const details = document.querySelector("details.news-rich__spoiler");
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText("news.rich.spoilerShow")).toBeInTheDocument();
  });

  it("sends in-body links to the OS browser", () => {
    renderPage();

    openReader("Patch notes two");
    fireEvent.click(screen.getByRole("link", { name: "full notes" }));

    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/notes");
  });

  it("falls back to the no-preview line for an empty body", () => {
    renderPage();

    openReader("Empty story");

    expect(screen.getByText("bigscreen.news.noPreview")).toBeInTheDocument();
  });
});
