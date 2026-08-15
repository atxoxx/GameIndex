export const BB_MAX_DEPTH = 6;
export const BB_MAX_OUTPUT = 30_000;

export interface TagMatch {
  kind: "open" | "close" | "self";
  tag: string;
  attrs?: Record<string, string>;
  nextIndex: number;
}

export type BbNode =
  | { type: "text"; text: string }
  | { type: "br" }
  | { type: "tag"; tag: string; attrs?: Record<string, string>; children: BbNode[] };

export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

export function isSafeUrl(href: string): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (trimmed.length > 1024) return false;
  if (/^javascript:/i.test(trimmed)) return false;
  if (/^data:/i.test(trimmed)) return false;
  if (/^vbscript:/i.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed);
}

export function isKnownTag(tag: string): boolean {
  switch (tag.toLowerCase()) {
    case "b":
    case "i":
    case "u":
    case "s":
    case "code":
    case "h1":
    case "h2":
    case "h3":
    case "url":
    case "img":
    case "hr":
    case "list":
    case "olist":
    case "*":
    case "spoiler":
    case "quote":
    case "color":
      return true;
    default:
      return false;
  }
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
    if (!isKnownTag(tag)) return null;
    return { kind: "close", tag, nextIndex: end + 1 };
  }

  if (inner.endsWith("/")) {
    const body = inner.slice(0, -1).trim();
    const { tag, attrs } = parseTagBody(body);
    if (!isKnownTag(tag)) return null;
    return { kind: "self", tag, attrs, nextIndex: end + 1 };
  }

  const { tag, attrs } = parseTagBody(inner);
  if (!isKnownTag(tag)) return null;
  return { kind: "open", tag, attrs, nextIndex: end + 1 };
}

/**
 * Parses BBCode into a structured AST of BbNode items.
 * Handles nested blocks, self-closing tags, and auto-closing at EOF.
 */
export function parseBbCode(src: string): BbNode[] {
  const input = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let i = 0;
  const len = input.length;

  function parseNodes(stopTag?: string, depth = 0): BbNode[] {
    const nodes: BbNode[] = [];
    let textBuf = "";

    function flushText() {
      if (textBuf) {
        nodes.push({ type: "text", text: textBuf });
        textBuf = "";
      }
    }

    while (i < len) {
      if (input[i] === "\n") {
        flushText();
        nodes.push({ type: "br" });
        i++;
        while (i < len && input[i] === "\n") i++;
        continue;
      }

      if (input[i] === "[") {
        const tagMatch = readTag(input, i);
        if (tagMatch) {
          if (tagMatch.kind === "close") {
            if (stopTag && tagMatch.tag.toLowerCase() === stopTag.toLowerCase()) {
              flushText();
              i = tagMatch.nextIndex;
              return nodes;
            } else {
              textBuf += `[/${tagMatch.tag}]`;
              i = tagMatch.nextIndex;
              continue;
            }
          }

          if (tagMatch.kind === "self") {
            flushText();
            nodes.push({ type: "tag", tag: tagMatch.tag, attrs: tagMatch.attrs, children: [] });
            i = tagMatch.nextIndex;
            continue;
          }

          if (tagMatch.kind === "open") {
            flushText();
            i = tagMatch.nextIndex;
            if (depth < BB_MAX_DEPTH) {
              const children = parseNodes(tagMatch.tag, depth + 1);
              nodes.push({ type: "tag", tag: tagMatch.tag, attrs: tagMatch.attrs, children });
            } else {
              textBuf += `[${tagMatch.tag}]`;
            }
            continue;
          }
        }
      }

      textBuf += input[i];
      i++;
    }

    flushText();
    return nodes;
  }

  return parseNodes();
}
