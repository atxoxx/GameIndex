import type { ReactNode } from "react";
import {
  Activity,
  ArchiveRestore,
  BadgePercent,
  Command,
  Compass,
  Download,
  FlaskConical,
  Gamepad2,
  HardDrive,
  Heart,
  Keyboard,
  LayoutDashboard,
  Library,
  Lightbulb,
  Monitor,
  MonitorPlay,
  Navigation,
  Newspaper,
  PanelLeft,
  Puzzle,
  Rocket,
  Settings,
  SlidersHorizontal,
  Store,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Shared documentation model + markdown-ish renderer.
 *
 * Content lives entirely in i18n (`docs.<id>.title` / `docs.<id>.body`), so
 * the desktop DocsPage and the BigScreenDocsPage read the same definitions.
 * Each section body supports a small markdown flavour:
 *   - `## ` sub-headings, `**bold**`, `*italic*`
 *   - `- ` bullets (nested with two-space indentation)
 *   - `> ` callout blocks
 *   - `` `code` ``, `[links](url)` and keyboard chips (`Ctrl+K`, `F11`, …)
 */

export type DocGroupId = "start" | "use" | "discover" | "manage" | "linux" | "master";

export interface DocSectionDef {
  id: string;
  group: DocGroupId;
  icon: LucideIcon;
}

export const DOC_GROUPS: readonly DocGroupId[] = [
  "start",
  "use",
  "discover",
  "manage",
  "linux",
  "master",
];

// Order of sections in the guide. The same ids are used as anchor targets
// and as i18n key suffixes, so the TOC and content stay in sync.
export const DOC_SECTIONS: readonly DocSectionDef[] = [
  { id: "welcome", group: "start", icon: Rocket },
  { id: "firststeps", group: "start", icon: Compass },
  { id: "layout", group: "start", icon: LayoutDashboard },
  { id: "library", group: "use", icon: Library },
  { id: "gamedetails", group: "use", icon: Gamepad2 },
  { id: "sidebar", group: "use", icon: PanelLeft },
  { id: "topnav", group: "use", icon: Navigation },
  { id: "commandpalette", group: "use", icon: Command },
  { id: "store", group: "discover", icon: Store },
  { id: "wishlist", group: "discover", icon: Heart },
  { id: "deals", group: "discover", icon: BadgePercent },
  { id: "news", group: "discover", icon: Newspaper },
  { id: "activity", group: "manage", icon: Activity },
  { id: "achievements", group: "manage", icon: Trophy },
  { id: "downloads", group: "manage", icon: Download },
  { id: "storage", group: "manage", icon: HardDrive },
  { id: "emulators", group: "manage", icon: MonitorPlay },
  { id: "mods", group: "manage", icon: Puzzle },
  { id: "community", group: "manage", icon: Users },
  { id: "compatibility", group: "linux", icon: FlaskConical },
  { id: "interface", group: "master", icon: SlidersHorizontal },
  { id: "settings", group: "master", icon: Settings },
  { id: "backup", group: "master", icon: ArchiveRestore },
  { id: "bigscreen", group: "master", icon: Monitor },
  { id: "shortcuts", group: "master", icon: Keyboard },
  { id: "tips", group: "master", icon: Lightbulb },
];

export const DOC_SECTION_IDS: readonly string[] = DOC_SECTIONS.map((s) => s.id);

/** Human-readable reading time for a translated section body. */
export function docReadMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 180));
}

/** Approximate word count used for search/content stats. */
export function docWordCount(body: string): number {
  return body.trim().split(/\s+/).length;
}

// Inline formatting inside prose: [label](url), `code`, **bold**, *italic*, and keyboard-key chips.
const INLINE_RE =
  /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+?)\*\*|\*([^*]+?)\*|(F\d{1,2}|Ctrl\+[A-Za-z0-9]+|Shift\+[A-Za-z0-9]+|Alt\+[A-Za-z0-9]+|Cmd\+[A-Za-z0-9]+|Meta\+[A-Za-z0-9]+|Escape|Enter|Backspace|Tab|Space|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)/g;

export function renderInline(text: string): ReactNode[] {
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
          className="doc-link"
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
        >
          {m[1]}
        </a>
      );
    } else if (m[3] !== undefined) {
      // Code `code`
      out.push(
        <code className="doc-code" key={`c-${key++}`}>
          {m[3]}
        </code>
      );
    } else if (m[4] !== undefined) {
      // **bold**
      out.push(<strong key={`b-${key++}`}>{m[4]}</strong>);
    } else if (m[5] !== undefined) {
      // *italic*
      out.push(<em key={`i-${key++}`}>{m[5]}</em>);
    } else if (m[6] !== undefined) {
      // Keyboard shortcut chip
      out.push(
        <kbd className="doc-kbd" key={`k-${key++}`}>
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

function renderBulletItems(items: BulletItem[]): ReactNode {
  return items.map((it, i) => (
    <li key={i} className="doc-bullet-item">
      <span className="doc-bullet-marker" aria-hidden />
      <div className="doc-bullet-content">
        {renderInline(it.text)}
        {it.children.length > 0 && (
          <ul className="docs-bullets docs-bullets--nested">
            {renderBulletItems(it.children)}
          </ul>
        )}
      </div>
    </li>
  ));
}

/** Render a docs body string into structured block components. */
export function DocBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let rootItems: BulletItem[] = [];
  let stack: { level: number; items: BulletItem[] }[] = [
    { level: -1, items: rootItems },
  ];

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p className="docs-paragraph" key={`p-${blocks.length}`}>
          {renderInline(para.join(" "))}
        </p>
      );
      para = [];
    }
  };

  const flushQuote = () => {
    if (quote.length) {
      blocks.push(
        <div className="docs-callout" key={`q-${blocks.length}`}>
          <span className="docs-callout__icon" aria-hidden>
            <Lightbulb />
          </span>
          <p className="docs-callout__text">{renderInline(quote.join(" "))}</p>
        </div>
      );
      quote = [];
    }
  };

  const flushList = () => {
    if (rootItems.length) {
      blocks.push(
        <ul className="docs-bullets" key={`ul-${blocks.length}`}>
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
      flushQuote();
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushPara();
      flushList();
      flushQuote();
      blocks.push(
        <h3 className="docs-subhead" key={`h-${blocks.length}`}>
          {renderInline(trimmed.slice(3))}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushPara();
      flushList();
      quote.push(trimmed.slice(2));
      continue;
    }

    const bm = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bm) {
      flushPara();
      flushQuote();
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
  flushQuote();

  return <>{blocks}</>;
}
