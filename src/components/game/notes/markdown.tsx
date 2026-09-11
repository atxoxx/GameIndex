import { useMemo, type ReactNode } from "react";

/**
 * Minimal, dependency-free Markdown renderer for the Notes tab preview.
 *
 * Supports the subset guide/checklist authors actually reach for:
 * headings, paragraphs, fenced code, blockquotes, ordered/unordered
 * lists, task lists, horizontal rules, images, links, bold, italic,
 * strikethrough, and inline code. Everything is rendered as React
 * elements, so raw HTML in a note is displayed as text — no
 * `dangerouslySetInnerHTML`, no XSS surface.
 */

const INLINE_RE =
  /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*]+?)\*|_([^_]+?)_|(https?:\/\/[^\s<>()]+)/g;

/** Only web/mail schemes are clickable; anything else renders as text. */
function safeHref(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const k = `${keyPrefix}-${key++}`;
    if (match[1] !== undefined && match[2] !== undefined) {
      if (/^https?:\/\//i.test(match[2])) {
        out.push(
          <img
            key={k}
            className="note-markdown__image"
            src={match[2]}
            alt={match[1]}
            loading="lazy"
          />,
        );
      } else {
        out.push(`![${match[1]}](${match[2]})`);
      }
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const href = safeHref(match[4]);
      if (href) {
        const external = /^https?:\/\//i.test(href);
        out.push(
          <a
            key={k}
            className="note-markdown__link"
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
          >
            {match[3]}
          </a>,
        );
      } else {
        out.push(`${match[3]} (${match[4]})`);
      }
    } else if (match[5] !== undefined) {
      out.push(
        <code key={k} className="note-markdown__code-inline">
          {match[5]}
        </code>,
      );
    } else if (match[6] !== undefined || match[7] !== undefined) {
      out.push(<strong key={k}>{match[6] ?? match[7]}</strong>);
    } else if (match[8] !== undefined) {
      out.push(<del key={k}>{match[8]}</del>);
    } else if (match[9] !== undefined || match[10] !== undefined) {
      out.push(<em key={k}>{match[9] ?? match[10]}</em>);
    } else if (match[11] !== undefined) {
      out.push(
        <a
          key={k}
          className="note-markdown__link"
          href={match[11]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {match[11]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "tasks"; items: { text: string; done: boolean }[] }
  | { kind: "hr" };

const HR_RE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /^\s*```(.*)$/;

/** Split a Markdown document into block-level structures. */
export function parseBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const lang = fence[1].trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // consume closing fence (or run off the end)
      blocks.push({ kind: "code", lang, lines: code });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quote.push(lines[i].match(QUOTE_RE)?.[1] ?? "");
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }

    if (TASK_RE.test(line)) {
      const items: { text: string; done: boolean }[] = [];
      let m: RegExpMatchArray | null;
      while (i < lines.length && (m = lines[i].match(TASK_RE))) {
        items.push({ text: m[2], done: m[1].toLowerCase() === "x" });
        i += 1;
      }
      blocks.push({ kind: "tasks", items });
      continue;
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? lines[i].match(OL_RE) : lines[i].match(UL_RE);
        if (!m) break;
        items.push(m[1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i];
      if (
        next.trim() === "" ||
        HEADING_RE.test(next) ||
        FENCE_RE.test(next) ||
        HR_RE.test(next) ||
        QUOTE_RE.test(next) ||
        TASK_RE.test(next) ||
        UL_RE.test(next) ||
        OL_RE.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      i += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }

  return blocks;
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  const key = `b-${index}`;
  switch (block.kind) {
    case "heading": {
      const Tag = `h${Math.min(block.level, 6)}` as "h1";
      return (
        <Tag key={key} className="note-markdown__heading">
          {renderInline(block.text, key)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="note-markdown__paragraph">
          {block.lines.map((l, li) => (
            <span key={`${key}-${li}`}>
              {li > 0 && <br />}
              {renderInline(l, `${key}-${li}`)}
            </span>
          ))}
        </p>
      );
    case "code":
      return (
        <pre key={key} className="note-markdown__pre">
          <code>{block.lines.join("\n")}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key} className="note-markdown__quote">
          {block.lines.map((l, li) => (
            <p key={`${key}-${li}`}>{renderInline(l, `${key}-${li}`)}</p>
          ))}
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key} className="note-markdown__list">
          {block.items.map((item, ii) => (
            <li key={`${key}-${ii}`}>{renderInline(item, `${key}-${ii}`)}</li>
          ))}
        </Tag>
      );
    }
    case "tasks":
      return (
        <ul key={key} className="note-markdown__tasks">
          {block.items.map((item, ii) => (
            <li key={`${key}-${ii}`} className={item.done ? "is-done" : undefined}>
              <input type="checkbox" checked={item.done} readOnly tabIndex={-1} />
              <span>{renderInline(item.text, `${key}-${ii}`)}</span>
            </li>
          ))}
        </ul>
      );
    case "hr":
      return <hr key={key} className="note-markdown__hr" />;
    default:
      return null;
  }
}

export default function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="note-markdown">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}
