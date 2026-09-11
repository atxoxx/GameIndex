import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, BookOpen, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import {
  DOC_GROUPS,
  DOC_SECTIONS,
  DocBody,
  docReadMinutes,
  docWordCount,
  type DocGroupId,
} from "../components/docs/docsContent";
import "../styles/page-docs.css";

function getScrollContainer(node: HTMLElement | null): HTMLElement {
  let parent = node?.parentElement;
  while (parent && parent !== document.body) {
    const { overflowY } = window.getComputedStyle(parent);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return (
    (document.querySelector(".app-main") as HTMLElement) ||
    (document.querySelector(".main-content") as HTMLElement) ||
    (document.documentElement as HTMLElement)
  );
}

export default function DocsPage() {
  const { t } = useLanguage();
  const [active, setActive] = useState(DOC_SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState(0);
  const [showTop, setShowTop] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isScrollingToRef = useRef<boolean>(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  const normalizedQuery = query.trim().toLowerCase();

  // Section text/title/read-time for the active language.
  const localized = useMemo(
    () =>
      DOC_SECTIONS.map((def) => {
        const title = t(`docs.${def.id}.title`);
        const body = t(`docs.${def.id}.body`);
        return {
          ...def,
          title,
          body,
          minutes: docReadMinutes(body),
          words: docWordCount(body),
          haystack: `${title} ${body}`.toLowerCase(),
        };
      }),
    [t]
  );

  const filtered = useMemo(
    () => (normalizedQuery ? localized.filter((s) => s.haystack.includes(normalizedQuery)) : localized),
    [localized, normalizedQuery]
  );

  const totalMinutes = useMemo(
    () => localized.reduce((sum, s) => sum + s.minutes, 0),
    [localized]
  );

  // Keep the active section valid while searching.
  useEffect(() => {
    if (!filtered.length) return;
    if (!filtered.some((s) => s.id === active)) {
      setActive(filtered[0].id);
    }
  }, [filtered, active]);

  // Scroll-spy: highlight the TOC entry for the section in view.
  useEffect(() => {
    const container = getScrollContainer(pageRef.current);

    const sections = filtered
      .map((s) => document.getElementById(`doc-${s.id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (!sections.length) return;

    const isViewport = container === document.documentElement || container === document.body;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingToRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActive(visible[0].target.id.replace("doc-", ""));
        }
      },
      {
        root: isViewport ? null : container,
        rootMargin: "-12% 0px -62% 0px",
        threshold: 0,
      }
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [filtered]);

  // Reading progress + back-to-top visibility.
  useEffect(() => {
    const container = getScrollContainer(pageRef.current);
    const isViewport = container === document.documentElement || container === document.body;
    const targetEl = isViewport ? window : container;
    let frame = 0;

    const update = () => {
      frame = 0;
      const top = isViewport ? window.scrollY : container.scrollTop;
      const max = isViewport
        ? document.documentElement.scrollHeight - window.innerHeight
        : container.scrollHeight - container.clientHeight;
      setProgress(max > 0 ? Math.min(100, Math.max(0, (top / max) * 100)) : 0);
      setShowTop(top > 700);
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    targetEl.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      targetEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Keep the active TOC item in view without scrolling the page.
  useEffect(() => {
    const toc = tocRef.current;
    const btn = activeBtnRef.current;
    if (!toc || !btn) return;
    const tocRect = toc.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    if (btnRect.top < tocRect.top || btnRect.bottom > tocRect.bottom) {
      toc.scrollTop += btnRect.top - tocRect.top - (tocRect.height / 2 - btnRect.height / 2);
    }
  }, [active]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(`doc-${id}`);
    if (!el) return;

    // Suppress scroll-spy updates during the programmatic scroll animation.
    isScrollingToRef.current = true;
    if (scrollTimeoutRef.current) window.clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = window.setTimeout(() => {
      isScrollingToRef.current = false;
    }, 750);

    setActive(id);

    const container = getScrollContainer(pageRef.current);
    const isViewport = container === document.documentElement || container === document.body;

    if (!isViewport && container) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetScroll = container.scrollTop + (elRect.top - containerRect.top) - 24;
      container.scrollTo({ top: targetScroll, behavior: "smooth" });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const scrollToTop = useCallback(() => {
    const container = getScrollContainer(pageRef.current);
    const isViewport = container === document.documentElement || container === document.body;
    if (isViewport) window.scrollTo({ top: 0, behavior: "smooth" });
    else container.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // "/" focuses search, Escape clears it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape") {
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeIndex = filtered.findIndex((s) => s.id === active);
  const prevSection = activeIndex > 0 ? filtered[activeIndex - 1] : null;
  const nextSection =
    activeIndex >= 0 && activeIndex < filtered.length - 1 ? filtered[activeIndex + 1] : null;

  const firstSectionOfGroup = (group: DocGroupId) => DOC_SECTIONS.find((s) => s.group === group);

  const highlightGroup = (group: DocGroupId): ReactNode => t(`docs.group.${group}`);

  return (
    <div className="docs-page" ref={pageRef}>
      <header className="docs-hero">
        <div className="docs-hero__glow" aria-hidden />
        <div className="docs-hero__grid" aria-hidden />
        <div className="docs-hero__main">
          <div className="docs-hero__icon">
            <BookOpen />
          </div>
          <div className="docs-hero__text">
            <span className="brand-eyebrow">{t("nav.docs")}</span>
            <h1 className="docs-hero__title">{t("docs.title")}</h1>
            <p className="docs-hero__subtitle">{t("docs.subtitle")}</p>
            <div className="docs-hero__stats">
              <span className="docs-stat">
                {t("docs.statSections", { count: DOC_SECTIONS.length })}
              </span>
              <span className="docs-stat">{t("docs.statRead", { min: totalMinutes })}</span>
            </div>
          </div>
        </div>

        <div className="docs-hero__search">
          <Search className="docs-search__icon" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className="docs-search__input"
            placeholder={t("docs.searchPlaceholder")}
            aria-label={t("docs.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="docs-search__clear"
              onClick={() => setQuery("")}
              aria-label={t("docs.searchClear")}
            >
              <X aria-hidden />
            </button>
          )}
          <kbd className="docs-search__hint" aria-hidden>
            /
          </kbd>
        </div>

        <div className="docs-hero__groups">
          {DOC_GROUPS.map((group) => {
            const first = firstSectionOfGroup(group);
            if (!first) return null;
            return (
              <button
                key={group}
                type="button"
                className="docs-group-chip"
                onClick={() => scrollTo(first.id)}
              >
                {highlightGroup(group)}
              </button>
            );
          })}
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label={t("docs.toc")} ref={tocRef}>
          <div className="docs-toc__progress" aria-hidden>
            <span className="docs-toc__progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="docs-toc__heading">{t("docs.toc")}</span>

          {filtered.length === 0 ? (
            <p className="docs-toc__empty">{t("docs.noResults", { query })}</p>
          ) : (
            DOC_GROUPS.map((group) => {
              const items = filtered.filter((s) => s.group === group);
              if (!items.length) return null;
              return (
                <div className="docs-toc__group" key={group}>
                  <span className="docs-toc__group-label">{highlightGroup(group)}</span>
                  <ul>
                    {items.map((section) => {
                      const Icon = section.icon;
                      const number = DOC_SECTIONS.findIndex((s) => s.id === section.id) + 1;
                      return (
                        <li key={section.id}>
                          <button
                            type="button"
                            className={`docs-toc__link${
                              active === section.id ? " docs-toc__link--active" : ""
                            }`}
                            onClick={() => scrollTo(section.id)}
                            aria-current={active === section.id ? "true" : undefined}
                            ref={active === section.id ? activeBtnRef : undefined}
                          >
                            <span className="docs-toc__icon" aria-hidden>
                              <Icon />
                            </span>
                            <span className="docs-toc__label">{section.title}</span>
                            <span className="docs-toc__num" aria-hidden>
                              {number}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </aside>

        <div className="docs-content">
          {normalizedQuery && (
            <div className="docs-results" role="status">
              <Search aria-hidden />
              <span>
                {t("docs.results", { shown: filtered.length, total: DOC_SECTIONS.length })}
              </span>
              <button type="button" className="docs-results__clear" onClick={() => setQuery("")}>
                {t("docs.searchClear")}
              </button>
            </div>
          )}

          {filtered.length === 0 && (
            <div className="docs-empty">
              <Search aria-hidden />
              <h2>{t("docs.noResults", { query })}</h2>
              <p>{t("docs.noResultsHint")}</p>
            </div>
          )}

          {filtered.map((section, i) => {
            const Icon = section.icon;
            const number = DOC_SECTIONS.findIndex((s) => s.id === section.id) + 1;
            const isActive = active === section.id && !normalizedQuery;
            return (
              <section
                key={section.id}
                id={`doc-${section.id}`}
                className={`docs-section${isActive ? " docs-section--active" : ""}`}
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <header className="docs-section__head">
                  <span className="docs-section__icon" aria-hidden>
                    <Icon />
                  </span>
                  <h2 className="docs-section__title">
                    <span className="docs-section__index">{number}</span>
                    {section.title}
                  </h2>
                  <span className="docs-section__meta">
                    {t("docs.readTime", { min: section.minutes })}
                  </span>
                </header>

                <DocBody text={section.body} />

                {!normalizedQuery && (prevSection || nextSection) && (
                  <nav className="docs-section__nav" aria-label={t("docs.toc")}>
                    {prevSection ? (
                      <button
                        type="button"
                        className="docs-navbtn docs-navbtn--prev"
                        onClick={() => scrollTo(prevSection.id)}
                      >
                        <ChevronLeft aria-hidden />
                        <span>
                          <em>{t("docs.prev")}</em>
                          <strong>{prevSection.title}</strong>
                        </span>
                      </button>
                    ) : (
                      <span className="docs-navbtn docs-navbtn--ghost" aria-hidden />
                    )}
                    {nextSection && (
                      <button
                        type="button"
                        className="docs-navbtn docs-navbtn--next"
                        onClick={() => scrollTo(nextSection.id)}
                      >
                        <span>
                          <em>{t("docs.next")}</em>
                          <strong>{nextSection.title}</strong>
                        </span>
                        <ChevronRight aria-hidden />
                      </button>
                    )}
                  </nav>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {showTop && (
        <button
          type="button"
          className="docs-top"
          onClick={scrollToTop}
          aria-label={t("docs.backToTop")}
          title={t("docs.backToTop")}
        >
          <ArrowUp aria-hidden />
        </button>
      )}
    </div>
  );
}
