import { describe, it, expect } from "vitest";
import type { Game } from "../types/game";
import type { TorrentDownload } from "../types/download";
import {
  browsingHint,
  buildDownloadPresence,
  primaryDownload,
  type BrowsingContext,
} from "./discordPresenceBuild";

const t = (key: string, params?: Record<string, unknown>) => {
  if (!params) return key;
  const rendered = Object.entries(params)
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
  return `${key}(${rendered})`;
};

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-a",
    name: "Alpha",
    path: "C:/games/alpha.exe",
    platform: "Local",
    installed: true,
    playTime: "0h",
    addedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeDownload(overrides: Partial<TorrentDownload> = {}): TorrentDownload {
  return {
    id: "dl-1",
    kind: "torrent",
    name: "Some Game",
    sourceUri: "magnet:?xt=urn:btih:abc",
    savePath: "C:/Downloads",
    downloaded: 420,
    totalSize: 1000,
    progress: 0.42,
    downloadSpeed: 1_000_000,
    uploadSpeed: 0,
    peers: 5,
    seeds: 2,
    status: { kind: "downloading" },
    gameId: null,
    sourceName: "Source",
    addedAt: 1_700_000_000,
    files: [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<BrowsingContext> = {}): BrowsingContext {
  return {
    pathname: "/home",
    games: [],
    wishlistCount: 0,
    installedCount: 0,
    storePlatforms: [],
    modsGameName: null,
    storeGameName: null,
    storeGameArt: null,
    bigScreen: false,
    ...overrides,
  };
}

describe("browsingHint", () => {
  it("reports library size and installed count", () => {
    const hint = browsingHint(
      makeCtx({
        pathname: "/library",
        games: [makeGame(), makeGame({ id: "b" })],
        installedCount: 1,
      }),
      t,
    );
    expect(hint.details).toBe("discordPresence.browsingLibraryInstalled(count=2,installed=1)");
  });

  it("falls back to the plain library line when nothing is installed", () => {
    const hint = browsingHint(
      makeCtx({ pathname: "/library", games: [makeGame()], installedCount: 0 }),
      t,
    );
    expect(hint.details).toBe("discordPresence.browsingLibrary(count=1)");
  });

  it("attaches cover art and a link on a game detail page", () => {
    const game = makeGame({
      id: "hk",
      name: "Hollow Knight",
      coverSourceUrl: "https://cdn.example/hk.jpg",
      websites: ["https://hollowknight.com"],
    });
    const hint = browsingHint(makeCtx({ pathname: "/library/hk", games: [game] }), t);
    expect(hint.details).toBe("discordPresence.browsingGamePage(game=Hollow Knight)");
    expect(hint.largeImage).toBe("https://cdn.example/hk.jpg");
    expect(hint.detailsUrl).toBe("https://hollowknight.com");
    expect(hint.largeUrl).toBe("https://hollowknight.com");
  });

  it("includes the wishlist count", () => {
    const hint = browsingHint(makeCtx({ pathname: "/wishlist", wishlistCount: 7 }), t);
    expect(hint.details).toBe("discordPresence.browsingWishlist(count=7)");
  });

  it("uses the real store title when published, else the slug", () => {
    expect(
      browsingHint(
        makeCtx({ pathname: "/store/hollow-knight", storeGameName: "Hollow Knight" }),
        t,
      ).details,
    ).toBe("discordPresence.storeGamePage(game=Hollow Knight)");
    expect(
      browsingHint(makeCtx({ pathname: "/store/hollow-knight" }), t).details,
    ).toBe("discordPresence.storeGamePage(game=hollow knight)");
  });

  it("attaches the published store cover art to the store page hint", () => {
    const hint = browsingHint(
      makeCtx({
        pathname: "/store/hollow-knight",
        storeGameName: "Hollow Knight",
        storeGameArt: "https://cdn.example/hk-cover.jpg",
      }),
      t,
    );
    expect(hint.largeImage).toBe("https://cdn.example/hk-cover.jpg");
    expect(hint.largeText).toBe("Hollow Knight");
  });

  it("drops a non-https store cover instead of sending an unusable asset", () => {
    const hint = browsingHint(
      makeCtx({
        pathname: "/store/hollow-knight",
        storeGameArt: "data:image/png;base64,AAAA",
      }),
      t,
    );
    expect(hint.largeImage).toBeUndefined();
  });

  it("shows a library count on the home route", () => {
    expect(browsingHint(makeCtx({ pathname: "/home", games: [makeGame()] }), t).details).toBe(
      "discordPresence.browsingAppCount(count=1)",
    );
  });

  it("names Big Screen mode when active", () => {
    expect(
      browsingHint(makeCtx({ pathname: "/library", bigScreen: true }), t).details,
    ).toBe("discordPresence.bigScreen");
  });

  it("matches settings sub-tabs", () => {
    expect(browsingHint(makeCtx({ pathname: "/settings/discord" }), t).details).toBe(
      "discordPresence.browsingSettings",
    );
  });

  it("falls back to the app label for unknown routes", () => {
    expect(browsingHint(makeCtx({ pathname: "/totally-unknown" }), t).details).toBe(
      "discordPresence.browsingApp",
    );
  });
});

describe("primaryDownload", () => {
  it("prefers an actively downloading transfer over queued ones", () => {
    const queued = makeDownload({ id: "q", status: { kind: "queued" } });
    const live = makeDownload({ id: "live", status: { kind: "downloading" } });
    expect(primaryDownload([queued, live])?.id).toBe("live");
  });

  it("picks the metadata fetch over a plain queued item", () => {
    const queued = makeDownload({ id: "q", status: { kind: "queued" } });
    const meta = makeDownload({ id: "m", status: { kind: "fetchingMetadata" } });
    expect(primaryDownload([queued, meta])?.id).toBe("m");
  });

  it("ignores paused, seeding and errored downloads", () => {
    const downloads = [
      makeDownload({ id: "p", status: { kind: "paused" } }),
      makeDownload({ id: "s", status: { kind: "seeding" } }),
      makeDownload({ id: "e", status: { kind: "error", message: "boom" } }),
    ];
    expect(primaryDownload(downloads)).toBeUndefined();
  });
});

describe("buildDownloadPresence", () => {
  const NOW = 1_700_000_000_000;

  it("shows progress, speed, a queue party and an ETA countdown", () => {
    const payload = buildDownloadPresence(makeDownload(), 2, 5, t, "state", NOW);

    expect(payload.state).toBe("downloading");
    expect(payload.details).toBe("discordPresence.downloading(game=Some Game)");
    expect(payload.stateText).toContain("42%");
    expect(payload.partyId).toBe("gamelib-downloads");
    expect(payload.partyCurrent).toBe(2);
    expect(payload.partyMax).toBe(5);
    expect(payload.statusDisplay).toBe("state");
    // 580 bytes left at 1 MB/s rounds to a 1s countdown.
    expect(payload.endsAt).toBe(NOW + 1000);
  });

  it("uses the queued wording, a scheduled countdown, and omits the party", () => {
    const startAt = Math.floor((NOW + 60_000) / 1000);
    const payload = buildDownloadPresence(
      makeDownload({
        progress: null,
        downloadSpeed: 0,
        status: { kind: "queued" },
        scheduledStartAt: startAt,
      }),
      1,
      1,
      t,
      "details",
      NOW,
    );

    expect(payload.details).toBe("discordPresence.downloadingQueued(game=Some Game)");
    expect(payload.stateText).toBe("discordPresence.downloadQueuedState");
    expect(payload.partyId).toBeUndefined();
    expect(payload.partyCurrent).toBeUndefined();
    expect(payload.endsAt).toBe(startAt * 1000);
  });

  it("omits the countdown when there is no ETA or schedule", () => {
    const payload = buildDownloadPresence(
      makeDownload({ progress: null, downloadSpeed: 0, totalSize: null, status: { kind: "queued" } }),
      1,
      1,
      t,
      "details",
      NOW,
    );
    expect(payload.endsAt).toBeUndefined();
  });

  it("drops a base64 poster instead of sending an unusable asset", () => {
    const payload = buildDownloadPresence(
      makeDownload({ gamePoster: "data:image/png;base64,AAAA" }),
      1,
      1,
      t,
      "details",
      NOW,
    );
    expect(payload.largeImage).toBeUndefined();
  });
});
