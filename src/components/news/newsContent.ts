/**
 * Pure helpers behind `NewsRichText`.
 *
 * News bodies arrive from two very different pipelines: Steam serves BBCode
 * (mixed with `<br>` and `{STEAM_CLAN_IMAGE}` placeholders) and RSS serves
 * whatever HTML the outlet felt like publishing. Everything here is pure and
 * synchronous so it can be unit tested and reused for reading time, word
 * counts, TTS and Markdown export.
 */

import {
  bbNodesToText,
  normalizeBbNewlines,
  parseBbCode,
  stripHtml,
  unescapeBbBrackets,
  type BbNode,
} from "../../utils/bbcode";

export type NewsFormat = "bbcode" | "html" | "text";

export type NewsContent =
  | { kind: "bbcode"; nodes: BbNode[] }
  | { kind: "html"; html: string }
  | { kind: "text"; paragraphs: string[] };

const STEAM_CLAN_IMAGE_BASE = "https://clan.cloudflare.steamstatic.com/images";

/** Tags that count as evidence of a BBCode body. */
const BB_TAG_NAMES = [
  "b",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "code",
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "heading",
  "url",
  "img",
  "hr",
  "list",
  "olist",
  "spoiler",
  "quote",
  "color",
  "font",
  "size",
  "center",
  "left",
  "right",
  "table",
  "tr",
  "td",
  "th",
  "noparse",
  "parsehtml",
  "readmore",
  "previewyoutube",
  "video",
];

const BB_HINT_RE = new RegExp(
  `\\[\\*\\]|\\[\\/?(?:${BB_TAG_NAMES.join("|")})(?:\\s*=[^\\]]*|\\s[^\\]]*)?\\]`,
  "i",
);

const HTML_HINT_RE =
  /<(?:p|br|div|span|a|img|ul|ol|li|strong|em|b|i|u|s|h[1-6]|blockquote|table|thead|tbody|tr|td|th|figure|figcaption|pre|code|hr|sup|sub)\b[^>]*>/i;

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  divide: "÷",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  ntilde: "ñ",
  aacute: "á",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  shy: "\u00ad",
};

/** Decodes the named + numeric entities that show up in feed bodies. */
export function decodeHtmlEntities(input: string): string {
  if (!input || input.indexOf("&") === -1) return input;
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/**
 * Expands Steam's CDN placeholders so `[img]{STEAM_CLAN_IMAGE}/123/a.jpg[/img]`
 * points at a real URL. Handles a missing slash after the placeholder.
 */
export function expandSteamImagePlaceholders(input: string): string {
  if (!input) return "";
  return input.replace(
    /\{STEAM_CLAN_(?:LOC_)?IMAGE\}(\/?)/g,
    (_match, slash: string) => `${STEAM_CLAN_IMAGE_BASE}${slash || "/"}`,
  );
}

/**
 * Normalises a raw news body for display helpers: expands Steam image
 * placeholders, normalises newlines and unescapes `\[` / `\]`.
 *
 * Note: BBCode parsing uses the internal variant that keeps escapes intact so
 * the parser can decide whether a bracket is literal.
 */
export function prepareNewsContent(raw: string): string {
  if (!raw) return "";
  return unescapeBbBrackets(normalizeBbNewlines(expandSteamImagePlaceholders(raw)));
}

function prepareForParsing(raw: string): string {
  return normalizeBbNewlines(expandSteamImagePlaceholders(raw)).replace(/<br\s*\/?>/gi, "\n");
}

/** BBCode wins over HTML because Steam mixes BBCode with `<br>`. */
export function detectNewsFormat(raw: string): NewsFormat {
  if (!raw || !raw.trim()) return "text";
  // Escaped brackets are literal text, not tag evidence.
  const probe = raw.replace(/\\[\[\]]/g, " ");
  if (BB_HINT_RE.test(probe)) return "bbcode";
  if (HTML_HINT_RE.test(probe)) return "html";
  return "text";
}

/** Splits plain text into paragraphs on blank lines. */
export function splitIntoParagraphs(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** Strips markup for reading time, word counts, TTS and Markdown copy. */
export function newsContentToPlainText(raw: string): string {
  if (!raw) return "";
  const format = detectNewsFormat(raw);
  let text: string;
  if (format === "bbcode") {
    text = bbNodesToText(parseBbCode(prepareForParsing(raw)));
  } else if (format === "html") {
    text = stripHtml(raw);
  } else {
    text = prepareNewsContent(raw);
  }
  // Block boundaries carry meaning for TTS; `<br>`/`</p>` must not glue words.
  const spaced = text
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<\/\s*(?:p|div|li|ul|ol|h[1-6]|tr|td|th|blockquote|figure)\s*>/gi, " ");
  return decodeHtmlEntities(stripHtml(spaced)).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// HTML sanitizer
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "a",
  "img",
  "figure",
  "figcaption",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "sup",
  "sub",
  "div",
  "span",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

/** Elements removed together with everything inside them. */
const BLOCKED_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "svg",
  "video",
  "audio",
  "noscript",
  "template",
  "link",
  "meta",
  "base",
];

const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title"]);

const BLOCKED_TAG_PAIR_RE = new RegExp(
  `<\\s*(${BLOCKED_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`,
  "gi",
);
const BLOCKED_TAG_RE = new RegExp(
  `<\\s*\\/?\\s*(?:${BLOCKED_TAGS.join("|")})\\b[^>]*>`,
  "gi",
);

function escapeHtmlText(value: string): string {
  return value.replace(/</g, "&lt;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeAttrs(raw: string): string {
  const out: string[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;
    const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (name === "href" || name === "src") {
      const url = safeHttpUrl(decodeHtmlEntities(value));
      if (!url) continue;
      out.push(`${name}="${escapeAttr(url)}"`);
      continue;
    }
    out.push(`${name}="${escapeAttr(decodeHtmlEntities(value))}"`);
  }
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

function safeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  if (/^(?:javascript|data|vbscript|file|blob):/i.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function sanitizeTagToken(token: string): string {
  const closing = /^<\s*\/\s*([a-zA-Z][a-zA-Z0-9:-]*)\s*>$/.exec(token);
  if (closing) {
    const tag = closing[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag) || VOID_TAGS.has(tag)) return "";
    return `</${tag}>`;
  }

  const opening = /^<\s*([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)>?$/.exec(token);
  if (!opening) return escapeHtmlText(token);
  const tag = opening[1].toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return "";

  const attrs = sanitizeAttrs(opening[2]);
  if (tag === "img" && !/\bsrc="/.test(attrs)) return "";
  if (tag === "a") return `<a${attrs} rel="noopener noreferrer">`;
  return `<${tag}${attrs}>`;
}

/**
 * Strict allowlist sanitizer for feed HTML.
 *
 * Unknown tags are dropped (their text is kept), dangerous elements are
 * removed with their content, attributes are reduced to `href` / `src` /
 * `alt` / `title`, and every URL must be http(s). Never throws.
 */
export function sanitizeNewsHtml(html: string): string {
  if (!html) return "";
  try {
    let cleaned = html.replace(/<!--[\s\S]*?-->/g, "");

    let previous = "";
    while (previous !== cleaned) {
      previous = cleaned;
      cleaned = cleaned.replace(BLOCKED_TAG_PAIR_RE, "");
    }
    cleaned = cleaned.replace(BLOCKED_TAG_RE, "");

    const out: string[] = [];
    const tokenRe = /<[^>]*>/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = tokenRe.exec(cleaned)) !== null) {
      if (match.index > last) out.push(escapeHtmlText(cleaned.slice(last, match.index)));
      out.push(sanitizeTagToken(match[0]));
      last = match.index + match[0].length;
    }
    if (last < cleaned.length) out.push(escapeHtmlText(cleaned.slice(last)));
    return out.join("");
  } catch {
    return escapeHtmlText(stripHtml(html));
  }
}

// ---------------------------------------------------------------------------
// Video helpers
// ---------------------------------------------------------------------------

/**
 * Reads the video id out of `[previewyoutube=ID;full]` / `[previewyoutube=ID]`
 * values. Anything that is not a plausible YouTube id is rejected.
 */
export function parseYouTubeVideoId(value: string | null | undefined): string | null {
  if (!value) return null;
  // Accept the bare tag value (`ID;full`) as well as a whole tag token.
  const bare = value
    .trim()
    .replace(/^\[\s*previewyoutube\s*=\s*/i, "")
    .replace(/\]\s*$/, "");
  const id = bare.split(/[;|,\s]/)[0]?.trim() ?? "";
  return YOUTUBE_ID_RE.test(id) ? id : null;
}

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Parsing entry point
// ---------------------------------------------------------------------------

export function parseNewsContent(raw: string): NewsContent {
  const source = typeof raw === "string" ? raw : "";
  const format = detectNewsFormat(source);

  if (format === "bbcode") {
    return { kind: "bbcode", nodes: parseBbCode(prepareForParsing(source)) };
  }
  if (format === "html") {
    return { kind: "html", html: sanitizeNewsHtml(prepareNewsContent(source)) };
  }
  return { kind: "text", paragraphs: splitIntoParagraphs(prepareNewsContent(source)) };
}
