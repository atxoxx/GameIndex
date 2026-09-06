import { describe, expect, it } from "vitest";
import {
  compareReleaseToInstalled,
  compareVersions,
  findLatestVersion,
  parseVersionFromTitle,
} from "./gameVersions";

describe("parseVersionFromTitle", () => {
  it("extracts a v-prefixed version", () => {
    expect(parseVersionFromTitle("Game_v1.2.3_[FitGirl]")).toBe("1.2.3");
    expect(parseVersionFromTitle("Game Update v2.1 (Repack)")).toBe("2.1");
    expect(parseVersionFromTitle("V1.5.0 Game")).toBe("1.5.0");
  });

  it("extracts a parenthesised or bracketed version", () => {
    expect(parseVersionFromTitle("Game (v1.0.2) [DODI]")).toBe("1.0.2");
    expect(parseVersionFromTitle("Game [2.4]")).toBe("2.4");
  });

  it("extracts Update, Patch, Build, and Hotfix titles", () => {
    expect(parseVersionFromTitle("Game Update 3 (Repack)")).toBe("3");
    expect(parseVersionFromTitle("Cyberpunk 2077: Update 2.13-RUNE")).toBe("2.13");
    expect(parseVersionFromTitle("Game Patch 1.05")).toBe("1.05");
    expect(parseVersionFromTitle("Game Hotfix #2")).toBe("2");
    expect(parseVersionFromTitle("Game Build 14820")).toBe("14820");
    expect(parseVersionFromTitle("Game b15402")).toBe("15402");
  });

  it("extracts date versions", () => {
    expect(parseVersionFromTitle("Game v20240812")).toBe("20240812");
    expect(parseVersionFromTitle("Game [2024.05]")).toBe("2024.05");
  });

  it("extracts versions with letter suffixes", () => {
    expect(parseVersionFromTitle("Game v1.04b Repack")).toBe("1.04b");
    expect(parseVersionFromTitle("Game (1.2.3a)")).toBe("1.2.3a");
  });

  it("extracts standalone delimited versions", () => {
    expect(parseVersionFromTitle("Game.1.0.5.Repack")).toBe("1.0.5");
    expect(parseVersionFromTitle("Game - 1.4.2 - GOG")).toBe("1.4.2");
  });

  it("returns null when the title has no version", () => {
    expect(parseVersionFromTitle("Cyberpunk 2077")).toBeNull();
    expect(parseVersionFromTitle("")).toBeNull();
    expect(parseVersionFromTitle(null as unknown as string)).toBeNull();
  });

  it("does not treat a bare 4-digit year as a version", () => {
    expect(parseVersionFromTitle("Prototype (2009)")).toBeNull();
    expect(parseVersionFromTitle("Halo 2")).toBeNull();
  });

  it("keeps dotted release components intact", () => {
    expect(parseVersionFromTitle("Game.v1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("1.9", "1.10")).toBe(-1);
    expect(compareVersions("1.10", "1.9")).toBe(1);
  });

  it("treats missing trailing components as zero", () => {
    expect(compareVersions("1.2", "1.2.3")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2")).toBe(1);
    expect(compareVersions("1.2.0.0", "1.2")).toBe(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });

  it("handles comma-separated version strings", () => {
    expect(compareVersions("1, 0, 4, 12", "1.0.4.10")).toBe(1);
    expect(compareVersions("1, 0, 4, 12", "1.0.4.12")).toBe(0);
  });

  it("handles letter suffixes", () => {
    expect(compareVersions("1.04b", "1.04a")).toBe(1);
    expect(compareVersions("1.04a", "1.04b")).toBe(-1);
    expect(compareVersions("1.04b", "1.04")).toBe(1);
  });

  it("handles build numbers and updates", () => {
    expect(compareVersions("Build 14820", "Build 14810")).toBe(1);
    expect(compareVersions("Update 3", "Update 2")).toBe(1);
    expect(compareVersions("Update 4", "Update 4")).toBe(0);
  });

  it("handles date-based versions", () => {
    expect(compareVersions("20240812", "20240801")).toBe(1);
    expect(compareVersions("2024.05", "2024.06")).toBe(-1);
  });
});

describe("findLatestVersion", () => {
  it("picks the newest version across titles", () => {
    expect(
      findLatestVersion([
        "Game v1.2_[FitGirl]",
        "Game v1.2.3_[FitGirl]",
        "Game (v1.0) [DODI]",
      ])
    ).toBe("1.2.3");
  });

  it("picks the newest update across varied release styles", () => {
    expect(
      findLatestVersion([
        "Game Update 2",
        "Game Update 3",
        "Game Update 1",
      ])
    ).toBe("3");
  });

  it("returns null for an empty list or version-less titles", () => {
    expect(findLatestVersion([])).toBeNull();
    expect(findLatestVersion(["Cyberpunk 2077", "Halo 2"])).toBeNull();
  });
});

describe("compareReleaseToInstalled", () => {
  it("determines newer, same, and older releases", () => {
    expect(compareReleaseToInstalled("1.2.3", "1.2.0")).toBe("newer");
    expect(compareReleaseToInstalled("1.2.0", "1.2.0")).toBe("same");
    expect(compareReleaseToInstalled("1.1.0", "1.2.0")).toBe("older");
  });

  it("handles null/undefined gracefully", () => {
    expect(compareReleaseToInstalled(null, "1.2.0")).toBe("unknown");
    expect(compareReleaseToInstalled("1.2.0", null)).toBe("unknown");
    expect(compareReleaseToInstalled(undefined, undefined)).toBe("unknown");
  });
});