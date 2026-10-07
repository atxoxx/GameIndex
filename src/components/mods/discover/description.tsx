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

const TAG_RE = /\[(\/)?([a-zA-Z*]+)(?:=([^\]]*))?\]/g;
const SELF_CLOSING = new Set(["hr", "br"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(input)) !== null) {
    if (m.index > last) tokens.push({ t: "text", v: input.slice(last, m.index) });
    const tag = m[2].toLowerCase();
    if (m[1]) tokens.push({ t: "close", tag });
    else tokens.push({ t: "open", tag, val: m[3] });
    last = TAG_RE.lastIndex;
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
      if (tok.tag === "*") {
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
    .replace(/&#0?39;/g, "'");
}

function normalize(raw: string): string {
  let s = raw;
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*(p|div|h[1-6]|tr)\s*>/gi, "\n\n");
  s = s.replace(/<\s*li[^>]*>/gi, "\n[*]");
  s = s.replace(/<\s*a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi, "[url=$1]$2[/url]");
  s = s.replace(/<\s*img[^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>/gi, "[img]$1[/img]");
  s = s.replace(/<\s*(b|strong)\s*>/gi, "[b]").replace(/<\s*\/\s*(b|strong)\s*>/gi, "[/b]");
  s = s.replace(/<\s*(i|em)\s*>/gi, "[i]").replace(/<\s*\/\s*(i|em)\s*>/gi, "[/i]");
  s = s.replace(/<\s*u\s*>/gi, "[u]").replace(/<\s*\/\s*u\s*>/gi, "[/u]");
  s = s.replace(/<\s*(s|strike|del)\s*>/gi, "[s]").replace(/<\s*\/\s*(s|strike|del)\s*>/gi, "[/s]");
  s = s.replace(/<\s*code\s*>/gi, "[code]").replace(/<\s*\/\s*code\s*>/gi, "[/code]");
  s = s.replace(/<\s*blockquote\s*>/gi, "[quote]").replace(/<\s*\/\s*blockquote\s*>/gi, "[/quote]");
  s = s.replace(/<\s*video[^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>(?:<\s*\/\s*video\s*>)?/gi, "[video]$1[/video]");
  s = s.replace(/<[^>]+>/g, "");
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
        const kind = mediaKind(part);
        if (kind === "video") {
          out.push(renderMedia(part, `${key}-v-${li}-${pi}`, ctx));
        } else {
          out.push(
            <a
              key={`${key}-a-${li}-${pi}`}
              className="mods-mod-desc-link"
              href={part}
              onClick={(e) => {
                e.preventDefault();
                ctx.openUrl(part);
              }}
            >
              {part}
            </a>,
          );
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
    case "code":
      return (
        <code key={key} className="mods-mod-desc-code">
          {inner()}
        </code>
      );
    case "quote":
      return (
        <blockquote key={key} className="mods-mod-desc-quote">
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
      const href = (node.val ?? "").trim();
      if (!href) return <span key={key}>{inner()}</span>;
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
    case "list":
      return <ul key={key} className="mods-mod-desc-list">{inner()}</ul>;
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
