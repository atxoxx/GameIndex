import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLanguage } from "../context/LanguageContext";
import "../styles/page-docs.css";

/**
 * Documentation page — a non-technical, UI-based user guide.
 *
 * Content lives entirely in i18n (`docs.*` keys) so it translates with
 * the rest of the app. Each section is one `docs.<id>.title` + one
 * `docs.<id>.body` string.
 */

// Order of sections in the guide. The same ids are used as anchor targets
// and as i18n key suffixes, so the TOC and content stay in sync.
const SECTION_IDS = [
  "welcome",
  "firststeps",
  "layout",
  "library",
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
  "tips",
] as const;

type SectionId = (typeof SECTION_IDS)[number];

// Inline formatting inside prose: [label](url), `code`, **bold**, *italic*, and keyboard-key chips.
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

function DocBookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
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
          <ul className="docs-bullets doc-bullets--nested">
            {renderBulletItems(it.children)}
          </ul>
        )}
      </div>
    </li>
  ));
}

/**
 * Render a docs body string into structured block components.
 */
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
        <p className="docs-paragraph" key={`p-${blocks.length}`}>
          {renderInline(para.join(" "))}
        </p>
      );
      para = [];
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
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push(
        <h3 className="docs-subhead" key={`h-${blocks.length}`}>
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

export default function DocsPage() {
  const { t } = useLanguage();
  const [active, setActive] = useState<SectionId>("welcome");
  const tocRef = useRef<HTMLElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement>(null);

  // Scroll-spy: highlight the TOC entry for the section in view.
  useEffect(() => {
    const sections = SECTION_IDS.map((id) => document.getElementById(`doc-${id}`)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (!sections.length) return;

    const handleScroll = () => {
      // Check if user has scrolled all the way to the bottom of the page
      const isAtBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 60;
      if (isAtBottom) {
        setActive(SECTION_IDS[SECTION_IDS.length - 1]);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const isAtBottom =
          window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 60;
        if (isAtBottom) return;

        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActive(visible[0].target.id.replace("doc-", "") as SectionId);
        }
      },
      { rootMargin: "-12% 0px -60% 0px", threshold: 0 }
    );

    sections.forEach((s) => observer.observe(s));
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Keep the active TOC entry smoothly in view inside the TOC panel
  useEffect(() => {
    const btn = activeBtnRef.current;
    if (!btn) return;
    btn.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  const scrollTo = (id: SectionId) => {
    const el = document.getElementById(`doc-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(id);
    }
  };

  const activeIndex = SECTION_IDS.indexOf(active);
  const progress = ((activeIndex + 1) / SECTION_IDS.length) * 100;

  return (
    <div className="docs-page">
      <header className="docs-hero">
        <div className="docs-hero__icon">
          <DocBookIcon />
        </div>
        <div className="docs-hero__text">
          <span className="brand-eyebrow">{t("nav.docs")}</span>
          <h1 className="docs-hero__title">{t("docs.title")}</h1>
          <p className="docs-hero__subtitle">{t("docs.subtitle")}</p>
        </div>
        <div className="docs-hero__pill" aria-hidden>
          <span className="docs-hero__pill-dot" />
          {SECTION_IDS.length}
        </div>
      </header>

      <div className="docs-layout">
        <nav className="docs-toc" aria-label={t("docs.toc")} ref={tocRef}>
          <div className="docs-toc__progress" aria-hidden>
            <span className="docs-toc__progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="docs-toc__heading">{t("docs.toc")}</span>
          <ul>
            {SECTION_IDS.map((id, i) => (
              <li key={id}>
                <button
                  type="button"
                  className={`docs-toc__link${
                    active === id ? " docs-toc__link--active" : ""
                  }`}
                  onClick={() => scrollTo(id)}
                  aria-current={active === id ? "true" : undefined}
                  ref={active === id ? activeBtnRef : undefined}
                >
                  <span className="docs-toc__num">{i + 1}</span>
                  <span className="docs-toc__label">{t(`docs.${id}.title`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="docs-content">
          {SECTION_IDS.map((id, i) => (
            <section
              key={id}
              id={`doc-${id}`}
              className="docs-section"
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
            >
              <header className="docs-section__head">
                <span className="docs-section__index">{i + 1}</span>
                <h2 className="docs-section__title">{t(`docs.${id}.title`)}</h2>
              </header>
              <DocBody text={t(`docs.${id}.body`)} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
