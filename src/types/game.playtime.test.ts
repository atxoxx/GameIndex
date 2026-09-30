import { describe, it, expect } from "vitest";
import { formatSyncedPlayTime } from "./game";

describe("formatSyncedPlayTime", () => {
  it("renders store playtime so it can overwrite an imported value", () => {
    expect(formatSyncedPlayTime(90)).toBe("1h 30m");
    expect(formatSyncedPlayTime(120)).toBe("2h");
    expect(formatSyncedPlayTime(45)).toBe("45m");
  });

  it("returns null when the store reports no playtime", () => {
    expect(formatSyncedPlayTime(0)).toBeNull();
    expect(formatSyncedPlayTime(undefined)).toBeNull();
    expect(formatSyncedPlayTime(null)).toBeNull();
  });
});
