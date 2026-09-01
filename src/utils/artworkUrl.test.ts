import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Game } from "../types/game";
import { isUsableImageUrl, toWebviewAssetUrl, normalizeGameArtworkUrls } from "./artworkUrl";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

const baseGame: Game = {
  id: "g1",
  name: "Test Game",
  path: "/games/test.exe",
  platform: "Local",
  installed: true,
  playTime: "0h",
  addedAt: 0,
};

describe("isUsableImageUrl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts base64 data URLs", () => {
    expect(isUsableImageUrl("data:image/jpeg;base64,abc")).toBe(true);
  });

  it("accepts asset-protocol URLs (asset:, http://asset.localhost/)", () => {
    expect(isUsableImageUrl("asset://localhost/C:/x.png")).toBe(true);
    expect(isUsableImageUrl("http://asset.localhost/C:/x.png")).toBe(true);
    expect(isUsableImageUrl("https://asset.localhost/C:/x.png")).toBe(true);
  });

  it("rejects raw file:// URLs the webview cannot load", () => {
    expect(isUsableImageUrl("file:///C:/Users/a/art.png")).toBe(false);
  });

  it("rejects undefined/null/empty", () => {
    expect(isUsableImageUrl(undefined)).toBe(false);
    expect(isUsableImageUrl(null)).toBe(false);
    expect(isUsableImageUrl("")).toBe(false);
  });
});

describe("toWebviewAssetUrl", () => {
  it("converts a percent-encoded Windows file:// URL to the asset protocol", () => {
    expect(toWebviewAssetUrl("file:///C:/Users/a/My%20Game.png")).toBe(
      "asset://localhost/" + encodeURIComponent("C:/Users/a/My Game.png")
    );
  });

  it("keeps the leading slash of unix-style file:// URLs", () => {
    expect(toWebviewAssetUrl("file:///home/user/game.png")).toBe(
      "asset://localhost/" + encodeURIComponent("/home/user/game.png")
    );
  });

  it("passes through non-file URLs unchanged", () => {
    expect(toWebviewAssetUrl("https://images.example.com/c.jpg")).toBe("https://images.example.com/c.jpg");
    expect(toWebviewAssetUrl("asset://localhost/x.png")).toBe("asset://localhost/x.png");
  });
});

describe("normalizeGameArtworkUrls", () => {
  it("repairs legacy file:// artwork fields on a game row", () => {
    const game: Game = {
      ...baseGame,
      coverArtUrl: "file:///C:/Users/a/cover.jpg",
      iconUrl: "file:///C:/Users/a/icon.png",
      bannerUrl: "https://images.example.com/banner.jpg",
      logoUrl: undefined,
    };
    const result = normalizeGameArtworkUrls(game);
    expect(result.coverArtUrl).toBe("asset://localhost/" + encodeURIComponent("C:/Users/a/cover.jpg"));
    expect(result.iconUrl).toBe("asset://localhost/" + encodeURIComponent("C:/Users/a/icon.png"));
    expect(result.bannerUrl).toBe("https://images.example.com/banner.jpg");
    expect(result.logoUrl).toBeUndefined();
  });

  it("returns the same object when nothing needs repair", () => {
    const game: Game = { ...baseGame, coverArtUrl: "asset://localhost/x.png" };
    expect(normalizeGameArtworkUrls(game)).toBe(game);
  });
});
