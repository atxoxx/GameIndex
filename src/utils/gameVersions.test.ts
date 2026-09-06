import { describe, expect, it } from "vitest";
import {
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

  it("returns null for an empty list or version-less titles", () => {
    expect(findLatestVersion([])).toBeNull();
    expect(findLatestVersion(["Cyberpunk 2077", "Halo 2"])).toBeNull();
  });
});