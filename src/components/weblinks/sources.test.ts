import { describe, it, expect } from "vitest";
import {
  buildUrl,
  dedupeWebsites,
  deriveCustomLinkMeta,
  formatUrlForDisplay,
  isSameUrl,
  normalizeUrl,
  parseCustomLink,
  parseCustomLinks,
  serializeCustomLink,
  uniqueByUrl,
} from "./sources";
import type { Game } from "../../types/game";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "id-1",
    name: "Test Game",
    path: "C:\\Games\\Test\\game.exe",
    platform: "Local",
    installed: true,
    playTime: "0h",
    addedAt: 0,
    ...overrides,
  };
}

describe("deriveCustomLinkMeta", () => {
  it("derives a capitalized base label and stripped host", () => {
    expect(deriveCustomLinkMeta("https://www.nexusmods.com/games/x")).toEqual({
      label: "Nexusmods",
      host: "nexusmods.com",
    });
  });

  it("falls back for a malformed URL", () => {
    expect(deriveCustomLinkMeta("not a url")).toEqual({
      label: "Link",
      host: "not a url",
    });
  });
});

describe("formatUrlForDisplay", () => {
  it("drops the scheme and www prefix", () => {
    expect(formatUrlForDisplay("https://www.example.com/a")).toBe("example.com/a");
  });
});

describe("parseCustomLink", () => {
  it("parses a plain URL", () => {
    const parsed = parseCustomLink("  https://example.com  ");
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.label).toBe("Example");
    expect(parsed.host).toBe("example.com");
  });

  it("parses serialized metadata", () => {
    const parsed = parseCustomLink(
      JSON.stringify({ url: "https://wiki.gg/game", label: "Game Wiki", tag: "Wiki" })
    );
    expect(parsed.url).toBe("https://wiki.gg/game");
    expect(parsed.label).toBe("Game Wiki");
    expect(parsed.tag).toBe("Wiki");
  });

  it("falls back to the raw string when JSON is malformed", () => {
    const parsed = parseCustomLink("{not valid json}");
    expect(parsed.url).toBe("{not valid json}");
    expect(parsed.label).toBe("Link");
  });
});

describe("serializeCustomLink", () => {
  it("stores a bare URL when there is no extra metadata", () => {
    expect(serializeCustomLink("https://example.com")).toBe("https://example.com");
  });

  it("round-trips label and tag through JSON", () => {
    const stored = serializeCustomLink("https://example.com", "Custom", "Tag");
    const parsed = parseCustomLink(stored);
    expect(parsed.label).toBe("Custom");
    expect(parsed.tag).toBe("Tag");
    expect(parsed.url).toBe("https://example.com");
  });
});

describe("dedupeWebsites", () => {
  it("trims blanks and drops case-insensitive duplicates, preserving order", () => {
    expect(
      dedupeWebsites([" https://a.com ", "", "HTTPS://A.COM", "https://b.com"])
    ).toEqual(["https://a.com", "https://b.com"]);
  });

  it("handles undefined input", () => {
    expect(dedupeWebsites(undefined)).toEqual([]);
  });
});

describe("uniqueByUrl", () => {
  it("keeps the first item per normalized URL", () => {
    const items = [
      { name: "a", url: "https://example.com/" },
      { name: "b", url: "https://Example.com" },
      { name: "c", url: "https://other.com" },
    ];
    expect(uniqueByUrl(items, (i) => i.url).map((i) => i.name)).toEqual(["a", "c"]);
  });

  it("never drops items without a URL", () => {
    const items = [{ id: 1 }, { id: 2 }] as { id: number; url?: string }[];
    expect(uniqueByUrl(items, (i) => i.url)).toHaveLength(2);
  });
});

describe("parseCustomLinks", () => {
  it("collapses storage-form, case and trailing-slash variants to one link", () => {
    const parsed = parseCustomLinks([
      "https://example.com",
      JSON.stringify({ url: "https://example.com/", label: "Example" }),
      "HTTPS://EXAMPLE.COM",
      "https://other.com",
    ]);
    expect(parsed.map((p) => p.url)).toEqual(["https://example.com", "https://other.com"]);
  });

  it("keeps the first stored representative", () => {
    const parsed = parseCustomLinks([
      JSON.stringify({ url: "https://example.com", label: "Primary" }),
      "https://example.com/",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].label).toBe("Primary");
  });
});

describe("isSameUrl", () => {
  it("ignores case and trailing slashes", () => {
    expect(isSameUrl("https://Example.com/", "https://example.com")).toBe(true);
    expect(normalizeUrl("HTTPS://Example.com///")).toBe("https://example.com");
  });

  it("does not treat a prefix as equal", () => {
    expect(isSameUrl("https://example.com", "https://example.com/page")).toBe(false);
    expect(isSameUrl("", "https://example.com")).toBe(false);
  });
});

describe("buildUrl", () => {
  it("uses the Steam community URL with an app id", () => {
    const url = buildUrl(makeGame(), "steam", "community", "620");
    expect(url).toBe("https://steamcommunity.com/app/620");
  });

  it("falls back to Steam search without an app id", () => {
    const url = buildUrl(makeGame({ name: "Portal 2" }), "steam", "store", null);
    expect(url).toBe("https://store.steampowered.com/search/?term=Portal%202");
  });

  it("returns custom URLs and serialized metadata targets directly", () => {
    expect(buildUrl(makeGame(), "https://example.com/x")).toBe("https://example.com/x");
    expect(
      buildUrl(makeGame(), JSON.stringify({ url: "https://example.com/y" }))
    ).toBe("https://example.com/y");
  });

  it("searches Google for an unknown source", () => {
    expect(buildUrl(makeGame({ name: "Doom" }), "unknown")).toBe(
      "https://www.google.com/search?q=Doom"
    );
  });
});
