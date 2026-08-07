// BigScreenDocsPage — controller-first user guide for Big Screen Mode.
//
// Renders the SAME content as the desktop DocsPage (the `docs.*` i18n
// keys — each section is `docs.<id>.title` + `docs.<id>.body`), including
// the same inline-markdown flavour ([link](url), `code`, **bold**,
// *italic*, keyboard chips) and bullet/paragraph block parsing.
//
// The desktop DocsPage's helpers are module-private, so the light-weight
// parser below re-implements the same rules (kept in sync by convention).
// Layout: a BigScreenBackHeader on top + a fully focusable scroll region
// (`.bigscreen-dashboard-scrollable-content`) — the spatial-nav engine
// auto-scrolls the focused element into view inside it.

import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useGamepad } from "../../hooks/GamepadProvider";
import BigScreenBackHeader from "./BigScreenBackHeader";

// Order of sections — identical to the desktop page's SECTION_IDS so the
// guide reads the same everywhere. Ids double as i18n key suffixes.
const SECTION_IDS = [
  "welcome",
  "firststeps",
  "layout",
  "library",
  "gamedetails",
  "sidebar",
  "topnav",
  "store",
  "wishlist",
  "deals",
  "news",
  "activity",
  "achievements",
  "downloads",
  "storage",
  "emulators",
  "mods",
  "community",
  "settings",
  "bigscreen",
  "shortcuts",
  "tips",
] as const;

// Inline formatting inside prose: [label](url), `code`, **bold**,
// *italic*, and keyboard-key chips (same regex as the desktop page).
const INLINE_RE =
  /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+?)\*\*|\*([^*]+?)\*|(F\d{1,2}|Ctrl\+[A-Za-z0-9]+|Shift\+[A-Za-z0-9]+|Alt\+[A-Za-z0-9]+|Cmd\+[A-Za-z0-9]+|Meta\+[A-Za-z0-9]+|Escape|Enter|Backspace|Tab|Space|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined && m[2] !== undefined) {
      // Markdown link [text](url)
      const isExternal = m[2].startsWith("http://") || m[2].startsWith("https://");
      out.push(
        <a
          href={m[2]}
          key={`a-${key++}`}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
        >
          {m[1]}
        </a>
      );
    } else if (m[3] !== undefined) {
      out.push(
        <code key={`c-${key++}`}>
          {m[3]}
        </code>
      );
    } else if (m[4] !== undefined) {
      out.push(<strong key={`b-${key++}`}>{m[4]}</strong>);
    } else if (m[5] !== undefined) {
      out.push(<em key={`i-${key++}`}>{m[5]}</em>);
    } else if (m[6] !== undefined) {
      out.push(
        <kbd key={`k-${key++}`}>
          {m[6]}
        </kbd>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface BulletItem {
  text: string;
  children: BulletItem[];
}

function renderBulletItems(items: BulletItem[]): ReactNode[] {
  return items.map((it, i) => (
    <li key={i} className="bigscreen-docs-li">
      <span aria-hidden className="bigscreen-docs-li-dot" />
      <div>
        {renderInline(it.text)}
        {it.children.length > 0 && (
          <ul>
            {renderBulletItems(it.children)}
          </ul>
        )}
      </div>
    </li>
  ));
}

/** Render a docs body string into structured block components. */
function DocBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let rootItems: BulletItem[] = [];
  let stack: { level: number; items: BulletItem[] }[] = [
    { level: -1, items: rootItems },
  ];

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p-${blocks.length}`}>
          {renderInline(para.join(" "))}
        </p>
      );
      para = [];
    }
  };

  const flushList = () => {
    if (rootItems.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {renderBulletItems(rootItems)}
        </ul>
      );
      rootItems = [];
      stack = [{ level: -1, items: rootItems }];
    }
  };

  for (const raw of lines) {
    const indent = raw.length - raw.replace(/^\s+/, "").length;
    const trimmed = raw.trim();

    if (trimmed === "") {
      flushPara();
      flushList();
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push(
        <h3 key={`h-${blocks.length}`}>
          {renderInline(trimmed.slice(3))}
        </h3>
      );
      continue;
    }

    const bm = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bm) {
      flushPara();
      const level = Math.floor(indent / 2);
      const item: BulletItem = { text: bm[1], children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack[stack.length - 1].items.push(item);
      stack.push({ level, items: item.children });
      continue;
    }

    flushList();
    para.push(trimmed);
  }

  flushPara();
  flushList();

  return <>{blocks}</>;
}

export default function BigScreenDocsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { registerBackHandler } = useGamepad();

  // B button goes back to wherever the user came from (System hub,
  // home, …). No overlay claims B while none of our modals are open.
  useEffect(
    () => registerBackHandler(() => navigate(-1)),
    [registerBackHandler, navigate],
  );

  return (
    <div className="bigscreen-library-dashboard">
      <BigScreenBackHeader
        title={t("bigscreen.docs.title")}
        subtitle={t("docs.subtitle")}
      />

      {/* Fully focusable scroll region — spatial navigation scrolls the
          focused element into view automatically. */}
      <div className="bigscreen-dashboard-scrollable-content bigscreen-docs-content">
        {SECTION_IDS.map((id) => (
          <section key={id}>
            <h2>
              {t(`docs.${id}.title`)}
            </h2>
            <DocBody text={t(`docs.${id}.body`)} />
          </section>
        ))}
      </div>
    </div>
  );
}
