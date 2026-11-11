import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewsRichText } from "./NewsRichText";

const STEAM_PATCH = [
  "[h1]Update 1.2 — Skyward[/h1]",
  "Patch notes for [b]Skyward[/b] are here, plus [i]quality-of-life[/i] fixes.",
  "[list][*]Fixed a crash on launch[*]Improved [b]load times[/b][*]New photo mode[/list]",
  "[img]{STEAM_CLAN_IMAGE}/12345/header.jpg[/img]",
  "Read the [url=https://example.com/notes]full notes[/url].",
  "[previewyoutube=dQw4w9WgXcQ;full][/previewyoutube]",
  "[spoiler]The final boss is a dragon.[/spoiler]",
].join("<br>");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NewsRichText — Steam BBCode", () => {
  it("renders a realistic patch note", () => {
    const { container } = render(<NewsRichText content={STEAM_PATCH} />);

    expect(screen.getByRole("heading", { level: 3, name: /Update 1\.2/ })).toBeInTheDocument();
    expect(screen.getByText("Skyward").tagName).toBe("STRONG");

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Fixed a crash on launch");
    expect(items[1]).toHaveTextContent("Improved load times");

    const image = container.querySelector(".news-rich__img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute(
      "src",
      "https://clan.cloudflare.steamstatic.com/images/12345/header.jpg",
    );
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");

    expect(screen.getByRole("link", { name: "full notes" })).toHaveAttribute(
      "href",
      "https://example.com/notes",
    );

    const video = screen.getByRole("link", { name: /Watch on YouTube/ });
    expect(video).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("keeps spoilers collapsed behind a show/hide summary", () => {    const { container } = render(<NewsRichText content={STEAM_PATCH} />);

    const details = container.querySelector("details.news-rich__spoiler");
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText("Show spoiler")).toBeInTheDocument();
    expect(screen.getByText("Hide spoiler")).toBeInTheDocument();
  });

  it("handles Steam lists written with newlines between items", () => {
    const { container } = render(<NewsRichText content={"[list]\n[*]One\n[*]Two\n[/list]"} />);
    const list = container.querySelector("ul.news-rich__list");
    expect(list).not.toBeNull();
    const children = Array.from(list?.children ?? []);
    expect(children.map((child) => child.tagName)).toEqual(["LI", "LI"]);
    expect(children[0]).toHaveTextContent("One");
    expect(children[1]).toHaveTextContent("Two");
  });

  it("routes link clicks through onOpenLink without navigating", () => {    const onOpenLink = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<NewsRichText content={STEAM_PATCH} onOpenLink={onOpenLink} />);

    fireEvent.click(screen.getByRole("link", { name: "full notes" }));
    expect(onOpenLink).toHaveBeenCalledWith("https://example.com/notes");

    fireEvent.click(screen.getByRole("link", { name: /Watch on YouTube/ }));
    expect(onOpenLink).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(open).not.toHaveBeenCalled();
  });

  it("renders escaped brackets as literal text", () => {
    render(<NewsRichText content={"Use \\[b]carefully\\[/b] in chat."} />);
    expect(screen.getByText(/\[b]carefully\[\/b]/)).toBeInTheDocument();
  });

  it("applies the bigscreen variant class", () => {
    const { container } = render(<NewsRichText content="hello" variant="bigscreen" />);
    expect(container.firstElementChild).toHaveClass("news-rich--bigscreen");
  });
});

describe("NewsRichText — sanitized HTML", () => {
  const HTML =
    '<p>Hello <strong>world</strong></p><script>alert(1)</script>' +
    '<a href="https://example.com/story">story</a>' +
    '<img src="https://cdn.example.com/shot.png" alt="shot" onerror="alert(1)" />';

  it("renders sanitized feed HTML", async () => {
    const { container } = render(<NewsRichText content={HTML} />);

    expect(screen.getByText("world").tagName).toBe("STRONG");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).not.toHaveAttribute("onerror");

    await waitFor(() => {
      expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
    });
    expect(container.querySelector("img")).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(container.querySelector("a")).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("routes HTML anchor clicks through onOpenLink", () => {
    const onOpenLink = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<NewsRichText content={HTML} onOpenLink={onOpenLink} />);

    fireEvent.click(screen.getByRole("link", { name: "story" }));
    expect(onOpenLink).toHaveBeenCalledWith("https://example.com/story");
    expect(open).not.toHaveBeenCalled();
  });
});

describe("NewsRichText — plain text", () => {
  it("splits blank-line separated text into paragraphs", () => {
    const { container } = render(
      <NewsRichText content={"First paragraph.\n\nSecond &amp; third."} />,
    );
    const paragraphs = container.querySelectorAll("p.news-rich__p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("First paragraph.");
    expect(paragraphs[1]).toHaveTextContent("Second & third.");
  });
});
