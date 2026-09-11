import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMarkdownFormat,
  deriveNoteTitle,
  formatNoteTime,
  noteCharCount,
  noteExcerpt,
  noteFileName,
  noteWordCount,
  sortNotes,
} from "./gameNotes";
import type { GameNote } from "../types/gameNote";

function makeNote(overrides: Partial<GameNote> = {}): GameNote {
  return {
    id: "n1",
    gameId: "g1",
    title: "Note",
    content: "Body",
    tags: [],
    pinned: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("sortNotes", () => {
  it("puts pinned notes first, then most recently updated", () => {
    const pinned = makeNote({ id: "pin", pinned: true, updatedAt: 1 });
    const newer = makeNote({ id: "new", updatedAt: 300 });
    const older = makeNote({ id: "old", updatedAt: 200 });
    expect(sortNotes([older, pinned, newer]).map((n) => n.id)).toEqual([
      "pin",
      "new",
      "old",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [makeNote({ id: "a", updatedAt: 1 }), makeNote({ id: "b", updatedAt: 2 })];
    const copy = [...input];
    sortNotes(input);
    expect(input).toEqual(copy);
  });
});

describe("deriveNoteTitle", () => {
  it("uses the first non-empty line without Markdown markers", () => {
    expect(deriveNoteTitle("\n## Boss route\nrest", "fallback")).toBe("Boss route");
    expect(deriveNoteTitle("- [ ] Clean up", "fallback")).toBe("Clean up");
    expect(deriveNoteTitle("> quoted", "fallback")).toBe("quoted");
  });

  it("falls back for empty content and truncates long lines", () => {
    expect(deriveNoteTitle("   \n\n", "fallback")).toBe("fallback");
    const long = deriveNoteTitle("x".repeat(80), "fallback");
    expect(long.length).toBe(48);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("noteExcerpt / noteWordCount / noteCharCount / noteFileName", () => {
  it("flattens Markdown into a one-line snippet", () => {
    expect(noteExcerpt("## Hello\n\n- one\n- two")).toBe("Hello one two");
    expect(noteExcerpt("```\nconst x = 1\n```\nAfter")).toBe("After");
    expect(noteExcerpt("[docs](https://example.com) here")).toBe("docs here");
  });

  it("counts words and characters", () => {
    expect(noteWordCount("  two   words ")).toBe(2);
    expect(noteWordCount("   ")).toBe(0);
    expect(noteCharCount("abc")).toBe(3);
  });

  it("builds a filesystem-safe .md name", () => {
    expect(noteFileName("My Guide: Bosses!", "fallback")).toBe("my-guide-bosses.md");
    expect(noteFileName("", "Game fallback")).toBe("game-fallback.md");
  });
});

describe("applyMarkdownFormat", () => {
  it("wraps the selection for inline actions", () => {
    const bold = applyMarkdownFormat("hello", 0, 5, "bold");
    expect(bold.value).toBe("**hello**");
    expect([bold.selectionStart, bold.selectionEnd]).toEqual([2, 7]);

    const link = applyMarkdownFormat("docs", 0, 4, "link");
    expect(link.value).toBe("[docs](https://)");
    expect(link.value.slice(link.selectionStart, link.selectionEnd)).toBe("https://");
  });

  it("toggles inline markers off when the selection is already wrapped", () => {
    const result = applyMarkdownFormat("**hello**", 0, 9, "bold");
    expect(result.value).toBe("hello");
    expect([result.selectionStart, result.selectionEnd]).toEqual([0, 5]);
  });

  it("inserts empty markers with the cursor in the middle", () => {
    const result = applyMarkdownFormat("hello world", 5, 5, "italic");
    expect(result.value).toBe("hello** world");
    expect(result.selectionStart).toBe(result.selectionEnd);
  });

  it("prefixes lines and toggles them back off", () => {
    const heading = applyMarkdownFormat("text", 0, 0, "heading");
    expect(heading.value).toBe("## text");

    const toggle = applyMarkdownFormat("## text", 0, 0, "heading");
    expect(toggle.value).toBe("text");

    const ordered = applyMarkdownFormat("a\nb", 0, 3, "orderedList");
    expect(ordered.value).toBe("1. a\n2. b");
  });

  it("converts bullets to task items and back", () => {
    const toTask = applyMarkdownFormat("- buy ammo", 0, 0, "taskList");
    expect(toTask.value).toBe("- [ ] buy ammo");

    const fromTask = applyMarkdownFormat("- [x] buy ammo", 0, 0, "taskList");
    expect(fromTask.value).toBe("buy ammo");
  });

  it("inserts a fenced code block for empty selections", () => {
    const result = applyMarkdownFormat("", 0, 0, "codeBlock");
    expect(result.value).toBe("```\n\n```\n");
    expect(result.selectionStart).toBe(4);
  });
});

describe("formatNoteTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const t = (key: string, vars?: Record<string, unknown>) =>
    vars?.count !== undefined ? `${key}:${vars.count}` : key;

  it("returns relative labels for recent timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const now = Date.now();
    expect(formatNoteTime(now - 5_000, t)).toBe("notes.justNow");
    expect(formatNoteTime(now - 5 * 60_000, t)).toBe("notes.minutesAgo:5");
    expect(formatNoteTime(now - 3 * 60 * 60_000, t)).toBe("notes.hoursAgo:3");
    expect(formatNoteTime(now - 2 * 24 * 60 * 60_000, t)).toBe("notes.daysAgo:2");
  });

  it("returns an empty label for missing timestamps", () => {
    expect(formatNoteTime(0, t)).toBe("");
  });
});
