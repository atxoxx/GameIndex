import type { GameNote } from "../types/gameNote";

/**
 * Pure helpers for the game Notes tab: list ordering, Markdown
 * formatting actions, and small text/time utilities. Kept framework-free
 * so they can be unit-tested directly.
 */

/** Pinned notes first, then most recently updated, then newest created. */
export function sortNotes(notes: GameNote[]): GameNote[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return b.createdAt - a.createdAt;
  });
}

/** First non-empty line, stripped of common Markdown markers. */
export function deriveNoteTitle(content: string, fallback: string): string {
  const line = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return fallback;
  const cleaned = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
    .replace(/^>\s+/, "")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 48 ? `${cleaned.slice(0, 47)}…` : cleaned;
}

/** One-line plain-text snippet for the list sidebar. */
export function noteExcerpt(content: string, max = 120): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export function noteWordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function noteCharCount(text: string): number {
  return text.length;
}

/** Filesystem-safe `.md` name derived from a note title. */
export function noteFileName(title: string, fallback: string): string {
  const base = (title.trim() || fallback)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "note"}.md`;
}

/** "Just now" / "5m ago" / "3d ago" / locale date for older notes. */
export function formatNoteTime(
  ms: number,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return t("notes.justNow");
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t("notes.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("notes.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("notes.daysAgo", { count: days });
  return new Date(ms).toLocaleDateString();
}

export type MarkdownFormatAction =
  | "bold"
  | "italic"
  | "strike"
  | "inlineCode"
  | "codeBlock"
  | "heading"
  | "quote"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "link";

export interface MarkdownFormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function lineBounds(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let to = value.indexOf("\n", end);
  if (to === -1) to = value.length;
  return [from, to];
}

/** Apply a line-level transform across the selected block. */
function applyLineTransform(
  value: string,
  start: number,
  end: number,
  transform: (lines: string[]) => string[],
): MarkdownFormatResult {
  const [from, to] = lineBounds(value, start, end);
  const block = value.slice(from, to);
  const next = transform(block.split("\n")).join("\n");
  const nextValue = value.slice(0, from) + next + value.slice(to);
  const delta = next.length - block.length;
  return {
    value: nextValue,
    selectionStart: Math.min(from + next.length, Math.max(from, start)),
    selectionEnd: Math.min(from + next.length, Math.max(from, end + delta)),
  };
}

/** Toggle a per-line prefix across the selected block. */
function toggleLinePrefix(
  value: string,
  start: number,
  end: number,
  prefix: string,
): MarkdownFormatResult {
  return applyLineTransform(value, start, end, (lines) => {
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const allPrefixed =
      nonEmpty.length > 0 && nonEmpty.every((l) => l.startsWith(prefix));
    return lines.map((line) => {
      if (allPrefixed) {
        return line.startsWith(prefix) ? line.slice(prefix.length) : line;
      }
      if (line.trim().length === 0) return prefix;
      return `${prefix}${line}`;
    });
  });
}

/** Toggle Markdown task-list markers, converting plain bullets too. */
function toggleTaskList(
  value: string,
  start: number,
  end: number,
): MarkdownFormatResult {
  return applyLineTransform(value, start, end, (lines) => {
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const allTasks =
      nonEmpty.length > 0 && nonEmpty.every((l) => /^- \[[ xX]\] /.test(l));
    return lines.map((line) => {
      if (allTasks) return line.replace(/^- \[[ xX]\] /, "");
      if (/^- \[[ xX]\] /.test(line)) return line;
      if (/^- /.test(line)) return line.replace(/^- /, "- [ ] ");
      if (line.trim().length === 0) return "- [ ] ";
      return `- [ ] ${line}`;
    });
  });
}

function wrapInline(
  value: string,
  start: number,
  end: number,
  marker: string,
): MarkdownFormatResult {
  const selected = value.slice(start, end);
  const alreadyWrapped =
    selected.length > marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker);
  if (alreadyWrapped) {
    const inner = selected.slice(marker.length, -marker.length);
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  const inner = selected || "";
  const nextValue =
    value.slice(0, start) + marker + inner + marker + value.slice(end);
  return {
    value: nextValue,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + inner.length,
  };
}

/**
 * Apply a toolbar action to a Markdown textarea value. Returns the new
 * value plus the selection range the caller should restore, so the
 * editor stays usable for repeated formatting (no focus jump).
 */
export function applyMarkdownFormat(
  value: string,
  start: number,
  end: number,
  action: MarkdownFormatAction,
): MarkdownFormatResult {
  switch (action) {
    case "bold":
      return wrapInline(value, start, end, "**");
    case "italic":
      return wrapInline(value, start, end, "*");
    case "strike":
      return wrapInline(value, start, end, "~~");
    case "inlineCode":
      return wrapInline(value, start, end, "`");
    case "heading":
      return toggleLinePrefix(value, start, end, "## ");
    case "quote":
      return toggleLinePrefix(value, start, end, "> ");
    case "bulletList":
      return toggleLinePrefix(value, start, end, "- ");
    case "taskList":
      return toggleTaskList(value, start, end);
    case "orderedList":
      return applyLineTransform(value, start, end, (lines) => {
        const nonEmpty = lines.filter((l) => l.trim().length > 0);
        const allNumbered =
          nonEmpty.length > 0 && nonEmpty.every((l) => /^\d+\.\s/.test(l));
        return lines.map((line, i) => {
          if (allNumbered) return line.replace(/^\d+\.\s/, "");
          if (line.trim().length === 0) return `${i + 1}. `;
          return `${i + 1}. ${line}`;
        });
      });
    case "codeBlock": {
      const selected = value.slice(start, end);
      const insert = selected ? `\`\`\`\n${selected}\n\`\`\`\n` : "```\n\n```\n";
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const cursor = selected
        ? start + insert.length
        : start + 4;
      return { value: nextValue, selectionStart: cursor, selectionEnd: cursor };
    }
    case "link": {
      const selected = value.slice(start, end);
      const label = selected || "";
      const insert = `[${label}](https://)`;
      const nextValue = value.slice(0, start) + insert + value.slice(end);
      const urlStart = start + label.length + 3;
      if (selected) {
        return { value: nextValue, selectionStart: urlStart, selectionEnd: urlStart + 8 };
      }
      return {
        value: nextValue,
        selectionStart: start + 1,
        selectionEnd: start + 1 + label.length,
      };
    }
    default:
      return { value, selectionStart: start, selectionEnd: end };
  }
}
