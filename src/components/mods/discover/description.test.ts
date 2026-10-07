import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildMediaItem,
  mediaKind,
  parseDescription,
  vimeoId,
  youtubeId,
} from "./description";

const noop = () => {};

describe("mod description parser", () => {
  it("extracts description media in document order", () => {
    const raw =
      "[b]MinHook[/b][img]https://i.ibb.co/x/pic.png[/img][youtube]https://youtu.be/abc123[/youtube]";
    const { media } = parseDescription(raw, noop, "Spoiler", noop);
    expect(media).toHaveLength(2);
    expect(media[0]).toMatchObject({ type: "image", url: "https://i.ibb.co/x/pic.png" });
    expect(media[1].type).toBe("video");
    expect(media[1].embedUrl).toContain("youtube.com/embed/abc123");
  });

  it("renders BBCode formatting and links to safe markup", () => {
    const raw = "[center][b]Bold[/b] and [url=https://example.com]a link[/url][/center]";
    const { node } = parseDescription(raw, noop, "Spoiler", noop);
    const html = renderToStaticMarkup(node);
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  it("converts HTML and never emits script tags", () => {
    const raw = "<p>Hello <b>world</b></p><script>alert(1)</script>";
    const { node } = parseDescription(raw, noop, "Spoiler", noop);
    const html = renderToStaticMarkup(node);
    expect(html).toContain("<strong>world</strong>");
    expect(html).not.toContain("<script");
  });

  it("renders Steam previewyoutube as an embeddable video", () => {
    const { media } = parseDescription(
      "[previewyoutube=abc123][/previewyoutube]",
      noop,
      "Spoiler",
      noop,
    );
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("video");
    expect(media[0].embedUrl).toContain("youtube.com/embed/abc123");
  });

  it("classifies media and resolves video ids", () => {
    expect(mediaKind("https://a/b.jpg")).toBe("image");
    expect(mediaKind("https://a/b.mp4")).toBe("video");
    expect(mediaKind("https://youtu.be/abc123")).toBe("video");
    expect(mediaKind("https://example.com/page")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=abc123")).toBe("abc123");
    expect(vimeoId("https://vimeo.com/12345")).toBe("12345");
    expect(buildMediaItem("https://a/b.webm").type).toBe("video");
  });
});
