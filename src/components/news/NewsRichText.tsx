import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Play } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { bbNodesToText, safeHttpUrl, type BbNode } from "../../utils/bbcode";
import {
  decodeHtmlEntities,
  parseNewsContent,
  parseYouTubeVideoId,
  sanitizeNewsHtml,
  youTubeWatchUrl,
} from "./newsContent";
import "../../styles/news-rich.css";

export interface NewsRichTextProps {
  content: string;
  variant?: "reader" | "bigscreen";
  onOpenLink?: (url: string) => void;
  className?: string;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

interface RenderContext {
  t: Translate;
  onOpenLink?: (url: string) => void;
}

/**
 * Renders a news body from any of the three shapes the feeds produce:
 * Steam BBCode, sanitized feed HTML, or plain text. Links are routed through
 * `onOpenLink` so the caller decides how a URL opens (the desktop reader
 * switches to its built-in full-page view).
 */
export function NewsRichText({
  content,
  variant = "reader",
  onOpenLink,
  className,
}: NewsRichTextProps) {
  const { t } = useLanguage();
  const parsed = useMemo(() => parseNewsContent(content ?? ""), [content]);

  return (
    <div className={`news-rich news-rich--${variant}${className ? ` ${className}` : ""}`}>
      {parsed.kind === "bbcode" && <BbContent nodes={parsed.nodes} t={t} onOpenLink={onOpenLink} />}
      {parsed.kind === "html" && <HtmlContent html={parsed.html} onOpenLink={onOpenLink} />}
      {parsed.kind === "text" &&
        parsed.paragraphs.map((paragraph, index) => (
          <p key={`p-${index}`} className="news-rich__p">
            {decodeHtmlEntities(paragraph)}
          </p>
        ))}
    </div>
  );
}

export default NewsRichText;

// ---------------------------------------------------------------------------
// BBCode
// ---------------------------------------------------------------------------

function BbContent({
  nodes,
  t,
  onOpenLink,
}: {
  nodes: BbNode[];
  t: Translate;
  onOpenLink?: (url: string) => void;
}) {
  const ctx: RenderContext = { t, onOpenLink };
  const blocks: ReactNode[] = [];
  let inline: BbNode[] = [];

  const flushInline = (index: number) => {
    const trimmed = trimInlineRun(inline);
    inline = [];
    if (trimmed.length === 0) return;
    blocks.push(
      <p key={`p-${index}`} className="news-rich__p">
        {renderNodes(trimmed, ctx, `p-${index}`)}
      </p>,
    );
  };

  nodes.forEach((node, index) => {
    if (isBlockNode(node)) {
      flushInline(index);
      blocks.push(renderNodes([node], ctx, `b-${index}`)[0]);
      return;
    }
    inline.push(node);
  });
  flushInline(nodes.length);

  return <>{blocks}</>;
}

const BLOCK_TAGS = new Set([
  "p",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "heading",
  "list",
  "olist",
  "quote",
  "spoiler",
  "code",
  "table",
  "center",
  "left",
  "right",
  "parsehtml",
  "img",
  "video",
  "previewyoutube",
]);

const INLINE_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "url",
  "size",
  "font",
  "color",
  "readmore",
  "noparse",
]);

function isBlockNode(node: BbNode): boolean {
  if (node.type !== "tag") return false;
  if (BLOCK_TAGS.has(node.tag)) return true;
  if (INLINE_TAGS.has(node.tag)) return node.children.some(isBlockNode);
  // Unknown tags may hold block content; keep them out of paragraphs.
  return true;
}

function trimInlineRun(nodes: BbNode[]): BbNode[] {
  const isBlank = (node: BbNode) =>
    node.type === "br" || (node.type === "text" && node.text.trim() === "");
  let start = 0;
  let end = nodes.length;
  while (start < end && isBlank(nodes[start])) start++;
  while (end > start && isBlank(nodes[end - 1])) end--;
  return nodes.slice(start, end);
}

function renderNodes(nodes: BbNode[], ctx: RenderContext, keyPrefix = "n"): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") return decodeHtmlEntities(node.text);
    if (node.type === "br") return <br key={key} />;
    return renderTagNode(node, ctx, key);
  });
}

function renderTagNode(
  node: Extract<BbNode, { type: "tag" }>,
  ctx: RenderContext,
  key: string,
): ReactNode {
  const { tag, attrs, children } = node;
  const rendered = renderNodes(children, ctx, `${key}-c`);
  const textContent = bbNodesToText(children).trim();
  const plainContent = decodeHtmlEntities(textContent).trim();

  switch (tag) {
    case "b":
    case "strong":
      return <strong key={key}>{rendered}</strong>;
    case "i":
    case "em":
      return <em key={key}>{rendered}</em>;
    case "u":
      return <u key={key}>{rendered}</u>;
    case "s":
    case "strike":
    case "del":
      return <s key={key}>{rendered}</s>;
    case "code":
      return (
        <pre key={key} className="news-rich__code">
          <code>{plainContent}</code>
        </pre>
      );
    case "h1":
    case "h2":
    case "heading":
      return (
        <h3 key={key} className="news-rich__heading news-rich__heading--1">
          {rendered}
        </h3>
      );
    case "h3":
    case "h4":
      return (
        <h4 key={key} className="news-rich__heading news-rich__heading--2">
          {rendered}
        </h4>
      );
    case "h5":
    case "h6":
      return (
        <h5 key={key} className="news-rich__heading news-rich__heading--3">
          {rendered}
        </h5>
      );
    case "p":
      return (
        <p key={key} className="news-rich__p">
          {rendered}
        </p>
      );
    case "br":
      return <br key={key} />;
    case "hr":
      return <hr key={key} className="news-rich__hr" />;
    case "list":
    case "olist": {
      // Steam writes newlines between items; those would be invalid `<br>`
      // children of `<ul>`/`<ol>`, so only real content is kept.
      const items = children.filter(
        (child) => child.type !== "br" && !(child.type === "text" && child.text.trim() === ""),
      );
      const itemNodes = renderNodes(items, ctx, `${key}-c`);
      return tag === "list" ? (
        <ul key={key} className="news-rich__list">
          {itemNodes}
        </ul>
      ) : (
        <ol key={key} className="news-rich__list">
          {itemNodes}
        </ol>
      );
    }
    case "*":
      return <li key={key}>{rendered}</li>;
    case "quote": {
      const author = attrs?.user || attrs?.author || attrs?.value;
      return (
        <blockquote key={key} className="news-rich__quote">
          {author && <cite className="news-rich__quote-author">{author}</cite>}
          {rendered}
        </blockquote>
      );
    }
    case "spoiler":
      return (
        <Spoiler key={key} t={ctx.t}>
          {rendered}
        </Spoiler>
      );
    case "url": {
      const href = safeHttpUrl(attrs?.href ?? attrs?.url ?? plainContent);
      if (!href) return <Fragment key={key}>{rendered}</Fragment>;
      return (
        <RichLink key={key} href={href} onOpenLink={ctx.onOpenLink}>
          {attrs?.href || attrs?.url ? rendered : href}
        </RichLink>
      );
    }
    case "img": {
      const src = attrs?.src ?? attrs?.href ?? attrs?.value ?? plainContent;
      return <RichImage key={key} src={src} title={attrs?.title} t={ctx.t} />;
    }
    case "table": {
      const hasSections = children.some(
        (child) =>
          child.type === "tag" && (child.tag === "thead" || child.tag === "tbody"),
      );
      return (
        <div key={key} className="news-rich__table">
          <table>{hasSections ? rendered : <tbody>{rendered}</tbody>}</table>
        </div>
      );
    }
    case "tr":
      return <tr key={key}>{rendered}</tr>;
    case "td":
      return <td key={key}>{rendered}</td>;
    case "th":
      return <th key={key}>{rendered}</th>;
    case "center":
    case "left":
    case "right":
      return (
        <div key={key} className={`news-rich__align news-rich__align--${tag}`}>
          {rendered}
        </div>
      );
    case "size":
    case "font":
    case "color":
    case "readmore":
      // Deliberately transparent: the reader theme owns typography and colour.
      return <Fragment key={key}>{rendered}</Fragment>;
    case "noparse":
      return <Fragment key={key}>{plainContent}</Fragment>;
    case "parsehtml":
      return (
        <div
          key={key}
          className="news-rich__html"
          dangerouslySetInnerHTML={{ __html: sanitizeNewsHtml(plainContent) }}
          onClick={(event) => handleHtmlAnchorClick(event, ctx.onOpenLink)}
        />
      );
    case "previewyoutube": {
      const videoId = parseYouTubeVideoId(attrs?.value ?? attrs?.href);
      if (!videoId) return <Fragment key={key}>{rendered}</Fragment>;
      return (
        <VideoCard
          key={key}
          url={youTubeWatchUrl(videoId)}
          label={ctx.t("news.rich.watchOnYouTube")}
          onOpenLink={ctx.onOpenLink}
        />
      );
    }
    case "video": {
      const url = safeHttpUrl(attrs?.href ?? attrs?.value ?? plainContent);
      if (!url) return <Fragment key={key}>{rendered}</Fragment>;
      return (
        <VideoCard
          key={key}
          url={url}
          label={ctx.t("news.rich.watchVideo")}
          onOpenLink={ctx.onOpenLink}
        />
      );
    }
    default:
      // Unknown tag: keep its content as plain text rather than leaking tags.
      return <Fragment key={key}>{rendered}</Fragment>;
  }
}

function RichLink({
  href,
  onOpenLink,
  children,
}: {
  href: string;
  onOpenLink?: (url: string) => void;
  children: ReactNode;
}) {
  if (onOpenLink) {
    return (
      <a
        href={href}
        rel="noopener noreferrer"
        onClick={(event) => {
          event.preventDefault();
          onOpenLink(href);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function RichImage({ src, title, t }: { src: string; title?: string; t: Translate }) {
  const safeSrc = safeHttpUrl(src);
  if (!safeSrc) return null;
  const alt = title?.trim() || t("news.rich.imageAlt");
  return (
    <figure className="news-rich__figure">
      <img
        className="news-rich__img"
        src={safeSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={(event) => {
          const figure = event.currentTarget.closest("figure");
          if (figure instanceof HTMLElement) figure.hidden = true;
        }}
      />
      {title?.trim() && <figcaption className="news-rich__figcaption">{title}</figcaption>}
    </figure>
  );
}

function Spoiler({ t, children }: { t: Translate; children: ReactNode }) {
  return (
    <details className="news-rich__spoiler">
      <summary className="news-rich__spoiler-summary">
        <span className="news-rich__spoiler-show">{t("news.rich.spoilerShow")}</span>
        <span className="news-rich__spoiler-hide">{t("news.rich.spoilerHide")}</span>
      </summary>
      <div className="news-rich__spoiler-body">{children}</div>
    </details>
  );
}

function VideoCard({
  url,
  label,
  onOpenLink,
}: {
  url: string;
  label: string;
  onOpenLink?: (url: string) => void;
}) {
  return (
    <a
      className="news-rich__video-card"
      href={url}
      rel="noopener noreferrer"
      {...(onOpenLink
        ? {
            onClick: (event: MouseEvent<HTMLAnchorElement>) => {
              event.preventDefault();
              onOpenLink(url);
            },
          }
        : { target: "_blank" })}
    >
      <span className="news-rich__video-icon" aria-hidden="true">
        <Play size={18} />
      </span>
      <span className="news-rich__video-text">
        <span className="news-rich__video-title">{label}</span>
        <span className="news-rich__video-url">{url}</span>
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function handleHtmlAnchorClick(
  event: MouseEvent<HTMLDivElement>,
  onOpenLink?: (url: string) => void,
) {
  const target = event.target as HTMLElement | null;
  const anchor = target?.closest?.("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href) return;
  event.preventDefault();
  if (onOpenLink) {
    onOpenLink(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

function HtmlContent({ html, onOpenLink }: { html: string; onOpenLink?: (url: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const image of Array.from(root.querySelectorAll("img"))) {
      image.setAttribute("loading", "lazy");
      image.setAttribute("decoding", "async");
      image.setAttribute("referrerpolicy", "no-referrer");
      image.addEventListener(
        "error",
        () => {
          image.style.display = "none";
        },
        { once: true },
      );
    }
  }, [html]);

  return (
    <div
      ref={ref}
      className="news-rich__html"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => handleHtmlAnchorClick(event, onOpenLink)}
    />
  );
}
