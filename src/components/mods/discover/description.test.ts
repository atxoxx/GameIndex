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

  it("renders Steam Workshop headings [h1], [h2], [h3]", () => {
    const raw = "[h1]Installation Guide[/h1][h2]Requirements[/h2][h3]Notes[/h3]";
    const { node } = parseDescription(raw, noop, "Spoiler", noop);
    const html = renderToStaticMarkup(node);
    expect(html).toContain('<h3 class="mods-mod-desc-h1">Installation Guide</h3>');
    expect(html).toContain('<h4 class="mods-mod-desc-h2">Requirements</h4>');
    expect(html).toContain('<h5 class="mods-mod-desc-h3">Notes</h5>');
  });

  it("renders plain [url] tags and auto-links without trailing punctuation", () => {
    const raw = "Join us at [url]https://discord.gg/mod[/url] or see https://example.com/page.";
    const { node } = parseDescription(raw, noop, "Spoiler", noop);
    const html = renderToStaticMarkup(node);
    expect(html).toContain('href="https://discord.gg/mod"');
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('page</a>.');
  });

  it("converts dividers, quotes, and lists correctly", () => {
    const raw = "Header\n====================\n> Quoted rule\n[olist][*]First[*]Second[/olist]";
    const { node } = parseDescription(raw, noop, "Spoiler", noop);
    const html = renderToStaticMarkup(node);
    expect(html).toContain('<hr class="mods-mod-desc-hr"/>');
    expect(html).toContain('<blockquote class="mods-mod-desc-quote">Quoted rule</blockquote>');
    expect(html).toContain('<ol class="mods-mod-desc-list mods-mod-desc-list--ordered">');
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>Second</li>");
  });

  it("handles tables and noparse tags", () => {
    const raw = "[table][tr][th]Col[/th][/tr][tr][td]Val[/td][/tr][/table][noparse][b]literal[/b][/noparse]";
    const { node } = parseDescription(raw, noop, "Spoiler", noop);
    const html = renderToStaticMarkup(node);
    expect(html).toContain('<table class="mods-mod-desc-table">');
    expect(html).toContain('<th class="mods-mod-desc-th">Col</th>');
    expect(html).toContain('<td class="mods-mod-desc-td">Val</td>');
    expect(html).toContain("[b]literal[/b]");
    expect(html).not.toContain("<strong>literal</strong>");
  });
});
