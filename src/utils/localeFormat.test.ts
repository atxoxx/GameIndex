import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
} from "./localeFormat";

// Noon UTC keeps the calendar day stable in every test timezone.
const NOON = new Date("2026-11-18T12:00:00Z");

describe("localeFormat", () => {
  it("formats a date with the requested locale", () => {
    const en = formatDate(NOON, "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const fr = formatDate(NOON, "fr-FR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(en).toBe("Nov 18, 2026");
    expect(fr).not.toBe(en);
    expect(fr).toContain("2026");
  });

  it("formats date and time together", () => {
    const value = formatDateTime(NOON, "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    expect(value).toBe("Nov 18, 2026, 12:00");
  });

  it("formats a standalone clock time", () => {
    expect(
      formatTime(NOON, "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }),
    ).toBe("12:00");
  });

  it("returns an empty string for invalid dates", () => {
    expect(formatDate("not a date", "en")).toBe("");
    expect(formatDateTime(Number.NaN, "en")).toBe("");
    expect(formatTime("", "en")).toBe("");
  });

  it("groups numbers with the requested locale", () => {
    expect(formatNumber(12345, "en-US")).toBe("12,345");
    expect(formatNumber(12345, "de-DE")).not.toBe("12,345");
  });

  it("returns an empty string for non-finite numbers", () => {
    expect(formatNumber(Number.POSITIVE_INFINITY, "en")).toBe("");
    expect(formatNumber(Number.NaN, "en")).toBe("");
  });
});
