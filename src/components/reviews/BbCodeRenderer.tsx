import React, { useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  type BbNode,
  BB_MAX_OUTPUT,
  isSafeUrl,
  parseBbCode,
  stripHtml,
} from "./bbcodeParser";

interface BbCodeRendererProps {
  text: string;
  highlightQuery?: string;
}

export function BbCodeRenderer({ text, highlightQuery }: BbCodeRendererProps) {
  const nodes = useMemo(() => {
    if (!text) return [];
    let safe = text;
    if (safe.length > BB_MAX_OUTPUT) {
      safe = safe.slice(0, BB_MAX_OUTPUT);
    }
    safe = stripHtml(safe);

    const ast = parseBbCode(safe);
    return renderAst(ast, highlightQuery);
  }, [text, highlightQuery]);

  return <>{nodes}</>;
}

function renderAst(ast: BbNode[], highlightQuery?: string, keyPrefix = "n"): React.ReactNode[] {
  return ast.map((node, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (node.type === "text") {
      return renderHighlightedText(node.text, highlightQuery, key);
    }
    if (node.type === "br") {
      return <br key={key} />;
    }
    if (node.type === "tag") {
      const childNodes = renderAst(node.children, highlightQuery, `${key}-c`);
      return renderTagNode(node.tag, node.attrs, childNodes, key);
    }
    return null;
  });
}

function renderHighlightedText(text: string, query?: string, keyPrefix?: string): React.ReactNode {
  if (!query || !query.trim() || !text) {
    return text;
  }
  const q = query.trim();
  const lower = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const idx = lower.indexOf(lowerQ);
  if (idx === -1) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let matchIdx = lower.indexOf(lowerQ, lastIdx);

  while (matchIdx !== -1) {
    if (matchIdx > lastIdx) {
      parts.push(text.slice(lastIdx, matchIdx));
    }
    const matchedStr = text.slice(matchIdx, matchIdx + q.length);
    parts.push(
      <mark key={`${keyPrefix}-m-${matchIdx}`} className="rv-highlight">
        {matchedStr}
      </mark>,
    );
    lastIdx = matchIdx + q.length;
    matchIdx = lower.indexOf(lowerQ, lastIdx);
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return <React.Fragment key={keyPrefix}>{parts}</React.Fragment>;
}

function renderTagNode(
  tag: string,
  attrs: Record<string, string> | undefined,
  children: React.ReactNode[],
  key: string,
): React.ReactNode {
  switch (tag.toLowerCase()) {
    case "b":
      return <strong key={key}>{children}</strong>;
    case "i":
      return <em key={key}>{children}</em>;
    case "u":
      return <u key={key}>{children}</u>;
    case "s":
      return <s key={key}>{children}</s>;
    case "code":
      return (
        <code key={key} className="rv-bbcode">
          {children}
        </code>
      );
    case "h1":
      return (
        <h4 key={key} className="rv-bbcode rv-bbcode-h1">
          {children}
        </h4>
      );
    case "h2":
      return (
        <h4 key={key} className="rv-bbcode rv-bbcode-h2">
          {children}
        </h4>
      );
    case "h3":
      return (
        <h4 key={key} className="rv-bbcode rv-bbcode-h3">
          {children}
        </h4>
      );
    case "hr":
      return <hr key={key} className="rv-bbcode-hr" />;
    case "img": {
      const src = attrs?.src ?? attrs?.href ?? "";
      if (!isSafeUrl(src)) return null;
      return (
        <img
          key={key}
          src={src}
          alt="Review attachment"
          loading="lazy"
          className="rv-bbcode-img"
        />
      );
    }
    case "url": {
      const href = attrs?.href ?? attrs?.url ?? "";
      if (!isSafeUrl(href)) return <React.Fragment key={key}>{children}</React.Fragment>;
      return (
        <a
          key={key}
          className="rv-bbcode-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    }
    case "list":
      return (
        <ul key={key} className="rv-bbcode-list">
          {children}
        </ul>
      );
    case "olist":
      return (
        <ol key={key} className="rv-bbcode-list">
          {children}
        </ol>
      );
    case "*":
      return <li key={key}>{children}</li>;
    case "spoiler":
      return <SpoilerBlock key={key}>{children}</SpoilerBlock>;
    case "quote": {
      const author = attrs?.user || attrs?.author;
      return (
        <blockquote key={key} className="rv-bbcode-quote">
          {author && <cite className="rv-bbcode-quote-author">{author}:</cite>}
          {children}
        </blockquote>
      );
    }
    case "color": {
      const color = attrs?.color;
      const safeColor = color && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(color) ? color : undefined;
      return (
        <span key={key} style={safeColor ? { color: safeColor } : undefined}>
          {children}
        </span>
      );
    }
    default:
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

function SpoilerBlock({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [revealed, setRevealed] = useState(false);

  const hasContent = React.Children.count(children) > 0 && 
    React.Children.toArray(children).some(c => typeof c !== "string" || c.trim().length > 0);

  return (
    <span
      className={`rv-bbcode-spoiler${revealed ? " revealed" : ""}`}
      onClick={() => setRevealed((prev) => !prev)}
      role="button"
      tabIndex={0}
      title={revealed ? t("review.hideSpoiler") : t("review.clickRevealSpoiler")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed((prev) => !prev);
        }
      }}
    >
      {revealed ? (
        hasContent ? children : <em className="rv-bbcode-spoiler-empty">({t("common.noContent")})</em>
      ) : (
        <span className="rv-bbcode-spoiler-mask">{t("review.clickRevealSpoiler")}</span>
      )}
    </span>
  );
}
