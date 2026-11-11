/**
 * BBCode parser shared by the review reader and the news rich-text renderer.
 *
 * Steam news bodies are the awkward case: they mix BBCode with `<br>`, list
 * items are opened by `[*]` and rarely closed with `[/*]`, and unknown tags
 * appear in the wild. The parser therefore:
 *   - ends a `[*]` item at the next `[*]`, `[/list]`, `[/olist]` or EOF,
 *   - keeps escaped brackets (`\[`, `\]`) as literal text,
 *   - unwraps unknown tag pairs to their children, while leaving an unpaired
 *     `[something]` visible so nothing silently disappears.
 */

export const BB_MAX_DEPTH = 6;
export const BB_MAX_OUTPUT = 30_000;

export interface TagMatch {
  kind: "open" | "close" | "self";
  tag: string;
  attrs?: Record<string, string>;
  nextIndex: number;
  /** False for syntactically valid tags the renderer does not know. */
  known: boolean;
}

export type BbNode =
  | { type: "text"; text: string }
  | { type: "br" }
  | { type: "tag"; tag: string; attrs?: Record<string, string>; children: BbNode[] };

const KNOWN_TAGS = new Set<string>([
  "b",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "strong",
  "em",
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
  "*",
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
]);

/** Tags whose body is kept verbatim instead of being parsed as BBCode. */
const RAW_TAGS = new Set(["code", "noparse", "parsehtml"]);

const TAG_NAME_RE = /^(?:[a-z][a-z0-9]*|\*)$/i;

export function normalizeBbNewlines(input: string): string {
  return input.replace(/\r\n?/g, "\n");
}

/** Turns `\[` / `\]` / `\\` back into the literal characters. */
export function unescapeBbBrackets(input: string): string {
  return input.replace(/\\([\[\]\\])/g, "$1");
}

export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/**
 * Returns the URL when it is a plain http(s) URL, `null` otherwise. Protocol
 * relative (`//host/...`) input is upgraded to https.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value || value.length > 2048) return null;
  if (/^(?:javascript|data|vbscript|file|blob):/i.test(value)) return null;
  if (value.startsWith("//")) value = `https:${value}`;
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

export function isSafeUrl(href: string): boolean {
  return safeHttpUrl(href) !== null;
}

export function isKnownTag(tag: string): boolean {
  return KNOWN_TAGS.has(tag.toLowerCase());
}

export function parseTagBody(body: string): { tag: string; attrs?: Record<string, string> } {
  const spaceIdx = body.indexOf(" ");
  const eqIdx = body.indexOf("=");

  // Handle [url=https://...] or [spoiler=warning]
  if (eqIdx !== -1 && (spaceIdx === -1 || eqIdx < spaceIdx)) {
    const tag = body.slice(0, eqIdx).trim().toLowerCase();
    const val = body.slice(eqIdx + 1).replace(/^["']|["']$/g, "").trim();
    const attrs: Record<string, string> = { [tag === "url" ? "href" : "value"]: val };
    return { tag, attrs };
  }

  if (spaceIdx === -1) return { tag: body.toLowerCase() };
  const tag = body.slice(0, spaceIdx).toLowerCase();
  const rest = body.slice(spaceIdx + 1).trim();
  const attrs = parseAttrs(rest);
  return { tag, attrs };
}

export function parseAttrs(rest: string): Record<string, string> | undefined {
  if (!rest) return undefined;
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(rest)) !== null) {
    const key = m[1].toLowerCase();
    const val = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    out[key] = val;
    any = true;
  }
  return any ? out : undefined;
}

export function readTag(src: string, pos: number): TagMatch | null {
  if (src[pos] !== "[") return null;
  const end = src.indexOf("]", pos + 1);
  if (end === -1 || end - pos > 256) return null;
  const inner = src.slice(pos + 1, end).trim();
  if (!inner) return null;

  if (inner.startsWith("/")) {
    const tag = inner.slice(1).toLowerCase().trim();
    if (!TAG_NAME_RE.test(tag)) return null;
    return { kind: "close", tag, nextIndex: end + 1, known: KNOWN_TAGS.has(tag) };
  }

  if (inner.endsWith("/")) {
    const body = inner.slice(0, -1).trim();
    const { tag, attrs } = parseTagBody(body);
    if (!TAG_NAME_RE.test(tag)) return null;
    return { kind: "self", tag, attrs, nextIndex: end + 1, known: KNOWN_TAGS.has(tag) };
  }

  const { tag, attrs } = parseTagBody(inner);
  if (!TAG_NAME_RE.test(tag)) return null;
  return { kind: "open", tag, attrs, nextIndex: end + 1, known: KNOWN_TAGS.has(tag) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findClosingTag(
  src: string,
  from: number,
  tag: string,
): { start: number; end: number } | null {
  const re = new RegExp(`\\[\\s*\\/\\s*${escapeRegExp(tag)}\\s*\\]`, "gi");
  re.lastIndex = from;
  const match = re.exec(src);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

/**
 * Parses BBCode into a structured AST of BbNode items.
 *
 * Handles nested blocks, self-closing tags, Steam's unterminated `[*]` list
 * items, escaped brackets and auto-closing at EOF.
 */
export function parseBbCode(src: string): BbNode[] {
  const input = normalizeBbNewlines(src);
  const len = input.length;
  let i = 0;

  /**
   * @param stopTags tags that end this run
   * @param consumeStop whether the ending tag is consumed here (a block's own
   *   closing tag) or left for the caller (a list item, which must not swallow
   *   its parent's `[/list]`).
   */
  function parseNodes(stopTags: string[] | undefined, depth: number, consumeStop: boolean): BbNode[] {
    const nodes: BbNode[] = [];
    let textBuf = "";

    function flushText() {
      if (textBuf) {
        nodes.push({ type: "text", text: textBuf });
        textBuf = "";
      }
    }

    while (i < len) {
      const ch = input[i];

      // Escaped brackets stay literal text.
      if (ch === "\\" && i + 1 < len && (input[i + 1] === "[" || input[i + 1] === "]")) {
        textBuf += input[i + 1];
        i += 2;
        continue;
      }

      if (ch === "\n") {
        flushText();
        nodes.push({ type: "br" });
        i++;
        while (i < len && input[i] === "\n") i++;
        continue;
      }

      if (ch === "[") {
        const tagMatch = readTag(input, i);
        if (tagMatch) {
          const stopping = stopTags?.includes(tagMatch.tag) ?? false;

          if (tagMatch.kind === "close") {
            if (stopping) {
              flushText();
              if (consumeStop) i = tagMatch.nextIndex;
              return nodes;
            }
            // Unpaired close tag: keep it visible instead of dropping content.
            textBuf += input.slice(i, tagMatch.nextIndex);
            i = tagMatch.nextIndex;
            continue;
          }

          if (tagMatch.kind === "self") {
            flushText();
            nodes.push({ type: "tag", tag: tagMatch.tag, attrs: tagMatch.attrs, children: [] });
            i = tagMatch.nextIndex;
            continue;
          }

          // A list item ends before the next item marker so the parent list
          // can start it (without consuming it).
          if (stopping && tagMatch.tag === "*") {
            flushText();
            return nodes;
          }

          // An unknown tag with no closing partner is just text.
          if (!tagMatch.known && !findClosingTag(input, tagMatch.nextIndex, tagMatch.tag)) {
            textBuf += input.slice(i, tagMatch.nextIndex);
            i = tagMatch.nextIndex;
            continue;
          }

          flushText();
          i = tagMatch.nextIndex;

          if (RAW_TAGS.has(tagMatch.tag)) {
            const close = findClosingTag(input, i, tagMatch.tag);
            if (close) {
              nodes.push({
                type: "tag",
                tag: tagMatch.tag,
                attrs: tagMatch.attrs,
                children: [{ type: "text", text: unescapeBbBrackets(input.slice(i, close.start)) }],
              });
              i = close.end;
              continue;
            }
            // No closing tag: fall through and parse the body normally.
          }

          if (depth >= BB_MAX_DEPTH) {
            textBuf += `[${tagMatch.tag}]`;
            continue;
          }

          const children =
            tagMatch.tag === "*"
              ? parseNodes(["*", "list", "olist"], depth + 1, false)
              : parseNodes([tagMatch.tag], depth + 1, true);
          nodes.push({ type: "tag", tag: tagMatch.tag, attrs: tagMatch.attrs, children });
          continue;
        }
      }

      textBuf += ch;
      i++;
    }

    flushText();
    return nodes;
  }

  return parseNodes(undefined, 0, true);
}

/** Flattens an AST into readable text (used for TTS, word counts, video URLs). */
export function bbNodesToText(nodes: BbNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.text;
      continue;
    }
    if (node.type === "br") {
      out += " ";
      continue;
    }
    if (node.tag === "*") out += " ";
    out += bbNodesToText(node.children);
    if (node.tag === "p" || node.tag === "list" || node.tag === "olist" || node.tag === "quote") {
      out += " ";
    }
  }
  return out;
}
