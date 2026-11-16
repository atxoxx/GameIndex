// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  digestToSha256,
  isNewerVersion,
  portableVersionFromName,
} from "./version";

describe("updater version helpers", () => {
  it("compares semver numerically and ignores channel suffixes", () => {
    expect(isNewerVersion("2.4.1", "2.4.0")).toBe(true);
    expect(isNewerVersion("2.10.0", "2.9.9")).toBe(true);
    expect(isNewerVersion("2.4.0", "2.4.0")).toBe(false);
    expect(isNewerVersion("v2.4.0-electron", "2.3.9")).toBe(true);
    expect(isNewerVersion("2.3.9", "2.4.0")).toBe(false);
  });

  it("reads the version out of a portable artifact name", () => {
    expect(portableVersionFromName("GameIndex_electron_2.4.1_x64_portable.exe")).toBe(
      "2.4.1",
    );
    expect(portableVersionFromName("GameIndex_electron_2.4.0_x64-setup.exe")).toBeNull();
    expect(portableVersionFromName(null)).toBeNull();
  });

  it("normalizes GitHub's sha256 digest and rejects other shapes", () => {
    const hash = "a".repeat(64);
    expect(digestToSha256(`sha256:${hash}`)).toBe(hash);
    expect(digestToSha256(hash.toUpperCase())).toBe(hash);
    expect(digestToSha256("md5:abc")).toBeNull();
    expect(digestToSha256(null)).toBeNull();
  });
});
