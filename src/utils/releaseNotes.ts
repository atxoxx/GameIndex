import { invoke } from "@tauri-apps/api/core";

/**
 * GitHub Releases client + lightweight markdown parsing for release bodies.
 *
 * The release workflow generates notes as `## What's Changed` followed by a
 * bullet list of commit links, so a full markdown engine would be overkill —
 * the parsers here cover exactly the constructs those notes can contain.
 */

export const GITHUB_REPO = "atxoxx/GameIndex";
export const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`;
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`;

const FETCH_TIMEOUT_MS = 15_000;

export interface ReleaseEntry {
  tag: string;
  name: string;
  body: string;
  publishedAt: string | null;
  url: string;
  prerelease: boolean;
}

export type ReleaseHeadingLevel = 1 | 2 | 3 | 4;

export type ReleaseBlock =
  | { type: "heading"; level: ReleaseHeadingLevel; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "paragraph"; text: string };

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "link"; label: string; href: string }
  | { type: "code"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string };

/** Conventional-commit buckets the release history groups entries into. */
export type CommitCategory =
  | "feat"
  | "fix"
  | "perf"
  | "refactor"
  | "test"
  | "build"
  | "docs"
  | "chore"
  | "release"
  | "other";

export interface ParsedCommit {
  category: CommitCategory;
  /** Conventional-commit scope, e.g. `bigscreen` in `feat(bigscreen): ...`. */
  scope: string | null;
  description: string;
  /** Short commit hash, when the note carries one. */
  hash: string | null;
  /** Commit URL, when the note links a hash. */
  href: string | null;
  /** True for `feat!:` / `BREAKING CHANGE` entries. */
  breaking: boolean;
}

export interface CommitGroup {
  category: CommitCategory;
  commits: ParsedCommit[];
}

const CATEGORY_BY_TYPE: Record<string, CommitCategory> = {
  feat: "feat",
  feature: "feat",
  features: "feat",
  fix: "fix",
  fixes: "fix",
  bugfix: "fix",
  perf: "perf",
  performance: "perf",
  refactor: "refactor",
  refactoring: "refactor",
  test: "test",
  tests: "test",
  testing: "test",
  build: "build",
  ci: "build",
  deps: "build",
  docs: "docs",
  doc: "docs",
  documentation: "docs",
  chore: "chore",
  style: "chore",
  revert: "chore",
  release: "release",
  version: "release",
};

/** Display order for the grouped notes; mirrors how people scan a changelog. */
export const COMMIT_CATEGORY_ORDER: CommitCategory[] = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "build",
  "docs",
  "test",
  "chore",
  "release",
  "other",
];

const TRAILING_LINK_RE = /\(\[([^\]]+)\]\(([^)]+)\)\)\s*$/;
const TRAILING_PLAIN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)\s*$/;
const TRAILING_HASH_RE = /\(([0-9a-f]{6,40})\)\s*$/i;
const CONVENTIONAL_RE = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?\s*:\s*(.+)$/;

/** Peel the trailing `([hash](url))` (or plain `(hash)`) off a note line. */
function extractTrailingCommit(raw: string): {
  text: string;
  hash: string | null;
  href: string | null;
} {
  const text = raw.trim();
  const linked = TRAILING_LINK_RE.exec(text) ?? TRAILING_PLAIN_LINK_RE.exec(text);
  if (linked) {
    return { text: text.slice(0, linked.index).trim(), hash: linked[1].trim(), href: linked[2].trim() };
  }
  const plain = TRAILING_HASH_RE.exec(text);
  if (plain) {
    return { text: text.slice(0, plain.index).trim(), hash: plain[1].trim(), href: null };
  }
  return { text, hash: null, href: null };
}

/** Unwrap a whole-line `**bold**` / `__bold__` subject. */
function stripEmphasis(text: string): string {
  return text.replace(/^\s*(?:\*\*|__)([\s\S]*?)(?:\*\*|__)\s*$/, "$1").trim();
}

/**
 * Parse one release-note bullet into a typed commit. Non-conventional lines
 * (plain prose bullets) fall back to `other` with the raw text as description.
 */
export function parseCommit(item: string): ParsedCommit {
  const { text, hash, href } = extractTrailingCommit(item);
  const subject = stripEmphasis(text);
  const match = CONVENTIONAL_RE.exec(subject);
  if (!match) {
    return { category: "other", scope: null, description: subject, hash, href, breaking: false };
  }
  const category = CATEGORY_BY_TYPE[match[1].toLowerCase()] ?? "other";
  return {
    category,
    scope: match[2]?.trim() || null,
    description: match[4].trim(),
    hash,
    href,
    breaking: match[3] === "!" || /^breaking change\b/i.test(match[4]),
  };
}

export interface InfoNote {
  text: string;
  hash: string | null;
  href: string | null;
}

const INFO_NOTE_RE = /^\s*(?:\*\*|__)?\s*info\s*(?:\*\*|__)?\s*:\s*(.+)$/i;

/**
 * Extract a leading `info:` note from a raw line. Returns null when the line
 * doesn't start with the `info:` prefix.
 */
export function parseInfoNote(item: string): InfoNote | null {
  const { text, hash, href } = extractTrailingCommit(item);
  const match = INFO_NOTE_RE.exec(stripEmphasis(text));
  if (!match) return null;
  const value = match[1]
    .replace(/^(?:\*\*|__)\s*/, "")
    .replace(/\s*(?:\*\*|__)$/, "")
    .trim();
  return { text: value, hash, href };
}

/** Bucket note lines by category, preserving within-category order. */
export function groupCommits(items: string[]): CommitGroup[] {
  const buckets = new Map<CommitCategory, ParsedCommit[]>();
  for (const item of items) {
    const commit = parseCommit(item);
    const bucket = buckets.get(commit.category);
    if (bucket) bucket.push(commit);
    else buckets.set(commit.category, [commit]);
  }
  return COMMIT_CATEGORY_ORDER.filter((category) => buckets.has(category)).map(
    (category) => ({ category, commits: buckets.get(category) as ParsedCommit[] }),
  );
}

/**
 * How many of these note lines are real, user-facing changes. Version-bump
 * (`release:`) entries and free-form prose are excluded so the count matches
 * the number of commits actually shown in the grouped sections.
 */
export function countCommits(items: string[]): number {
  return items.reduce((total, item) => {
    const category = parseCommit(item).category;
    return category !== "other" && category !== "release" ? total + 1 : total;
  }, 0);
}

/** Normalize a raw GitHub `/releases` payload into sorted, draft-free entries. */
export function parseReleaseList(payload: unknown): ReleaseEntry[] {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      throw new Error(message);
    }
  }
  if (!Array.isArray(payload)) {
    throw new Error("Unexpected GitHub releases response");
  }

  const entries: ReleaseEntry[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (raw.draft === true) continue;
    const tag = typeof raw.tag_name === "string" ? raw.tag_name.trim() : "";
    if (!tag) continue;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    entries.push({
      tag,
      name: name || tag,
      body: typeof raw.body === "string" ? raw.body : "",
      publishedAt: typeof raw.published_at === "string" ? raw.published_at : null,
      url: typeof raw.html_url === "string" ? raw.html_url : GITHUB_RELEASES_PAGE,
      prerelease: raw.prerelease === true,
    });
  }

  entries.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
  return entries;
}

/** Split a release body into renderable block-level tokens. */
export function parseReleaseNotes(body: string): ReleaseBlock[] {
  const blocks: ReleaseBlock[] = [];
  let paragraph: string[] = [];
  let quotes: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushQuotes = () => {
    if (quotes.length) {
      blocks.push({ type: "quote", text: quotes.join(" ") });
      quotes = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: "list", ordered: listOrdered, items: listItems });
      listItems = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushQuotes();
    flushList();
  };

  for (const rawLine of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(4, Math.max(1, heading[1].length)) as ReleaseHeadingLevel;
      blocks.push({ type: "heading", level, text: heading[2].trim() });
      continue;
    }

    if (/^(?:[-*_]\s*){3,}$/.test(line)) {
      flushAll();
      blocks.push({ type: "rule" });
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      flushQuotes();
      const isOrdered = Boolean(ordered);
      if (listItems.length && listOrdered !== isOrdered) flushList();
      listOrdered = isOrdered;
      listItems.push((bullet?.[1] ?? ordered?.[1] ?? "").trim());
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      quotes.push(line.replace(/^>\s?/, "").trim());
      continue;
    }

    flushQuotes();
    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}

const INLINE_PATTERN =
  /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;

/** Split a single line into link / bold / italic / code inline tokens. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "text", value: text.slice(last, match.index) });
    }
    if (match[1] !== undefined && match[2] !== undefined) {
      tokens.push({ type: "link", label: match[1], href: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "code", value: match[3] });
    } else if (match[4] !== undefined || match[5] !== undefined) {
      tokens.push({ type: "strong", value: match[4] ?? match[5] ?? "" });
    } else if (match[6] !== undefined || match[7] !== undefined) {
      tokens.push({ type: "em", value: match[6] ?? match[7] ?? "" });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    tokens.push({ type: "text", value: text.slice(last) });
  }
  return tokens.length ? tokens : [{ type: "text", value: text }];
}

/** Only http(s) links are rendered as anchors; anything else stays plain text. */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function messageFromErrorPayload(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Not JSON — fall through to the generic HTTP message.
  }
  return `GitHub request failed (HTTP ${status})`;
}

async function fetchDirect(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(messageFromErrorPayload(text, res.status));
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch published releases from the GitHub API. Plain `fetch` works because
 * api.github.com sends permissive CORS headers; a network failure (offline,
 * CORS-blocked webview) falls back to the Rust `fetch_url` bridge. HTTP errors
 * are final so a rate-limited request never gets retried behind the scenes.
 */
export async function fetchGithubReleases(): Promise<ReleaseEntry[]> {
  let payload: unknown;
  try {
    payload = await fetchDirect(GITHUB_RELEASES_API);
  } catch (error) {
    if (!hasTauriRuntime() || !(error instanceof TypeError)) throw error;
    const text = await invoke<string>("fetch_url", { url: GITHUB_RELEASES_API });
    payload = JSON.parse(text) as unknown;
  }
  return parseReleaseList(payload);
}
