// Mod descriptions arrive as a mix of BBCode (Nexus, GameBanana) and
// HTML. This parses either into React nodes — never innerHTML — so
// remote content can't execute script, and pulls out images/videos so
// the caller can drive a lightbox.

import type { ReactNode } from "react";

export interface MediaItem {
  type: "image" | "video";
  url: string;
  /** Player URL for embeddable videos (YouTube/Vimeo). */
  embedUrl?: string;
  /** Poster image for video cards. */
  poster?: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i;

export function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
  );
  return m ? m[1] : null;
}

export function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

export function mediaKind(url: string): "image" | "video" | null {
  if (!url) return null;
  if (youtubeId(url) || vimeoId(url) || VIDEO_EXT.test(url)) return "video";
  if (IMAGE_EXT.test(url)) return "image";
  return null;
}

export function buildMediaItem(url: string): MediaItem {
  const yt = youtubeId(url);
  if (yt) {
    return {
      type: "video",
      url,
      embedUrl: `https://www.youtube.com/embed/${yt}?autoplay=1`,
      poster: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`,
    };
  }
  const vm = vimeoId(url);
  if (vm) {
    return {
      type: "video",
      url,
      embedUrl: `https://player.vimeo.com/video/${vm}?autoplay=1`,
    };
  }
  if (VIDEO_EXT.test(url)) return { type: "video", url };
  return { type: "image", url };
}

// ── BBCode tokenizer ────────────────────────────────────────────────

interface TextToken {
  t: "text";
  v: string;
}
interface OpenToken {
  t: "open";
  tag: string;
  val?: string;
}
interface CloseToken {
  t: "close";
  tag: string;
}
type Token = TextToken | OpenToken | CloseToken;

const TAG_RE = /\[(\/)?([a-zA-Z0-9*_-]+)(?:=([^\]]*))?\]/g;
const SELF_CLOSING = new Set(["hr", "br"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(input)) !== null) {
    if (m.index > last) tokens.push({ t: "text", v: input.slice(last, m.index) });
    const isClose = Boolean(m[1]);
    const tag = m[2].toLowerCase();
    const val = m[3];
    last = TAG_RE.lastIndex;

    // Steam [noparse]...[/noparse] skips BBCode parsing for inner text
    if (!isClose && tag === "noparse") {
      const closeIdx = input.toLowerCase().indexOf("[/noparse]", last);
      if (closeIdx !== -1) {
        tokens.push({ t: "text", v: input.slice(last, closeIdx) });
        TAG_RE.lastIndex = closeIdx + "[/noparse]".length;
        last = TAG_RE.lastIndex;
        continue;
      }
    }

    if (isClose) tokens.push({ t: "close", tag });
    else tokens.push({ t: "open", tag, val });
  }
  if (last < input.length) tokens.push({ t: "text", v: input.slice(last) });
  return tokens;
}

interface BbNode {
  tag: string | null;
  val?: string;
  children: (BbNode | string)[];
}

function buildTree(tokens: Token[]): BbNode {
  const root: BbNode = { tag: null, children: [] };
  const stack: BbNode[] = [root];
  for (const tok of tokens) {
    if (tok.t === "text") {
      stack[stack.length - 1].children.push(tok.v);
    } else if (tok.t === "open") {
      if (tok.tag === "*" || tok.tag === "li") {
        while (stack.length > 1 && stack[stack.length - 1].tag === "li") stack.pop();
        const li: BbNode = { tag: "li", children: [] };
        stack[stack.length - 1].children.push(li);
        stack.push(li);
        continue;
      }
      const node: BbNode = { tag: tok.tag, val: tok.val, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!SELF_CLOSING.has(tok.tag)) stack.push(node);
    } else {
      if (SELF_CLOSING.has(tok.tag)) continue;
      if (tok.tag === "*" || tok.tag === "li") {
        if (stack.length > 1 && stack[stack.length - 1].tag === "li") {
          stack.pop();
        }
        continue;
      }
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tag === tok.tag) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return root;
}

// ── HTML → BBCode normalisation ─────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isNaN(code) ? "" : String.fromCharCode(code);
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isNaN(code) ? "" : String.fromCharCode(code);
    });
}

function normalize(raw: string): string {
  let s = raw;
  // Convert HTML break / block endings
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*(p|div|tr)\s*>/gi, "\n\n");
  s = s.replace(/<\s*hr\s*\/?\s*>/gi, "\n[hr]\n");
  s = s.replace(/<\s*li[^>]*>/gi, "\n[*]");
  s = s.replace(/<\s*a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi, "[url=$1]$2[/url]");
  s = s.replace(/<\s*img[^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>/gi, "[img]$1[/img]");
  s = s.replace(/<\s*(b|strong)\s*>/gi, "[b]").replace(/<\s*\/\s*(b|strong)\s*>/gi, "[/b]");
  s = s.replace(/<\s*(i|em)\s*>/gi, "[i]").replace(/<\s*\/\s*(i|em)\s*>/gi, "[/i]");
  s = s.replace(/<\s*u\s*>/gi, "[u]").replace(/<\s*\/\s*u\s*>/gi, "[/u]");
  s = s.replace(/<\s*(s|strike|del)\s*>/gi, "[s]").replace(/<\s*\/\s*(s|strike|del)\s*>/gi, "[/s]");
  s = s.replace(/<\s*code\s*>/gi, "[code]").replace(/<\s*\/\s*code\s*>/gi, "[/code]");
  s = s.replace(/<\s*pre[^>]*>/gi, "[pre]").replace(/<\s*\/\s*pre\s*>/gi, "[/pre]");
  s = s.replace(/<\s*blockquote\s*>/gi, "[quote]").replace(/<\s*\/\s*blockquote\s*>/gi, "[/quote]");
  s = s.replace(/<\s*video[^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>(?:<\s*\/\s*video\s*>)?/gi, "[video]$1[/video]");

  // HTML headings to BBCode headings
  s = s.replace(/<\s*h1[^>]*>([\s\S]*?)<\s*\/\s*h1\s*>/gi, "\n[h1]$1[/h1]\n");
  s = s.replace(/<\s*h2[^>]*>([\s\S]*?)<\s*\/\s*h2\s*>/gi, "\n[h2]$1[/h2]\n");
  s = s.replace(/<\s*h3[^>]*>([\s\S]*?)<\s*\/\s*h3\s*>/gi, "\n[h3]$1[/h3]\n");
  s = s.replace(/<\s*h[4-6][^>]*>([\s\S]*?)<\s*\/\s*h[4-6]\s*>/gi, "\n[h3]$1[/h3]\n");

  // HTML table to BBCode table
  s = s.replace(/<\s*table[^>]*>/gi, "[table]").replace(/<\s*\/\s*table\s*>/gi, "[/table]");
  s = s.replace(/<\s*tr[^>]*>/gi, "[tr]").replace(/<\s*\/\s*tr\s*>/gi, "[/tr]");
  s = s.replace(/<\s*th[^>]*>/gi, "[th]").replace(/<\s*\/\s*th\s*>/gi, "[/th]");
  s = s.replace(/<\s*td[^>]*>/gi, "[td]").replace(/<\s*\/\s*td\s*>/gi, "[/td]");

  // Strip remaining HTML tags
  s = s.replace(/<[^>]+>/g, "");

  // Text divider lines: repeated equals/hyphens/underscores/tildes into [hr]
  s = s.replace(/[ \t]*={6,}[ \t]*/g, "\n[hr]\n");
  s = s.replace(/(?:^|\n)[ \t]*[-_*~]{6,}[ \t]*(?:\n|$)/g, "\n[hr]\n");

  // Markdown-style blockquotes (e.g. > some quote)
  s = s.replace(/(?:^|\n)[ \t]*>[ \t]*(.+)/g, "\n[quote]$1[/quote]");
  s = s.replace(/(?:\[\/quote\]\s*\[quote\])+/g, "\n");

  // Ensure headings have surrounding line breaks for clean block layout
  s = s.replace(/\[(h[1-6])\]\s*([\s\S]*?)\s*\[\/\1\]/gi, "\n[$1]$2[/$1]\n");

  return decodeEntities(s);
}

// ── Rendering ───────────────────────────────────────────────────────

interface RenderCtx {
  media: MediaItem[];
  onOpenMedia: (index: number) => void;
  spoilerLabel: string;
  openUrl: (url: string) => void;
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;
const FONT_RE = /^[A-Za-z0-9 ,\-]{1,40}$/;
const SIZE_PX: Record<string, string> = {
  "1": "0.75em",
  "2": "0.85em",
  "3": "1em",
  "4": "1.2em",
  "5": "1.5em",
  "6": "1.9em",
  "7": "2.4em",
};

const URL_RE = /(https?:\/\/[^\s[\]()]+)/g;

function cleanUrl(raw: string): { url: string; trailing: string } {
  const m = raw.match(/[.,;:!?)]+$/);
  if (m) {
    return {
      url: raw.slice(0, -m[0].length),
      trailing: m[0],
    };
  }
  return { url: raw, trailing: "" };
}

function renderText(text: string, key: string, ctx: RenderCtx): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  lines.forEach((line, li) => {
    if (li > 0) out.push(<br key={`${key}-br-${li}`} />);
    if (!line) return;
    const parts = line.split(URL_RE);
    parts.forEach((part, pi) => {
      if (!part) return;
      if (URL_RE.test(part)) {
        URL_RE.lastIndex = 0;
        const { url, trailing } = cleanUrl(part);
        const kind = mediaKind(url);
        if (kind === "video") {
          out.push(renderMedia(url, `${key}-v-${li}-${pi}`, ctx));
        } else {
          out.push(
            <a
              key={`${key}-a-${li}-${pi}`}
              className="mods-mod-desc-link"
              href={url}
              onClick={(e) => {
                e.preventDefault();
                ctx.openUrl(url);
              }}
            >
              {url}
            </a>,
          );
        }
        if (trailing) {
          out.push(trailing);
        }
      } else {
        out.push(part);
      }
    });
  });
  return out;
}

function renderMedia(url: string, key: string, ctx: RenderCtx): ReactNode {
  const item = buildMediaItem(url);
  const index = ctx.media.length;
  ctx.media.push(item);
  if (item.type === "image") {
    return (
      <img
        key={key}
        className="mods-mod-desc-image"
        src={item.url}
        alt=""
        loading="lazy"
        onClick={(e) => {
          e.stopPropagation();
          ctx.onOpenMedia(index);
        }}
      />
    );
  }
  return (
    <button
      key={key}
      type="button"
      className="mods-mod-desc-video"
      onClick={(e) => {
        e.stopPropagation();
        ctx.onOpenMedia(index);
      }}
      title={item.url}
    >
      {item.poster ? (
        <img src={item.poster} alt="" loading="lazy" />
      ) : (
        <span className="mods-mod-desc-video-fallback" />
      )}
      <span className="mods-mod-desc-video-play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </button>
  );
}

function renderChildren(children: (BbNode | string)[], key: string, ctx: RenderCtx): ReactNode[] {
  return children.map((child, i) =>
    typeof child === "string"
      ? renderText(child, `${key}-t${i}`, ctx)
      : renderNode(child, `${key}-n${i}`, ctx),
  );
}

function renderNode(node: BbNode, key: string, ctx: RenderCtx): ReactNode {
  const inner = () => renderChildren(node.children, key, ctx);
  switch (node.tag) {
    case "h1":
      return <h3 key={key} className="mods-mod-desc-h1">{inner()}</h3>;
    case "h2":
      return <h4 key={key} className="mods-mod-desc-h2">{inner()}</h4>;
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return <h5 key={key} className="mods-mod-desc-h3">{inner()}</h5>;
    case "b":
    case "strong":
      return <strong key={key}>{inner()}</strong>;
    case "i":
    case "em":
      return <em key={key}>{inner()}</em>;
    case "u":
      return <u key={key}>{inner()}</u>;
    case "s":
    case "strike":
    case "del":
      return <s key={key}>{inner()}</s>;
    case "sub":
      return <sub key={key}>{inner()}</sub>;
    case "sup":
      return <sup key={key}>{inner()}</sup>;
    case "code":
      return (
        <code key={key} className="mods-mod-desc-code">
          {inner()}
        </code>
      );
    case "pre":
      return (
        <pre key={key} className="mods-mod-desc-pre">
          <code>{inner()}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key} className="mods-mod-desc-quote">
          {node.val && (
            <div className="mods-mod-desc-quote-author">
              {node.val.replace(/^["']|["']$/g, "")}:
            </div>
          )}
          {inner()}
        </blockquote>
      );
    case "spoiler":
      return (
        <details key={key} className="mods-mod-desc-spoiler">
          <summary>{ctx.spoilerLabel}</summary>
          <div>{inner()}</div>
        </details>
      );
    case "center":
      return (
        <div key={key} className="mods-mod-desc-center">
          {inner()}
        </div>
      );
    case "size": {
      const size = node.val && SIZE_PX[node.val];
      return (
        <span key={key} style={size ? { fontSize: size } : undefined}>
          {inner()}
        </span>
      );
    }
    case "color": {
      const color = node.val && COLOR_RE.test(node.val) ? node.val : undefined;
      return (
        <span key={key} style={color ? { color } : undefined}>
          {inner()}
        </span>
      );
    }
    case "font": {
      const font = node.val && FONT_RE.test(node.val) ? node.val : undefined;
      return (
        <span key={key} style={font ? { fontFamily: font } : undefined}>
          {inner()}
        </span>
      );
    }
    case "url": {
      const target = (node.val ?? textOf(node)).trim().replace(/^["']|["']$/g, "");
      if (!target) return <span key={key}>{inner()}</span>;
      const href = /^[a-z]+:\/\//i.test(target) ? target : `https://${target}`;
      return (
        <a
          key={key}
          className="mods-mod-desc-link"
          href={href}
          onClick={(e) => {
            e.preventDefault();
            ctx.openUrl(href);
          }}
        >
          {inner()}
        </a>
      );
    }
    case "img":
      return renderMedia(textOf(node), key, ctx);
    case "video":
    case "youtube":
    case "vimeo":
      return renderMedia(videoUrl(node), key, ctx);
    case "previewyoutube": {
      // Steam: `[previewyoutube=VIDEO_ID][/previewyoutube]`.
      const raw = (node.val ?? textOf(node)).trim();
      const url = raw.startsWith("http")
        ? raw
        : `https://www.youtube.com/watch?v=${raw}`;
      return renderMedia(url, key, ctx);
    }
    case "table":
      return (
        <div key={key} className="mods-mod-desc-table-wrap">
          <table className="mods-mod-desc-table">
            <tbody>{inner()}</tbody>
          </table>
        </div>
      );
    case "tr":
      return <tr key={key}>{inner()}</tr>;
    case "th":
      return <th key={key} className="mods-mod-desc-th">{inner()}</th>;
    case "td":
      return <td key={key} className="mods-mod-desc-td">{inner()}</td>;
    case "list":
      if (node.val === "1" || node.val === "a" || node.val === "i") {
        return (
          <ol key={key} className="mods-mod-desc-list mods-mod-desc-list--ordered">
            {inner()}
          </ol>
        );
      }
      return <ul key={key} className="mods-mod-desc-list">{inner()}</ul>;
    case "olist":
      return (
        <ol key={key} className="mods-mod-desc-list mods-mod-desc-list--ordered">
          {inner()}
        </ol>
      );
    case "li":
      return <li key={key}>{inner()}</li>;
    case "hr":
      return <hr key={key} className="mods-mod-desc-hr" />;
    default:
      // Unknown tag: keep the content, drop the wrapper.
      return <span key={key}>{inner()}</span>;
  }
}

function textOf(node: BbNode): string {
  return node.children.filter((c): c is string => typeof c === "string").join("").trim();
}

function videoUrl(node: BbNode): string {
  const raw = textOf(node);
  const yt = youtubeId(raw);
  if (yt) return `https://www.youtube.com/watch?v=${yt}`;
  const vm = vimeoId(raw);
  if (vm) return `https://vimeo.com/${vm}`;
  return raw;
}

export interface ParsedDescription {
  node: ReactNode;
  media: MediaItem[];
}

export function parseDescription(
  raw: string,
  onOpenMedia: (index: number) => void,
  spoilerLabel: string,
  openUrl: (url: string) => void,
): ParsedDescription {
  const ctx: RenderCtx = { media: [], onOpenMedia, spoilerLabel, openUrl };
  const tree = buildTree(tokenize(normalize(raw)));
  const node = <div className="mods-mod-desc">{renderChildren(tree.children, "d", ctx)}</div>;
  return { node, media: ctx.media };
}
