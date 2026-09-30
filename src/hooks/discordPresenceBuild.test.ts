import { describe, it, expect } from "vitest";
import type { Game } from "../types/game";
import type { TorrentDownload } from "../types/download";
import {
  browsingHint,
  buildDownloadPresence,
  primaryDownload,
  type PresencePayload,
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

describe("browsingHint", () => {
  it("reports the library size on the library route", () => {
    const hint = browsingHint("/library", [makeGame(), makeGame({ id: "b" })], 0, [], null, t);
    expect(hint.details).toBe("discordPresence.browsingLibrary(count=2)");
  });

  it("attaches cover art and a link on a game detail page", () => {
    const game = makeGame({
      id: "hk",
      name: "Hollow Knight",
      coverSourceUrl: "https://cdn.example/hk.jpg",
      websites: ["https://hollowknight.com"],
    });
    const hint = browsingHint("/library/hk", [game], 0, [], null, t);
    expect(hint.details).toBe("discordPresence.browsingGamePage(game=Hollow Knight)");
    expect(hint.largeImage).toBe("https://cdn.example/hk.jpg");
    expect(hint.detailsUrl).toBe("https://hollowknight.com");
  });

  it("includes the wishlist count", () => {
    const hint = browsingHint("/wishlist", [], 7, [], null, t);
    expect(hint.details).toBe("discordPresence.browsingWishlist(count=7)");
  });

  it("humanises a store detail slug", () => {
    const hint = browsingHint("/store/hollow-knight", [], 0, [], null, t);
    expect(hint.details).toBe("discordPresence.storeGamePage(game=hollow knight)");
  });

  it("matches settings sub-tabs", () => {
    expect(browsingHint("/settings/discord", [], 0, [], null, t).details).toBe(
      "discordPresence.browsingSettings",
    );
  });

  it("falls back to the app label for unknown routes", () => {
    expect(browsingHint("/totally-unknown", [], 0, [], null, t).details).toBe(
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
  it("shows progress, speed and a queue party for an active transfer", () => {
    const payload: PresencePayload = buildDownloadPresence(
      makeDownload(),
      2,
      5,
      t,
      "state",
    );

    expect(payload.state).toBe("downloading");
    expect(payload.details).toBe("discordPresence.downloading(game=Some Game)");
    expect(payload.stateText).toContain("42%");
    expect(payload.partyId).toBe("gamelib-downloads");
    expect(payload.partyCurrent).toBe(2);
    expect(payload.partyMax).toBe(5);
    expect(payload.statusDisplay).toBe("state");
  });

  it("uses the queued wording and omits the party for a single queued item", () => {
    const payload = buildDownloadPresence(
      makeDownload({
        progress: null,
        downloadSpeed: 0,
        status: { kind: "queued" },
      }),
      1,
      1,
      t,
      "details",
    );

    expect(payload.details).toBe("discordPresence.downloadingQueued(game=Some Game)");
    expect(payload.stateText).toBe("discordPresence.downloadQueuedState");
    expect(payload.partyId).toBeUndefined();
    expect(payload.partyCurrent).toBeUndefined();
  });

  it("drops a base64 poster instead of sending an unusable asset", () => {
    const payload = buildDownloadPresence(
      makeDownload({ gamePoster: "data:image/png;base64,AAAA" }),
      1,
      1,
      t,
      "details",
    );
    expect(payload.largeImage).toBeUndefined();
  });
});
