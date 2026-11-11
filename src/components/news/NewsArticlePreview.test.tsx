import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NewsArticle } from "../../types/news";

const { invokeMock, openUrlMock, webviewStub } = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue(undefined),
  openUrlMock: vi.fn().mockResolvedValue(undefined),
  webviewStub: {
    label: "news-preview-stub",
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/webview", () => ({
  Webview: {
    getAll: vi.fn().mockResolvedValue([]),
    getByLabel: vi.fn().mockResolvedValue(webviewStub),
  },
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {},
  LogicalSize: class LogicalSize {},
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("../../context/SettingsContext", () => ({
  useWebviewContentFilterEnabled: () => true,
}));

import NewsArticlePreview from "./NewsArticlePreview";

const BBCodeArticle: NewsArticle = {
  title: "Patch 1.2",
  link: "https://example.com/patch-1-2",
  description: "Patch notes summary",
  content:
    "[h1]Patch notes[/h1]<br>" +
    "[b]Bold lead[/b]<br>" +
    "[list][*]first fix[*]second fix[/list]<br>" +
    "[url=https://example.com/notes]full notes[/url]",
  pubDate: "2026-01-01",
  sourceName: "Source A",
  sourceUrl: "https://example.com",
  imageUrl: null,
};

function renderPreview(article: NewsArticle | null) {
  return render(
    <NewsArticlePreview article={article} onClose={() => {}} />,
  );
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockClear();
  openUrlMock.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 10,
    top: 10,
    left: 10,
    right: 810,
    bottom: 610,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NewsArticlePreview reader", () => {
  it("renders BBCode bodies as real markup", () => {
    const { container } = renderPreview(BBCodeArticle);

    expect(
      screen.getByRole("heading", { level: 3, name: "Patch notes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bold lead").tagName).toBe("STRONG");

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("first fix");

    // The old sanitizer path left the raw tags in the DOM.
    expect(container.textContent).not.toContain("[list]");
  });

  it("counts words and reading time from the plain text, not the tags", () => {
    renderPreview(BBCodeArticle);

    // "Patch notes Bold lead first fix second fix full notes" — the tags add nothing.
    expect(screen.getByText(/\(\d+ words\)/)).toHaveTextContent("(10 words)");
    expect(screen.getByText(/min read/)).toHaveTextContent("1 min read");
  });

  it("renders article images inline", () => {
    renderPreview({
      ...BBCodeArticle,
      content: "[img]https://cdn.example.com/shot.png[/img]",
    });

    const image = document.querySelector(".news-rich__img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", "https://cdn.example.com/shot.png");
  });

  it("renders nothing without an article", () => {
    const { container } = renderPreview(null);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("NewsArticlePreview in-body links", () => {
  it("opens a link in the full-page view instead of navigating away", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPreview(BBCodeArticle);

    fireEvent.click(screen.getByRole("link", { name: "full notes" }));

    expect(screen.getByText("news.linkOpenedFromArticle")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "create_preview_webview",
        expect.objectContaining({ url: "https://example.com/notes" }),
      ),
    );
    expect(screen.getByText("https://example.com/notes")).toBeInTheDocument();
  });

  it("returns to the article and clears the external link", async () => {
    renderPreview(BBCodeArticle);

    fireEvent.click(screen.getByRole("link", { name: "full notes" }));
    await waitFor(() =>
      expect(screen.getByText("news.linkOpenedFromArticle")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "news.backToArticle" }));

    expect(screen.queryByText("news.linkOpenedFromArticle")).toBeNull();
    expect(document.querySelector(".news-rich")).not.toBeNull();
  });

  it("falls back to the article link when no in-body link was opened", async () => {
    renderPreview(BBCodeArticle);

    fireEvent.click(screen.getByRole("tab", { name: "news.previewFullPage" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "create_preview_webview",
        expect.objectContaining({ url: "https://example.com/patch-1-2" }),
      ),
    );
    expect(screen.queryByText("news.linkOpenedFromArticle")).toBeNull();
  });
});
