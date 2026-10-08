import { describe, expect, it } from "vitest";

import { betaCommand, toLibGames } from "./useBetaIntegration";
import type { BetaSyncedGame } from "../../types/betaStores";

describe("betaCommand", () => {
  it("prefixes the command with the store key", () => {
    expect(betaCommand("battlenet", "start_login")).toBe("battlenet_start_login");
    expect(betaCommand("itch", "sync_library")).toBe("itch_sync_library");
  });
});

describe("toLibGames", () => {
  it("maps synced entries into library games", () => {
    const entries: BetaSyncedGame[] = [
      {
        id: "battlenet-wow",
        title: "World of Warcraft",
        isInstalled: false,
        installPath: "",
        playtimeMinutes: 120,
      },
    ];
    const games = toLibGames(entries, "Battle.net");
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      id: "battlenet-wow",
      name: "World of Warcraft",
      platform: "Battle.net",
      installed: false,
    });
  });

  it("carries install path and installed flag through", () => {
    const games = toLibGames(
      [
        {
          id: "itch-1",
          title: "Indie Gem",
          isInstalled: true,
          installPath: "C:/games/indie",
        },
      ],
      "itch.io"
    );
    expect(games[0].path).toBe("C:/games/indie");
    expect(games[0].installed).toBe(true);
  });

  it("returns an empty list for missing entries", () => {
    expect(toLibGames(undefined, "Xbox")).toEqual([]);
  });

  it("drops entries without an id", () => {
    expect(
      toLibGames([{ id: "", title: "Broken", isInstalled: false }], "Xbox")
    ).toEqual([]);
  });
});
