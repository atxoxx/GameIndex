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
