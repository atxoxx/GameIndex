import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  detectNewsFormat,
  expandSteamImagePlaceholders,
  newsContentToPlainText,
  parseNewsContent,
  parseYouTubeVideoId,
  prepareNewsContent,
  sanitizeNewsHtml,
  youTubeWatchUrl,
} from "./newsContent";

describe("prepareNewsContent", () => {
  it("expands Steam CDN placeholders", () => {
    expect(expandSteamImagePlaceholders("{STEAM_CLAN_IMAGE}/1234/abc.jpg")).toBe(
      "https://clan.cloudflare.steamstatic.com/images/1234/abc.jpg",
    );
    expect(expandSteamImagePlaceholders("{STEAM_CLAN_LOC_IMAGE}/99/x.png")).toBe(
      "https://clan.cloudflare.steamstatic.com/images/99/x.png",
    );
    expect(expandSteamImagePlaceholders("{STEAM_CLAN_IMAGE}no-slash.jpg")).toBe(
      "https://clan.cloudflare.steamstatic.com/images/no-slash.jpg",
    );
  });

  it("normalises newlines and unescapes brackets", () => {
    expect(prepareNewsContent("a\r\nb\rc\\[b]")).toBe("a\nb\nc[b]");
  });

  it("tolerates empty input", () => {
    expect(prepareNewsContent("")).toBe("");
  });
});

describe("detectNewsFormat", () => {
  it("prefers BBCode when Steam mixes it with <br>", () => {
    expect(detectNewsFormat("[b]Patch[/b]<br>notes")).toBe("bbcode");
  });

  it("detects RSS HTML", () => {
    expect(detectNewsFormat("<p>Hello <strong>world</strong></p>")).toBe("html");
  });

  it("falls back to plain text", () => {
    expect(detectNewsFormat("Just a sentence about games.")).toBe("text");
    expect(detectNewsFormat("   ")).toBe("text");
  });

  it("ignores escaped brackets when looking for BBCode", () => {
    expect(detectNewsFormat("Use \\[b] to write bold in <p>markup</p>")).toBe("html");
  });
});

describe("newsContentToPlainText", () => {
  it("strips BBCode and decodes entities", () => {
    const text = newsContentToPlainText(
      "[b]Update 1.2[/b] &amp; more[list][*]one[*]two[/list]",
    );
    expect(text).toBe("Update 1.2 & more one two");
  });

  it("strips HTML and collapses whitespace", () => {
    expect(newsContentToPlainText("<p>Hello</p>\n\n<p>world&nbsp;!</p>")).toBe("Hello world !");
  });

  it("returns empty for empty input", () => {
    expect(newsContentToPlainText("")).toBe("");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeHtmlEntities("A &amp; B &lt;3 &#39;quoted&#39; &#x2014; done")).toBe(
      "A & B <3 'quoted' — done",
    );
  });

  it("leaves unknown entities alone", () => {
    expect(decodeHtmlEntities("&notarealentity;")).toBe("&notarealentity;");
  });
});

describe("sanitizeNewsHtml", () => {
  it("keeps allowlisted markup and safe links", () => {
    const html =
      '<p>Hello <strong>world</strong> <a href="https://example.com/x">link</a></p>' +
      '<img src="https://cdn.example.com/a.png" alt="shot" />';
    const clean = sanitizeNewsHtml(html);

    expect(clean).toContain("<p>");
    expect(clean).toContain("<strong>world</strong>");
    expect(clean).toContain('href="https://example.com/x"');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('src="https://cdn.example.com/a.png"');
    expect(clean).toContain('alt="shot"');
  });

  it("drops scripts, styles, iframes and their content", () => {
    const clean = sanitizeNewsHtml(
      "<p>ok</p><script>alert(1)</script><style>p{color:red}</style>" +
        '<iframe src="https://evil.example"></iframe>',
    );
    expect(clean).toBe("<p>ok</p>");
  });

  it("drops event handlers, style, class and id attributes", () => {
    const clean = sanitizeNewsHtml(
      '<p class="x" id="y" style="color:red" onclick="alert(1)">text</p>' +
        '<img src="https://cdn.example.com/a.png" onerror="alert(1)" />',
    );
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("style=");
    expect(clean).not.toContain("class=");
    expect(clean).not.toContain("id=");
  });

  it("rejects javascript: urls but keeps the anchor text", () => {
    const clean = sanitizeNewsHtml('<a href="javascript:alert(1)">click</a>');
    expect(clean).toBe("<a rel=\"noopener noreferrer\">click</a>");
    expect(clean).not.toContain("javascript:");
  });

  it("drops images without a usable src", () => {
    expect(sanitizeNewsHtml('<img src="javascript:alert(1)" />')).toBe("");
    expect(sanitizeNewsHtml("<img />")).toBe("");
  });

  it("never throws on malformed input", () => {
    expect(() => sanitizeNewsHtml("<p><b>unclosed <a href='x'>")).not.toThrow();
    expect(() => sanitizeNewsHtml("<<<>>>")).not.toThrow();
    expect(sanitizeNewsHtml("5 < 10 and 20 > 3")).toContain("5 &lt; 10");
  });

  it("drops unknown tags but keeps their text", () => {
    expect(sanitizeNewsHtml("<custom>kept</custom>")).toBe("kept");
  });
});

describe("parseNewsContent", () => {
  it("returns a BBCode AST", () => {
    const parsed = parseNewsContent("[b]bold[/b]");
    expect(parsed.kind).toBe("bbcode");
    if (parsed.kind !== "bbcode") throw new Error("expected bbcode");
    expect(parsed.nodes[0]).toMatchObject({ type: "tag", tag: "b" });
  });

  it("returns sanitized HTML", () => {
    const parsed = parseNewsContent("<p>hi<script>alert(1)</script></p>");
    expect(parsed.kind).toBe("html");
    if (parsed.kind !== "html") throw new Error("expected html");
    expect(parsed.html).toBe("<p>hi</p>");
  });

  it("returns paragraphs for plain text", () => {
    const parsed = parseNewsContent("First line\nstill first.\n\nSecond paragraph.");
    expect(parsed.kind).toBe("text");
    if (parsed.kind !== "text") throw new Error("expected text");
    expect(parsed.paragraphs).toEqual(["First line still first.", "Second paragraph."]);
  });
});

describe("YouTube helpers", () => {
  it("accepts plain ids and ;full suffixes", () => {
    expect(parseYouTubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("dQw4w9WgXcQ;full")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("[previewyoutube=dQw4w9WgXcQ;full]")).toBe("dQw4w9WgXcQ");
  });

  it("rejects invalid ids", () => {
    expect(parseYouTubeVideoId("short")).toBeNull();
    expect(parseYouTubeVideoId("has spaces here")).toBeNull();
    expect(parseYouTubeVideoId("")).toBeNull();
    expect(parseYouTubeVideoId(null)).toBeNull();
  });

  it("builds a watch url", () => {
    expect(youTubeWatchUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });
});
