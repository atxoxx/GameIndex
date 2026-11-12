/**
 * Row ↔ `Game` mapping tests.
 *
 * These are the pure helpers behind `state/libraryStore.ts`; a mis-ordered or
 * mistyped column would corrupt the library silently, so the matrix is pinned
 * here instead of only being exercised by the app.
 */
import { describe, expect, it } from "vitest";
import {
  GAME_COLUMNS,
  decodeGame,
  encodeGame,
  extraJsonOf,
  mergeGameRecords,
  toSummaryGame,
} from "../../../electron/main/state/db/gameRows";
import type { Game } from "../../types/game";

/** Build a row object the way better-sqlite3 returns one (column-name keys). */
function rowFrom(game: Game): Record<string, unknown> {
  const encoded = encodeGame(game);
  return { ...encoded.values, extra_json: extraJsonOf(encoded) };
}

describe("game row mapping", () => {
  it("round-trips every field of a fully populated game", () => {
    const game: Game = {
      id: "g1",
      name: "Test Game",
      displayName: "My Label",
      path: "C:\\Games\\test.exe",
      platform: "Steam",
      installed: true,
      playTime: "12h",
      addedAt: 1700000000000,
      lastPlayed: 1710000000000,
      coverArtUrl: "data:image/png;base64,AAAA",
      coverSourceUrl: "https://images.igdb.com/cover.jpg",
      iconUrl: "icon",
      bannerUrl: "banner",
      logoUrl: "logo",
      logoSourceUrl: "https://images.igdb.com/logo.png",
      notes: "notes",
      sizeBytes: 123456789,
      sizeDetectedAt: "2024-01-01T00:00:00.000Z",
      sizeRootPath: "C:\\Games",
      modsFolder: "C:\\Games\\mods",
      modsSizeBytes: 4096,
      modsDetectedAt: "2024-01-02T00:00:00.000Z",
      description: "desc",
      developer: "dev",
      publisher: "pub",
      releaseDate: "2020-01-01",
      metadataSource: "IGDB",
      metadataUrl: "https://igdb.com/games/test",
      storyline: "story",
      igdbRating: 88.1,
      criticRating: 77,
      igdbId: 1942,
      steamAppId: 440,
      steamPlaytime: 600,
      gogGameId: "1207658925",
      gogPlaytime: 90,
      storeSource: "steam",
      epicNamespace: "ns",
      epicCatalogItemId: "cat",
      launchArguments: "-windowed",
      runAsAdmin: false,
      showSteamLaunchSelection: true,
      preLaunchScript: "echo hi",
      preLaunchAdmin: true,
      postExitScript: "echo bye",
      postExitAdmin: false,
      companionApps: [{ path: "C:\\overlay.exe", delayMs: 2000 }],
      extraExecutables: [{ path: "C:\\alt.exe", label: "Alt" }],
      purchaseCost: 59.99,
      purchaseCurrency: "USD",
      mo2LaunchEnabled: true,
      mo2Profile: "Default",
      mo2Executable: "SKSE64.exe",
      mo2InstancePath: "C:\\MO2",
      emulatorId: "emu1",
      romPath: "C:\\roms\\game.zip",
      romHash: "cafebabe",
      romRegion: "USA",
      romLanguage: "En",
      romGroup: "Group",
      romDisc: 2,
      romArchived: true,
      favorite: true,
      compatNotes: "use Vulkan",
      romProfile: { graphicsBackend: "vulkan", fullscreen: true },
      playStatus: "playing",
      genres: ["Action", "RPG"],
      themes: ["Fantasy"],
      gameModes: ["Single player"],
      playerPerspectives: ["Third person"],
      screenshots: ["s1", "s2"],
      videos: ["v1"],
      websites: ["https://example.com"],
      timeToBeat: { normally: 3600 },
      similarGames: [{ id: 7, name: "Similar" }],
      releases: [{ platform: "PC", dateStr: "2020", region: "WW" }],
      igdbReviews: [{ title: "Review" }],
      alternativeNames: ["Alt name"],
      steamAchievements: [
        {
          apiname: "a",
          name: "A",
          description: "",
          achieved: true,
          unlocktime: 0,
        },
      ],
      languageSupports: [{ language: "English", supportType: "full" }],
      collection: "Series",
      collectionId: 420,
      franchise: "Franchise",
      gameCategory: "game",
      releaseStatus: "released",
      version: "1.0.4",
      compatibility: { enabled: true, runnerType: "proton" },
      isVr: true,
      // Fields the Rust column set does not know about.
      detectedExe: "C:\\detected.exe",
      humbleGameId: "humble_1",
      humbleIsTrove: true,
      humbleIsExtra: false,
      rockstarTitleId: "gta5",
      uplayGameId: "42",
      uplayIsConnect: true,
      familySharedBy: "friend",
      rating: 4,
      reviewText: "great",
      untracked: true,
    };

    const decoded = decodeGame(rowFrom(game));
    expect(decoded).toEqual(game);
  });

  it("keeps absent optional fields absent and explicit nulls as null", () => {
    const game = {
      id: "g2",
      name: "Sparse",
      path: "",
      platform: "Local",
      installed: false,
      playTime: "0h",
      addedAt: 1,
      favorite: false,
      lastPlayed: null,
      notes: null,
    } as unknown as Game;

    const decoded = decodeGame(rowFrom(game));
    expect(decoded.favorite).toBe(false);
    expect("lastPlayed" in decoded).toBe(true);
    expect(decoded.lastPlayed).toBeNull();
    expect(decoded.notes).toBeNull();
    expect("screenshots" in decoded).toBe(false);
  });

  it("coerces a value that does not match its column into the passthrough", () => {
    // A string where an integer belongs used to be possible in the JSON era.
    const decoded = decodeGame(rowFrom({ id: "g3", steamAppId: "440" } as unknown as Game));
    expect(decoded.steamAppId).toBe("440");
  });

  it("summary drops exactly the seven heavy fields", () => {
    const game: Game = {
      id: "g4",
      name: "Heavy",
      path: "",
      platform: "Local",
      installed: true,
      playTime: "1h",
      addedAt: 1,
      genres: ["Action"],
      screenshots: ["s"],
      videos: ["v"],
      similarGames: [{ id: 1, name: "x" }],
      releases: [{ platform: "PC", dateStr: "2020", region: "WW" }],
      igdbReviews: [{ title: "r" }],
      languageSupports: [{ language: "English", supportType: "full" }],
      steamAchievements: [
        { apiname: "a", name: "A", description: "", achieved: true, unlocktime: 0 },
      ],
    };
    const summary = toSummaryGame(game);
    expect(summary.genres).toEqual(["Action"]);
    for (const key of [
      "screenshots",
      "videos",
      "similarGames",
      "releases",
      "igdbReviews",
      "languageSupports",
      "steamAchievements",
    ]) {
      expect(key in summary).toBe(false);
    }
  });

  it("decodes a partial historical row (missing columns) without inventing values", () => {
    const decoded = decodeGame({
      id: "legacy",
      name: "Legacy",
      path: "",
      platform: "GOG",
      installed: 1,
      play_time: "0h",
      added_at: 1600000000000,
      genres_json: '["RPG"]',
      screenshots_json: '["old"]',
    });
    expect(decoded).toEqual({
      id: "legacy",
      name: "Legacy",
      path: "",
      platform: "GOG",
      installed: true,
      playTime: "0h",
      addedAt: 1600000000000,
      genres: ["RPG"],
      screenshots: ["old"],
    });
  });

  it("ignores an unparseable JSON column instead of throwing", () => {
    const decoded = decodeGame({ id: "bad", genres_json: "{not json" });
    expect("genres" in decoded).toBe(false);
  });

  it("merges a payload over the stored row, skipping explicit undefined", () => {
    const stored: Game = {
      id: "g5",
      name: "Stored",
      path: "",
      platform: "Local",
      installed: true,
      playTime: "1h",
      addedAt: 1,
      screenshots: ["keep-me"],
      notes: "old",
    };
    const merged = mergeGameRecords(stored, {
      id: "g5",
      name: "Renamed",
      screenshots: undefined,
      notes: undefined,
      lastPlayed: 5,
    } as unknown as Game);
    expect(merged.name).toBe("Renamed");
    expect(merged.screenshots).toEqual(["keep-me"]);
    expect(merged.notes).toBe("old");
    expect(merged.lastPlayed).toBe(5);
  });

  it("maps each column exactly once", () => {
    const columns = GAME_COLUMNS.map((column) => column.column);
    expect(new Set(columns).size).toBe(columns.length);
    const fields = GAME_COLUMNS.map((column) => column.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});
