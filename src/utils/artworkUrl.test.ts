import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Game } from "../types/game";
import {
  isUsableImageUrl,
  toWebviewAssetUrl,
  normalizeGameArtworkUrls,
  safeArtworkUrl,
  thumbVariantUrl,
  resolveGameLogo,
} from "./artworkUrl";

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

describe("safeArtworkUrl", () => {
  it("returns null for falsy or empty inputs", () => {
    expect(safeArtworkUrl(undefined)).toBeNull();
    expect(safeArtworkUrl(null)).toBeNull();
    expect(safeArtworkUrl("")).toBeNull();
    expect(safeArtworkUrl("   ")).toBeNull();
  });

  it("converts file:// URLs via toWebviewAssetUrl", () => {
    expect(safeArtworkUrl("file:///C:/Users/a/cover.png")).toBe(
      "asset://localhost/" + encodeURIComponent("C:/Users/a/cover.png")
    );
  });

  it("leaves http, https, data, and asset URLs untouched", () => {
    expect(safeArtworkUrl("https://images.example.com/art.jpg")).toBe("https://images.example.com/art.jpg");
    expect(safeArtworkUrl("http://asset.localhost/art.jpg")).toBe("http://asset.localhost/art.jpg");
    expect(safeArtworkUrl("data:image/png;base64,123")).toBe("data:image/png;base64,123");
  });

  it("converts raw local file paths via convertFileSrc", () => {
    expect(safeArtworkUrl("C:\\games\\icon.png")).toBe(
      "asset://localhost/" + encodeURIComponent("C:\\games\\icon.png")
    );
  });
});

describe("thumbVariantUrl", () => {
  it("rewrites a local grid cover to its _thumb.webp sibling", () => {
    expect(thumbVariantUrl("asset://localhost/artwork/g1/cover.png")).toBe(
      "asset://localhost/artwork/g1/cover_thumb.webp"
    );
    expect(thumbVariantUrl("http://asset.localhost/artwork/g1/banner.jpg")).toBe(
      "http://asset.localhost/artwork/g1/banner_thumb.webp"
    );
  });

  it("handles percent-encoded Windows separators from convertFileSrc", () => {
    const url = "asset://localhost/" + encodeURIComponent("C:\\app\\artwork\\g1\\cover.jpg");
    expect(thumbVariantUrl(url)).toBe(
      "asset://localhost/" + encodeURIComponent("C:\\app\\artwork\\g1\\") + "cover_thumb.webp"
    );
  });

  it("returns null for remote, non-grid, or empty URLs", () => {
    expect(thumbVariantUrl("https://cdn.example.com/cover.jpg")).toBeNull();
    expect(thumbVariantUrl("asset://localhost/artwork/g1/logo.png")).toBeNull();
    expect(thumbVariantUrl(undefined)).toBeNull();
    expect(thumbVariantUrl(null)).toBeNull();
  });
});

describe("resolveGameLogo", () => {
  it("returns null when game is undefined or null", () => {
    expect(resolveGameLogo(undefined)).toBeNull();
    expect(resolveGameLogo(null)).toBeNull();
  });

  it("prefers explicit logoUrl when present", () => {
    const game: Game = {
      ...baseGame,
      logoUrl: "https://example.com/logo.png",
      steamAppId: 1234,
    };
    expect(resolveGameLogo(game)).toBe("https://example.com/logo.png");
  });

  it("falls back to Steam CDN logo when steamAppId is present", () => {
    const game: Game = {
      ...baseGame,
      logoUrl: undefined,
      steamAppId: 105600,
    };
    expect(resolveGameLogo(game)).toBe("https://cdn.cloudflare.steamstatic.com/steam/apps/105600/logo.png");
  });

  it("returns null when neither logoUrl nor steamAppId are present", () => {
    const game: Game = {
      ...baseGame,
      logoUrl: undefined,
      steamAppId: undefined,
    };
    expect(resolveGameLogo(game)).toBeNull();
  });
});
