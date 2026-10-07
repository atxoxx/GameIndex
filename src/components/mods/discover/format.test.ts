import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCount,
  formatRemoteDate,
  htmlToText,
  sourceLabel,
} from "./format";

describe("mods discover format helpers", () => {
  it("formats counts with k/M suffixes", () => {
    expect(formatCount(undefined)).toBe("—");
    expect(formatCount(42)).toBe("42");
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(2_500_000)).toBe("2.5M");
  });

  it("formats byte sizes and hides empty values", () => {
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("normalizes unix-second, millisecond and ISO timestamps", () => {
    expect(formatRemoteDate(undefined)).toBeNull();
    expect(formatRemoteDate("")).toBeNull();
    expect(formatRemoteDate("not-a-date")).toBeNull();
    expect(formatRemoteDate("1700000000")).not.toBeNull();
    expect(formatRemoteDate("1700000000000")).not.toBeNull();
    expect(formatRemoteDate("2024-01-02T03:04:05Z")).not.toBeNull();
  });

  it("strips html and decodes common entities", () => {
    expect(htmlToText("<p>Hello &amp; welcome</p>Line 2")).toBe(
      "Hello & welcome\nLine 2",
    );
    expect(htmlToText("<p>Hello &amp; welcome</p><br/>Line 2")).toBe(
      "Hello & welcome\n\nLine 2",
    );
    expect(htmlToText(undefined)).toBe("");
  });

  it("maps source ids to display labels with a fallback", () => {
    expect(sourceLabel("nexus")).toBe("Nexus Mods");
    expect(sourceLabel("workshop")).toBe("Steam Workshop");
    expect(sourceLabel("unknown-site")).toBe("unknown-site");
  });
});
