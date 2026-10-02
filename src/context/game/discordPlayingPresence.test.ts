import { describe, it, expect } from "vitest";
import type { Game } from "../../types/game";
import {
  buildPlayingPresence,
  discordAsset,
  discordGameLogo,
  discordPoster,
  discordStoreUrl,
  discordWebsiteUrl,
  type TranslateFn,
} from "./discordPlayingPresence";

/** Translate stub that renders params deterministically as `key(a=b,c=d)`. */
const t: TranslateFn = (key, params) => {
  if (!params) return key;
  const rendered = Object.entries(params)
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
  return `${key}(${rendered})`;
};

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-a",
    name: "Hollow Knight",
    path: "C:/games/hk.exe",
    platform: "Steam",
    installed: true,
    playTime: "12h 30m",
    addedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const ALL_ON = {
  startedAt: 1_700_000_000_000,
  showArt: true,
  showPlaytime: true,
  showWebsiteButton: true,
  showStoreButton: true,
  showExtraDetails: true,
  showAchievements: true,
  statusDisplay: "details" as const,
};

describe("buildPlayingPresence", () => {
  it("builds a rich payload with art, timer, links and two buttons", () => {
    const game = makeGame({
      coverSourceUrl: "https://cdn.example/hk.jpg",
      iconUrl: "https://cdn.example/hk-icon.png",
      websites: ["https://hollowknight.com"],
      steamAppId: 367520,
    });

    const payload = buildPlayingPresence(game, game.id, game.name, ALL_ON, t);

    expect(payload.state).toBe("playing");
    expect(payload.details).toBe("Hollow Knight");
    expect(payload.startedAt).toBe(ALL_ON.startedAt);
    expect(payload.detailsUrl).toBe("https://hollowknight.com");
    expect(payload.largeImage).toBe("https://cdn.example/hk.jpg");
    expect(payload.smallImage).toBe(
      "https://cdn.cloudflare.steamstatic.com/steam/apps/367520/logo.png",
    );
    expect(payload.stateText).toContain("discordPresence.playingVia(platform=Steam)");
    expect(payload.stateText).toContain("discordPresence.playtimeTotal(time=12h 30m)");
    expect(payload.buttonUrl).toBe("https://hollowknight.com");
    expect(payload.button2Url).toBe("https://store.steampowered.com/app/367520");
    expect(payload.largeUrl).toBe("https://hollowknight.com");
    expect(payload.smallUrl).toBe("https://store.steampowered.com/app/367520");
    expect(payload.statusDisplay).toBe("details");
  });

  it("adds achievement progress and rich credits when those options are on", () => {
    const game = makeGame({
      developer: "Team Cherry",
      releaseDate: "2017-02-24",
      version: "1.5.78.11833",
    });

    const payload = buildPlayingPresence(
      game,
      game.id,
      game.name,
      { ...ALL_ON, achievement: { unlocked: 18, total: 25 } },
      t,
    );

    expect(payload.stateText).toContain(
      "discordPresence.achievementsProgress(unlocked=18,total=25,percent=72)",
    );
    expect(payload.largeText).toBe("Hollow Knight · Team Cherry, 2017");
    expect(payload.smallText).toBe("1.5.78.11833");
  });

  it("lets a fresh unlock flash replace the whole status line", () => {
    const game = makeGame({ developer: "Team Cherry" });
    const payload = buildPlayingPresence(
      game,
      game.id,
      game.name,
      {
        ...ALL_ON,
        unlockText: "🏆 Achievement unlocked: Pure Vessel",
        achievement: { unlocked: 18, total: 25 },
      },
      t,
    );

    expect(payload.stateText).toBe("🏆 Achievement unlocked: Pure Vessel");
  });

  it("omits achievement progress when no summary is available", () => {
    const payload = buildPlayingPresence(
      makeGame(),
      "game-a",
      "Hollow Knight",
      ALL_ON,
      t,
    );
    expect(payload.stateText).not.toContain("achievementsProgress");
  });

  it("drops data-URI artwork and buttons when the game has no public URLs", () => {
    const game = makeGame({
      coverArtUrl: "data:image/png;base64,AAAA",
      iconUrl: "data:image/png;base64,BBBB",
      logoUrl: "data:image/png;base64,CCCC",
    });

    const payload = buildPlayingPresence(game, game.id, game.name, ALL_ON, t);

    expect(payload.largeImage).toBeUndefined();
    expect(payload.smallImage).toBeUndefined();
    expect(payload.detailsUrl).toBeUndefined();
    expect(payload.buttonUrl).toBeUndefined();
    expect(payload.button2Url).toBeUndefined();
  });

  it("falls back to the poster for the small badge when no logo exists", () => {
    const game = makeGame({ coverSourceUrl: "https://cdn.example/hk.jpg" });

    const payload = buildPlayingPresence(game, game.id, game.name, ALL_ON, t);

    expect(payload.largeImage).toBe("https://cdn.example/hk.jpg");
    expect(payload.smallImage).toBe("https://cdn.example/hk.jpg");
  });

  it("prefers a stored public logo over the Steam CDN", () => {
    const game = makeGame({
      logoUrl: "https://cdn.example/hk-logo.png",
      coverSourceUrl: "https://cdn.example/hk.jpg",
      steamAppId: 367520,
    });

    const payload = buildPlayingPresence(game, game.id, game.name, ALL_ON, t);

    expect(payload.smallImage).toBe("https://cdn.example/hk-logo.png");
  });

  it("omits the small badge when art is disabled", () => {
    const game = makeGame({
      coverSourceUrl: "https://cdn.example/hk.jpg",
      logoUrl: "https://cdn.example/hk-logo.png",
    });

    const payload = buildPlayingPresence(
      game,
      game.id,
      game.name,
      { ...ALL_ON, showArt: false },
      t,
    );

    expect(payload.largeImage).toBeUndefined();
    expect(payload.smallImage).toBeUndefined();
  });

  it("omits the session timer and website link when those options are off", () => {
    const game = makeGame({ websites: ["https://hollowknight.com"] });

    const payload = buildPlayingPresence(
      game,
      game.id,
      game.name,
      { ...ALL_ON, showPlaytime: false, showWebsiteButton: false },
      t,
    );

    expect(payload.startedAt).toBe(0);
    expect(payload.stateText).toBe("discordPresence.playingVia(platform=Steam)");
    expect(payload.buttonUrl).toBeUndefined();
    expect(payload.detailsUrl).toBeUndefined();
  });

  it("does not add a store button that duplicates the website button", () => {
    const storeUrl = "https://store.steampowered.com/app/367520";
    const game = makeGame({
      websites: [storeUrl],
      steamAppId: 367520,
    });

    const payload = buildPlayingPresence(game, game.id, game.name, ALL_ON, t);

    expect(payload.buttonUrl).toBe(storeUrl);
    expect(payload.button2Url).toBeUndefined();
  });

  it("still builds a payload when the watcher names an unknown game", () => {
    const payload = buildPlayingPresence(undefined, "", "Mystery Game", ALL_ON, t);

    expect(payload.details).toBe("Mystery Game");
    expect(payload.largeImage).toBeUndefined();
    expect(payload.stateText).toBe("discordPresence.playingState");
  });
});

describe("discord URL helpers", () => {
  it("promotes protocol-relative URLs and rejects data URIs", () => {
    expect(discordAsset("//cdn.example/art.jpg")).toBe("https://cdn.example/art.jpg");
    expect(discordAsset("data:image/png;base64,AAAA")).toBeUndefined();
    expect(discordAsset(undefined)).toBeUndefined();
  });

  it("prefers the first https website, then falls back to metadataUrl", () => {
    expect(discordWebsiteUrl(makeGame({ websites: ["http://x", "https://good"] }))).toBe(
      "https://good",
    );
    expect(
      discordWebsiteUrl(makeGame({ metadataUrl: "https://meta.example/game" })),
    ).toBe("https://meta.example/game");
    expect(discordWebsiteUrl(undefined)).toBeUndefined();
  });

  it("only derives a store URL from a Steam app id", () => {
    expect(discordStoreUrl(makeGame({ steamAppId: 42 }))).toBe(
      "https://store.steampowered.com/app/42",
    );
    expect(discordStoreUrl(makeGame({ gogGameId: "1207658925" }))).toBeUndefined();
  });

  it("derives a Steam CDN logo and prefers a stored public logo", () => {
    expect(discordGameLogo(makeGame({ steamAppId: 367520 }))).toBe(
      "https://cdn.cloudflare.steamstatic.com/steam/apps/367520/logo.png",
    );
    expect(
      discordGameLogo(makeGame({ logoUrl: "https://cdn.example/l.png", steamAppId: 1 })),
    ).toBe("https://cdn.example/l.png");
    expect(discordGameLogo(makeGame({ logoUrl: "asset://localhost/l.png" }))).toBeUndefined();
  });

  it("uses the public cover source as the poster", () => {
    expect(discordPoster(makeGame({ coverSourceUrl: "https://cdn.example/c.jpg" }))).toBe(
      "https://cdn.example/c.jpg",
    );
    expect(discordPoster(makeGame({ coverArtUrl: "asset://localhost/c.jpg" }))).toBeUndefined();
  });
});
