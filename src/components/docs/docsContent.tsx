import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  Lightbulb,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ALL_SUBCATEGORIES } from "./docsData";

export * from "./docsData";

/** Backward-compatible group identifier type */
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

const CATEGORY_TO_GROUP: Record<string, DocGroupId> = {
  "getting-started": "start",
  "integrations": "start",
  "library": "use",
  "game-details": "use",
  "discovery": "discover",
  "tracking": "manage",
  "achievements": "manage",
  "downloads-storage": "manage",
  "emulators-mods": "manage",
  "linux-deck": "linux",
  "customization": "master",
  "reference": "master",
};

/**
 * Backward-compatible list of sections used by BigScreenDocsPage
 * and existing unit tests.
 */
export const DOC_SECTIONS: readonly DocSectionDef[] = ALL_SUBCATEGORIES.map((s) => ({
  id: s.id,
  group: CATEGORY_TO_GROUP[s.categoryId] || "use",
  icon: s.icon,
}));

export const DOC_SECTION_IDS: readonly string[] = DOC_SECTIONS.map((s) => s.id);

/** Human-readable reading time for an article body. */
export function docReadMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 180));
}

/** Approximate word count used for search and reading stats. */
export function docWordCount(body: string): number {
  return body.trim().split(/\s+/).length;
}

export interface InPageHeading {
  id: string;
  title: string;
  level: number;
}

export function slugifyHeading(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Extract all h2 and h3 headings from markdown text for in-page TOC */
export function extractHeadings(markdown: string): InPageHeading[] {
  const lines = markdown.split("\n");
  const headings: InPageHeading[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      const title = trimmed.slice(3).replace(/\*\*/g, "").trim();
      headings.push({ id: slugifyHeading(title), title, level: 2 });
    } else if (trimmed.startsWith("### ")) {
      const title = trimmed.slice(4).replace(/\*\*/g, "").trim();
      headings.push({ id: slugifyHeading(title), title, level: 3 });
    }
  }
  return headings;
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

function CodeSnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="doc-code-block">
      <button
        type="button"
        className="doc-code-copy"
        onClick={handleCopy}
        aria-label="Copy code"
        title="Copy code"
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Render a docs body string into structured block components. */
export function DocBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
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
      const fullText = quote.join(" ");
      let type: "note" | "tip" | "warning" | "pro" = "tip";
      let Icon = Lightbulb;
      let cleanText = fullText;

      if (fullText.startsWith("[!NOTE]") || fullText.startsWith("**Note:**")) {
        type = "note";
        Icon = Info;
        cleanText = fullText.replace(/^(\[!NOTE\]|\*\*Note:\*\*)\s*/, "");
      } else if (fullText.startsWith("[!TIP]") || fullText.startsWith("**Tip:**")) {
        type = "tip";
        Icon = Lightbulb;
        cleanText = fullText.replace(/^(\[!TIP\]|\*\*Tip:\*\*)\s*/, "");
      } else if (
        fullText.startsWith("[!WARNING]") ||
        fullText.startsWith("[!IMPORTANT]") ||
        fullText.startsWith("**Warning:**") ||
        fullText.startsWith("**Important:**")
      ) {
        type = "warning";
        Icon = AlertTriangle;
        cleanText = fullText.replace(
          /^(\[!WARNING\]|\[!IMPORTANT\]|\*\*Warning:\*\*|\*\*Important:\*\*)\s*/,
          ""
        );
      } else if (fullText.startsWith("[!PRO TIP]") || fullText.startsWith("**Pro Tip:**")) {
        type = "pro";
        Icon = Zap;
        cleanText = fullText.replace(/^(\[!PRO TIP\]|\*\*Pro Tip:\*\*)\s*/, "");
      }

      blocks.push(
        <div className={`docs-callout docs-callout--${type}`} key={`q-${blocks.length}`}>
          <span className="docs-callout__icon" aria-hidden>
            <Icon />
          </span>
          <div className="docs-callout__text">{renderInline(cleanText)}</div>
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

  const flushTable = () => {
    if (tableRows.length > 0) {
      const [headerRow, ...bodyRows] = tableRows.filter(
        (row) => !row.every((cell) => /^:?-+:?$/.test(cell.trim()))
      );

      blocks.push(
        <div className="doc-table-wrapper" key={`tbl-${blocks.length}`}>
          <table className="doc-table">
            {headerRow && (
              <thead>
                <tr>
                  {headerRow.map((cell, ci) => (
                    <th key={ci}>{renderInline(cell.trim())}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{renderInline(cell.trim())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Code block fences
    if (trimmed.startsWith("```")) {
      if (inCode) {
        blocks.push(
          <CodeSnippet code={codeLines.join("\n")} key={`code-${blocks.length}`} />
        );
        codeLines = [];
        inCode = false;
      } else {
        flushPara();
        flushList();
        flushQuote();
        flushTable();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(raw);
      continue;
    }

    // Markdown tables (| col 1 | col 2 |)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushPara();
      flushList();
      flushQuote();
      inTable = true;
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (trimmed === "") {
      flushPara();
      flushList();
      flushQuote();
      continue;
    }

    // ## Heading 2
    if (trimmed.startsWith("## ")) {
      flushPara();
      flushList();
      flushQuote();
      const title = trimmed.slice(3);
      const id = slugifyHeading(title);
      blocks.push(
        <h2 className="docs-subhead docs-subhead--h2" id={id} key={`h2-${blocks.length}`}>
          {renderInline(title)}
        </h2>
      );
      continue;
    }

    // ### Heading 3 or Step
    if (trimmed.startsWith("### ")) {
      flushPara();
      flushList();
      flushQuote();
      const content = trimmed.slice(4);
      const stepMatch = /^Step\s+(\d+)[:\s]+(.*)$/i.exec(content);

      if (stepMatch) {
        blocks.push(
          <div className="docs-step-header" key={`step-${blocks.length}`}>
            <span className="docs-step-badge">Step {stepMatch[1]}</span>
            <h3 className="docs-step-title">{renderInline(stepMatch[2])}</h3>
          </div>
        );
      } else {
        const id = slugifyHeading(content);
        blocks.push(
          <h3 className="docs-subhead docs-subhead--h3" id={id} key={`h3-${blocks.length}`}>
            {renderInline(content)}
          </h3>
        );
      }
      continue;
    }

    // Blockquotes & Callouts
    if (trimmed.startsWith("> ")) {
      flushPara();
      flushList();
      quote.push(trimmed.slice(2));
      continue;
    }

    // Bullet items (- or *)
    const bm = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bm) {
      flushPara();
      flushQuote();
      const indent = raw.length - raw.replace(/^\s+/, "").length;
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
  flushTable();

  return <>{blocks}</>;
}
