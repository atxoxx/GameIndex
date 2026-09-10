import { describe, expect, it } from "vitest";
import { pickBackdropArt, steamLibraryHeroUrl } from "./useGameBackdropArt";

describe("pickBackdropArt", () => {
  it("prefers the animated hero and the SGDB static hero", () => {
    const art = pickBackdropArt({
      heroAnimatedUrl: "https://cdn/animated.webp",
      heroUrl: "https://cdn/hero.png",
      bannerUrl: "https://cdn/banner.jpg",
      coverArtUrl: "https://cdn/cover.jpg",
    });

    expect(art.animatedUrl).toBe("https://cdn/animated.webp");
    expect(art.staticUrl).toBe("https://cdn/hero.png");
  });

  it("falls back banner → steam hero → cover when SGDB has no art", () => {
    expect(
      pickBackdropArt({ bannerUrl: "https://cdn/banner.jpg" }).staticUrl,
    ).toBe("https://cdn/banner.jpg");
    expect(
      pickBackdropArt({
        steamHeroUrl: "https://cdn/library_hero.jpg",
        coverArtUrl: "https://cdn/cover.jpg",
      }).staticUrl,
    ).toBe("https://cdn/library_hero.jpg");
    expect(
      pickBackdropArt({ coverArtUrl: "https://cdn/cover.jpg" }).staticUrl,
    ).toBe("https://cdn/cover.jpg");
  });

  it("treats blank strings as missing", () => {
    const art = pickBackdropArt({
      heroAnimatedUrl: "   ",
      heroUrl: "",
      bannerUrl: "  ",
      coverArtUrl: "https://cdn/cover.jpg",
    });

    expect(art.animatedUrl).toBeNull();
    expect(art.staticUrl).toBe("https://cdn/cover.jpg");
  });

  it("returns nulls when nothing is available", () => {
    expect(pickBackdropArt({})).toEqual({ staticUrl: null, animatedUrl: null });
  });
});

describe("steamLibraryHeroUrl", () => {
  it("builds the Steam CDN hero for valid app ids", () => {
    expect(steamLibraryHeroUrl(730)).toBe(
      "https://cdn.akamai.steamstatic.com/steam/apps/730/library_hero.jpg",
    );
  });

  it("rejects missing or invalid app ids", () => {
    expect(steamLibraryHeroUrl(null)).toBeNull();
    expect(steamLibraryHeroUrl(undefined)).toBeNull();
    expect(steamLibraryHeroUrl(0)).toBeNull();
    expect(steamLibraryHeroUrl(Number.NaN)).toBeNull();
  });
});
