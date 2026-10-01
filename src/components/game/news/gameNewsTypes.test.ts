import { describe, expect, it } from "vitest";
import {
  extractSteamImage,
  parseSteamNewsApi,
  steamContentsToText,
  steamNewsApiUrl,
} from "./gameNewsTypes";

describe("steamNewsApiUrl", () => {
  it("requests the given count for the app", () => {
    const url = steamNewsApiUrl(730, 40);
    expect(url).toContain("appid=730");
    expect(url).toContain("count=40");
    expect(url).toContain("format=json");
  });
});

describe("steamContentsToText", () => {
  it("flattens BBCode into readable text and keeps escaped section labels", () => {
    const text = steamContentsToText(
      "[p]\\[ MISC ][/p][list][*][p]Fixed some clipping.[/p][/*][/list]"
    );
    expect(text).toContain("[ MISC ]");
    expect(text).toContain("Fixed some clipping.");
    expect(text).not.toContain("[p]");
    expect(text).not.toContain("[/list]");
  });

  it("drops media embeds and raw HTML tags", () => {
    const text = steamContentsToText(
      '[img]https://example.com/a.png[/img]Hello <p>world</p><br>'
    );
    expect(text).toBe("Hello world");
  });
});

describe("extractSteamImage", () => {
  it("reads a raw HTML image first", () => {
    expect(
      extractSteamImage('<p><img src="https://example.com/cover.webp" alt /></p>')
    ).toBe("https://example.com/cover.webp");
  });

  it("falls back to BBCode [img] tags", () => {
    expect(
      extractSteamImage("Some text\n[img]https://example.com/bb.png[/img]")
    ).toBe("https://example.com/bb.png");
  });

  it("returns null when no image is present", () => {
    expect(extractSteamImage("[p]Just patch notes[/p]")).toBeNull();
  });
});

describe("parseSteamNewsApi", () => {
  it("maps official and press items with constructed Steam links", () => {
    const payload = JSON.stringify({
      appnews: {
        count: 1766,
        newsitems: [
          {
            gid: "111",
            title: "Update",
            contents: "[p]\\[ FIXES ][/p][list][*][p]Fixed a crash.[/p][/*][/list]",
            feedlabel: "Community Announcements",
            feedname: "steam_community_announcements",
            feed_type: 1,
            date: 1790808379,
          },
          {
            gid: "222",
            title: "Review roundup",
            contents: '<img src="https://example.com/art.png" />',
            feedlabel: "GamingOnLinux",
            feedname: "GamingOnLinux",
            feed_type: 0,
            date: 1790635105,
          },
        ],
      },
    });

    const { articles, total } = parseSteamNewsApi(payload, 730, "Steam News");

    expect(total).toBe(1766);
    expect(articles).toHaveLength(2);

    expect(articles[0].title).toBe("Update");
    expect(articles[0].link).toBe(
      "https://store.steampowered.com/news/app/730/view/111"
    );
    expect(articles[0].sourceName).toBe("Steam News");
    expect(articles[0].description).toBe("[ FIXES ] Fixed a crash.");
    expect(articles[0].pubDate).toContain("2026");
    expect(articles[0].pubDate).not.toBe("");

    expect(articles[1].sourceName).toBe("GamingOnLinux");
    expect(articles[1].imageUrl).toBe("https://example.com/art.png");
    expect(articles[1].link).toBe(
      "https://store.steampowered.com/news/app/730/view/222"
    );
  });

  it("returns an empty result for malformed JSON", () => {
    const { articles, total } = parseSteamNewsApi("not json", 730, "Steam News");
    expect(articles).toEqual([]);
    expect(total).toBe(0);
  });

  it("skips items without a gid", () => {
    const payload = JSON.stringify({
      appnews: { count: 5, newsitems: [{ title: "No id", contents: "" }] },
    });
    const { articles } = parseSteamNewsApi(payload, 730, "Steam News");
    expect(articles).toEqual([]);
  });
});
