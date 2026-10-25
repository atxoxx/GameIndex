import { describe, it, expect } from "vitest";
import {
  buildOverlayNotifications,
  unreadOverlayNotifications,
} from "./overlayNotifications";
import type { AchievementUnlockRecord } from "../../types/game";
import type { TorrentDownload } from "../../types/download";

function unlock(name: string, seconds: number): AchievementUnlockRecord {
  return {
    gameId: "game-1",
    achievement: {
      apiName: name,
      displayName: name,
      description: "",
      icon: "",
      iconGray: "",
      achieved: true,
      unlockTime: seconds,
      percent: 1,
    },
  };
}

function download(name: string, completedAt: number): TorrentDownload {
  return {
    id: `dl-${name}`,
    name,
    completedAt,
    addedAt: completedAt,
  } as TorrentDownload;
}

describe("overlay notifications", () => {
  it("merges both stores newest-first and converts unix seconds", () => {
    const items = buildOverlayNotifications(
      [unlock("Old", 1_700_000_000), unlock("Newer", 1_700_000_100)],
      [download("Download", 1_700_000_050)],
    );

    expect(items.map((item) => item.name)).toEqual([
      "Newer",
      "Download",
      "Old",
    ]);
    expect(items[0].timestamp).toBe(1_700_000_100_000);
    expect(items[1].kind).toBe("download");
  });

  it("returns no unread items for a backlog older than the read marker", () => {
    const items = buildOverlayNotifications(
      Array.from({ length: 6 }, (_, index) =>
        unlock(`Achievement ${index}`, 1_700_000_000 + index),
      ),
      [],
    );
    const readAt = 1_700_000_100_000;

    expect(unreadOverlayNotifications(items, readAt)).toEqual([]);
  });

  it("counts only events newer than the read marker", () => {
    const items = buildOverlayNotifications(
      [unlock("Before", 1_700_000_000), unlock("After", 1_700_000_200)],
      [],
    );

    const unread = unreadOverlayNotifications(items, 1_700_000_100_000);
    expect(unread.map((item) => item.name)).toEqual(["After"]);
  });

  it("ignores events without a usable timestamp", () => {
    const items = buildOverlayNotifications([unlock("Unknown", 0)], []);
    expect(unreadOverlayNotifications(items, 0)).toEqual([]);
  });
});
