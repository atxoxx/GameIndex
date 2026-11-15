import { describe, expect, it } from "vitest";
import {
  classifyLine,
  countMatches,
  countSeverities,
  filterLines,
  formatCount,
  formatLogSize,
  formatRelativeTime,
  rowForMatch,
  splitHighlight,
  splitLogLines,
} from "./logAnalysis";

const LINES = [
  "=== GameIndex Compatibility Log ===",
  "info: starting game",
  "err:module:import_dll Library d3d11.dll not found",
  "warn:shader: cache miss",
  "fixme:d3d:wined3d_device init",
  "dxvk: pipeline created",
  "vkd3d: adapter selected",
  "mangohud: fps overlay ready",
  "just a plain line",
  "",
];

describe("classifyLine", () => {
  it("recognises Wine severities, driver chatter and section headers", () => {
    expect(classifyLine("err:module:import_dll failed")).toBe("error");
    expect(classifyLine("error: could not create device")).toBe("error");
    expect(classifyLine("warn:shader: cache miss")).toBe("warning");
    expect(classifyLine("fixme:d3d:wined3d_device init")).toBe("warning");
    expect(classifyLine("dxvk: pipeline created")).toBe("system");
    expect(classifyLine("vkd3d: adapter selected")).toBe("system");
    expect(classifyLine("gamescope: taking over display")).toBe("system");
    expect(classifyLine("mangohud: overlay ready")).toBe("system");
    expect(classifyLine("=== Launch: 2026-01-01 ===")).toBe("header");
    expect(classifyLine("--- GameIndex compatibility section ---")).toBe("header");
    expect(classifyLine("info: starting game")).toBe("info");
  });

  it("keeps a header a header even when it mentions errors", () => {
    expect(classifyLine("=== Errors ===")).toBe("header");
  });
});

describe("splitLogLines", () => {
  it("splits CRLF and drops a single trailing newline", () => {
    expect(splitLogLines("a\r\nb\n")).toEqual(["a", "b"]);
    expect(splitLogLines("")).toEqual([]);
  });
});

describe("countSeverities", () => {
  it("counts non-empty lines once, independently of a query", () => {
    expect(countSeverities(LINES)).toEqual({ all: 9, error: 1, warning: 2, system: 3 });
  });
});

describe("filterLines", () => {
  it("keeps original indexes while filtering by severity", () => {
    const errors = filterLines(LINES, "error", "");
    expect(errors).toHaveLength(1);
    expect(errors[0].index).toBe(2);
    expect(errors[0].severity).toBe("error");

    const warnings = filterLines(LINES, "warning", "");
    expect(warnings.map((row) => row.index)).toEqual([3, 4]);

    const system = filterLines(LINES, "system", "");
    expect(system.map((row) => row.index)).toEqual([5, 6, 7]);
  });

  it("matches the query case-insensitively and preserves raw indexes", () => {
    const rows = filterLines(LINES, "all", "D3D");
    expect(rows.map((row) => row.index)).toEqual([2, 4, 6]);
    expect(rows[0].text).toContain("d3d11.dll");
  });

  it("combines severity and query filters", () => {
    expect(filterLines(LINES, "warning", "shader").map((row) => row.index)).toEqual([3]);
    expect(filterLines(LINES, "error", "shader")).toEqual([]);
  });

  it("shows headers only in the unfiltered view", () => {
    expect(filterLines(LINES, "all", "").map((row) => row.index)).toContain(0);
    expect(filterLines(LINES, "system", "").map((row) => row.index)).not.toContain(0);
  });
});

describe("countMatches", () => {
  it("counts every occurrence, including several per line", () => {
    expect(countMatches(["error error error", "ERROR happened"], "error")).toBe(4);
    expect(countMatches(["nothing here"], "error")).toBe(0);
    expect(countMatches(["anything"], "   ")).toBe(0);
  });
});

describe("rowForMatch", () => {
  it("maps an occurrence back to the row that owns it", () => {
    const lines = ["first error", "error and another error", "clean"];
    expect(rowForMatch(lines, "error", 0)).toBe(0);
    expect(rowForMatch(lines, "error", 1)).toBe(1);
    expect(rowForMatch(lines, "error", 2)).toBe(1);
    expect(rowForMatch(lines, "error", 3)).toBeNull();
  });
});

describe("splitHighlight", () => {
  it("segments matches without losing the original text", () => {
    const segments = splitHighlight("err: failed ERR twice", "err");
    expect(segments.filter((segment) => segment.match).map((segment) => segment.text)).toEqual([
      "err",
      "ERR",
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe("err: failed ERR twice");
  });

  it("returns a single plain segment when the query is empty", () => {
    expect(splitHighlight("plain line", "  ")).toEqual([{ text: "plain line", match: false }]);
  });
});

describe("formatRelativeTime", () => {
  const now = 1_800_000_000_000;

  it("collapses the first minute into 'now'", () => {
    expect(formatRelativeTime(now, now)).toEqual({ unit: "now", value: 0 });
    expect(formatRelativeTime(now - 59_999, now)).toEqual({ unit: "now", value: 0 });
    expect(formatRelativeTime(now + 5_000, now)).toEqual({ unit: "now", value: 0 });
  });

  it("steps through minutes, hours and days at their boundaries", () => {
    expect(formatRelativeTime(now - 60_000, now)).toEqual({ unit: "minute", value: 1 });
    expect(formatRelativeTime(now - 59 * 60_000, now)).toEqual({ unit: "minute", value: 59 });
    expect(formatRelativeTime(now - 60 * 60_000, now)).toEqual({ unit: "hour", value: 1 });
    expect(formatRelativeTime(now - 24 * 60 * 60_000, now)).toEqual({ unit: "day", value: 1 });
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toEqual({ unit: "day", value: 3 });
  });
});

describe("formatCount", () => {
  it("groups thousands with spaces", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1248)).toBe("1 248");
    expect(formatCount(20431)).toBe("20 431");
  });
});

describe("formatLogSize", () => {
  it("keeps small logs in their own unit instead of rounding to 0.0 GB", () => {
    expect(formatLogSize(0)).toBe("0 B");
    expect(formatLogSize(512)).toBe("512 B");
    expect(formatLogSize(2048)).toBe("2.0 KB");
    expect(formatLogSize(400 * 1024)).toBe("400 KB");
    expect(formatLogSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatLogSize(48 * 1024 * 1024)).toBe("48 MB");
    expect(formatLogSize(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("never renders a negative or non-finite size", () => {
    expect(formatLogSize(-10)).toBe("0 B");
    expect(formatLogSize(Number.NaN)).toBe("0 B");
  });
});
