import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Search,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import {
  ALL_SUBCATEGORIES,
  DOC_CATEGORIES,
  DocBody,
  docReadMinutes,
  extractHeadings,
  findCategoryBySubId,
  findSubcategoryById,
  QUICK_START_CARDS,
  type DocBadgeType,
  type DocCategory,
  type DocSubcategory,
  type InPageHeading,
  type QuickStartCard,
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
  const [searchParams, setSearchParams] = useSearchParams();

  // URL state synchronization
  const articleParam = searchParams.get("article");
  const initialSubId =
    articleParam && findSubcategoryById(articleParam)
      ? articleParam
      : "welcome";

  const [activeSubId, setActiveSubId] = useState<string>(initialSubId);
  const [query, setQuery] = useState<string>("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [showTop, setShowTop] = useState<boolean>(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string>("");

  // Categories accordion state: all expanded by default
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(DOC_CATEGORIES.map((c) => c.id))
  );

  const pageRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeSidebarItemRef = useRef<HTMLButtonElement>(null);
  const isScrollingRef = useRef<boolean>(false);

  // Sync state if URL query param changes externally
  useEffect(() => {
    if (articleParam && findSubcategoryById(articleParam) && articleParam !== activeSubId) {
      setActiveSubId(articleParam);
    }
  }, [articleParam, activeSubId]);

  // Click-outside and Escape listener for category dropdown
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDropdownOpen]);

  // ── Translation Helpers ──────────────────────────────────────────────────

  const getSubTitle = useCallback(
    (sub: DocSubcategory): string => {
      const key = `docs.${sub.id}.title`;
      const val = t(key);
      return val && val !== key ? val : sub.title;
    },
    [t]
  );

  const getSubBody = useCallback(
    (sub: DocSubcategory): string => {
      const key = `docs.${sub.id}.body`;
      const val = t(key);
      return val && val !== key ? val : sub.body;
    },
    [t]
  );

  const getCatTitle = useCallback(
    (cat: DocCategory): string => {
      const key = `docs.cat.${cat.id}`;
      const val = t(key);
      return val && val !== key ? val : cat.title;
    },
    [t]
  );

  const getCardTitle = useCallback(
    (card: QuickStartCard): string => {
      const val = t(card.titleKey);
      return val && val !== card.titleKey ? val : card.defaultTitle;
    },
    [t]
  );

  const getCardDesc = useCallback(
    (card: QuickStartCard): string => {
      const val = t(card.descKey);
      return val && val !== card.descKey ? val : card.defaultDesc;
    },
    [t]
  );

  const getCardBadge = useCallback(
    (card: QuickStartCard): string => {
      switch (card.badge.toLowerCase()) {
        case "core":
          return t("docs.badge.core");
        case "setup":
          return t("docs.badge.setup");
        case "stores":
          return t("docs.cat.integrations");
        case "reference":
          return t("docs.badge.reference");
        case "help":
          return t("docs.cat.reference");
        default:
          return card.badge;
      }
    },
    [t]
  );

  const getSubSummary = useCallback(
    (sub: DocSubcategory): string => {
      const body = getSubBody(sub);
      if (body) {
        const firstPara = body
          .split("\n\n")
          .map((s) => s.trim())
          .find((p) => p && !p.startsWith("#"));
        if (firstPara) {
          const cleaned = firstPara.replace(/[*_#`[\]()!>]/g, "").trim();
          if (cleaned) {
            return cleaned.length > 150 ? `${cleaned.slice(0, 150)}…` : cleaned;
          }
        }
      }
      return sub.summary;
    },
    [getSubBody]
  );

  const getBadgeLabel = useCallback(
    (badge: DocBadgeType): string => {
      switch (badge) {
        case "core":
          return t("docs.badge.core");
        case "setup":
          return t("docs.badge.setup");
        case "guide":
          return t("docs.badge.guide");
        case "proTip":
          return t("docs.badge.proTip");
        case "linux":
          return t("docs.badge.linux");
        case "reference":
          return t("docs.badge.reference");
      }
    },
    [t]
  );

  // Active subcategory & parent category
  const activeSub = useMemo<DocSubcategory>(() => {
    return findSubcategoryById(activeSubId) || ALL_SUBCATEGORIES[0];
  }, [activeSubId]);

  const activeCategory = useMemo<DocCategory>(() => {
    return findCategoryBySubId(activeSub.id) || DOC_CATEGORIES[0];
  }, [activeSub]);

  // Selected filter category object (if any)
  const selectedCategory = useMemo<DocCategory | null>(() => {
    return selectedCategoryFilter
      ? DOC_CATEGORIES.find((c) => c.id === selectedCategoryFilter) || null
      : null;
  }, [selectedCategoryFilter]);

  // Ensure active category is expanded in accordion
  useEffect(() => {
    if (activeCategory) {
      setExpandedCategories((prev) => {
        if (!prev.has(activeCategory.id)) {
          const next = new Set(prev);
          next.add(activeCategory.id);
          return next;
        }
        return prev;
      });
    }
  }, [activeCategory]);

  // Active body text in the current language
  const activeBody = useMemo(() => getSubBody(activeSub), [activeSub, getSubBody]);

  // Headings for in-page TOC (extracted from translated body)
  const inPageHeadings = useMemo<InPageHeading[]>(() => {
    return extractHeadings(activeBody);
  }, [activeBody]);

  // Total reading time in minutes
  const totalReadMinutes = useMemo(() => {
    return ALL_SUBCATEGORIES.reduce((acc, sub) => acc + docReadMinutes(getSubBody(sub)), 0);
  }, [getSubBody]);

  // Filtered search results across categories, subcategories, keywords, and body text
  const normalizedQuery = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return ALL_SUBCATEGORIES.filter((sub) => {
      const cat = findCategoryBySubId(sub.id);
      if (selectedCategoryFilter && sub.categoryId !== selectedCategoryFilter) {
        return false;
      }
      const subTitle = getSubTitle(sub).toLowerCase();
      const subSummary = getSubSummary(sub).toLowerCase();
      const subBody = getSubBody(sub).toLowerCase();
      const catTitle = cat ? getCatTitle(cat).toLowerCase() : "";

      const matchDefaultTitle = sub.title.toLowerCase().includes(normalizedQuery);
      const matchTranslatedTitle = subTitle.includes(normalizedQuery);
      const matchSummary = subSummary.includes(normalizedQuery);
      const matchKeywords = sub.keywords.some((k) => k.toLowerCase().includes(normalizedQuery));
      const matchCategory =
        catTitle.includes(normalizedQuery) || (cat ? cat.title.toLowerCase().includes(normalizedQuery) : false);
      const matchBody =
        subBody.includes(normalizedQuery) || sub.body.toLowerCase().includes(normalizedQuery);

      return (
        matchDefaultTitle ||
        matchTranslatedTitle ||
        matchSummary ||
        matchKeywords ||
        matchCategory ||
        matchBody
      );
    });
  }, [normalizedQuery, selectedCategoryFilter, getSubTitle, getSubSummary, getSubBody, getCatTitle]);

  // Sequential previous and next subcategories
  const currentIndex = ALL_SUBCATEGORIES.findIndex((s) => s.id === activeSub.id);
  const prevSub = currentIndex > 0 ? ALL_SUBCATEGORIES[currentIndex - 1] : null;
  const nextSub =
    currentIndex >= 0 && currentIndex < ALL_SUBCATEGORIES.length - 1
      ? ALL_SUBCATEGORIES[currentIndex + 1]
      : null;

  // Related subcategories
  const relatedSubs = useMemo(() => {
    if (!activeSub.relatedIds?.length) return [];
    return activeSub.relatedIds
      .map(findSubcategoryById)
      .filter((s): s is DocSubcategory => s !== undefined);
  }, [activeSub]);

  // Navigate to a specific subcategory
  const selectSubcategory = useCallback(
    (subId: string) => {
      setActiveSubId(subId);
      setSearchParams({ article: subId }, { replace: true });
      setQuery("");
      setActiveHeadingId("");

      const container = getScrollContainer(pageRef.current);
      const isViewport = container === document.documentElement || container === document.body;
      if (isViewport) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        container.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setSearchParams]
  );

  // Jump to in-page heading
  const scrollToHeading = useCallback((headingId: string) => {
    const target = document.getElementById(headingId);
    if (!target) return;

    isScrollingRef.current = true;
    setActiveHeadingId(headingId);

    const container = getScrollContainer(pageRef.current);
    const isViewport = container === document.documentElement || container === document.body;

    if (!isViewport && container) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetScroll = container.scrollTop + (targetRect.top - containerRect.top) - 24;
      container.scrollTo({ top: targetScroll, behavior: "smooth" });
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    setTimeout(() => {
      isScrollingRef.current = false;
    }, 700);
  }, []);

  // Scroll-spy for in-page TOC
  useEffect(() => {
    if (!inPageHeadings.length) return;
    const container = getScrollContainer(pageRef.current);
    const isViewport = container === document.documentElement || container === document.body;

    const headingEls = inPageHeadings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);

    if (!headingEls.length || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveHeadingId(visible[0].target.id);
        }
      },
      {
        root: isViewport ? null : container,
        rootMargin: "-10% 0px -70% 0px",
        threshold: 0,
      }
    );

    headingEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [inPageHeadings, activeSubId]);

  // Back to top listener
  useEffect(() => {
    const container = getScrollContainer(pageRef.current);
    const isViewport = container === document.documentElement || container === document.body;
    const targetEl = isViewport ? window : container;

    const onScroll = () => {
      const top = isViewport ? window.scrollY : container.scrollTop;
      setShowTop(top > 600);
    };

    targetEl.addEventListener("scroll", onScroll, { passive: true });
    return () => targetEl.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    const container = getScrollContainer(pageRef.current);
    const isViewport = container === document.documentElement || container === document.body;
    if (isViewport) window.scrollTo({ top: 0, behavior: "smooth" });
    else container.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Global hotkeys: "/" focuses search, "Escape" clears it
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']") ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape") {
        setQuery("");
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Copy direct article anchor link
  const handleCopyLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("article", activeSub.id);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url.toString());
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  }, [activeSub.id]);

  // Toggle category expansion in sidebar
  const toggleCategory = useCallback((catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

  // Expand / collapse all categories
  const toggleAllCategories = useCallback(() => {
    if (expandedCategories.size === DOC_CATEGORIES.length) {
      setExpandedCategories(new Set());
    } else {
      setExpandedCategories(new Set(DOC_CATEGORIES.map((c) => c.id)));
    }
  }, [expandedCategories.size]);

  // Handle category selection from dropdown
  const handleSelectCategory = useCallback(
    (catId: string | null) => {
      setSelectedCategoryFilter(catId);
      setIsDropdownOpen(false);
      if (catId) {
        const cat = DOC_CATEGORIES.find((c) => c.id === catId);
        if (cat) {
          if (!normalizedQuery && cat.subcategories[0]) {
            selectSubcategory(cat.subcategories[0].id);
          }
          setExpandedCategories((prev) => {
            const next = new Set(prev);
            next.add(catId);
            return next;
          });
        }
      }
    },
    [normalizedQuery, selectSubcategory]
  );

  const ActiveIcon = activeSub.icon;
  const TriggerIcon = selectedCategory ? selectedCategory.icon : Layers;

  return (
    <div className="docs-page" ref={pageRef}>
      {/* ── Hero Section ─────────────────────────────────────────────────── */}
      <header className="docs-hero">
        <div className="docs-hero__backdrop" aria-hidden>
          <div className="docs-hero__glow" />
          <div className="docs-hero__grid" />
        </div>

        <div className="docs-hero__main">
          <div className="docs-hero__icon">
            <BookOpen aria-hidden />
          </div>
          <div className="docs-hero__text">
            <span className="brand-eyebrow">{t("nav.docs")}</span>
            <h1 className="docs-hero__title">{t("docs.title")}</h1>
            <p className="docs-hero__subtitle">{t("docs.subtitle")}</p>
            <div className="docs-hero__stats">
              <span className="docs-stat-pill">
                <Layers aria-hidden />
                {t("docs.statCategories", { count: DOC_CATEGORIES.length })}
              </span>
              <span className="docs-stat-pill">
                <Sparkles aria-hidden />
                {t("docs.statSections", { count: ALL_SUBCATEGORIES.length })}
              </span>
              <span className="docs-stat-pill">
                <Clock aria-hidden />
                {t("docs.statRead", { min: totalReadMinutes })}
              </span>
            </div>
          </div>
        </div>

        {/* Search Input & Category Dropdown */}
        <div className="docs-hero__search-wrap">
          <div className="docs-hero__search-row">
            <div className="docs-hero__search">
              <Search className="docs-search__icon" aria-hidden />
              <input
                ref={searchInputRef}
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

            {/* Categories Dropdown */}
            <div className="docs-category-dropdown" ref={dropdownRef}>
              <button
                type="button"
                className={`docs-category-dropdown__trigger${
                  isDropdownOpen ? " docs-category-dropdown__trigger--open" : ""
                }${selectedCategory ? " docs-category-dropdown__trigger--selected" : ""}`}
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                aria-expanded={isDropdownOpen}
                aria-haspopup="listbox"
                aria-label={t("docs.categoryDropdownLabel")}
              >
                <span className="docs-category-dropdown__trigger-left">
                  <TriggerIcon className="docs-category-dropdown__trigger-icon" aria-hidden />
                  <span className="docs-category-dropdown__trigger-label">
                    {selectedCategory ? getCatTitle(selectedCategory) : t("docs.allCategories")}
                  </span>
                </span>
                <span className="docs-category-dropdown__trigger-right">
                  <span className="docs-category-dropdown__count">
                    {selectedCategory
                      ? selectedCategory.subcategories.length
                      : ALL_SUBCATEGORIES.length}
                  </span>
                  {selectedCategory && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="docs-category-dropdown__clear"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectCategory(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          handleSelectCategory(null);
                        }
                      }}
                      aria-label={t("docs.searchClear")}
                      title={t("docs.allCategories")}
                    >
                      <X aria-hidden />
                    </span>
                  )}
                  <ChevronDown
                    className={`docs-category-dropdown__chevron${
                      isDropdownOpen ? " docs-category-dropdown__chevron--rotated" : ""
                    }`}
                    aria-hidden
                  />
                </span>
              </button>

              {isDropdownOpen && (
                <div className="docs-category-dropdown__menu" role="listbox">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedCategoryFilter === null}
                    className={`docs-category-dropdown__item${
                      selectedCategoryFilter === null
                        ? " docs-category-dropdown__item--active"
                        : ""
                    }`}
                    onClick={() => handleSelectCategory(null)}
                  >
                    <span className="docs-category-dropdown__item-left">
                      <Layers className="docs-category-dropdown__item-icon" aria-hidden />
                      <span className="docs-category-dropdown__item-title">
                        {t("docs.allCategories")}
                      </span>
                    </span>
                    <span className="docs-category-dropdown__item-right">
                      <span className="docs-category-dropdown__item-count">
                        {ALL_SUBCATEGORIES.length}
                      </span>
                      {selectedCategoryFilter === null && (
                        <Check
                          className="docs-category-dropdown__item-check"
                          aria-hidden
                        />
                      )}
                    </span>
                  </button>

                  <div className="docs-category-dropdown__divider" />

                  {DOC_CATEGORIES.map((cat) => {
                    const ItemIcon = cat.icon;
                    const isSelected = selectedCategoryFilter === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`docs-category-dropdown__item${
                          isSelected ? " docs-category-dropdown__item--active" : ""
                        }`}
                        onClick={() => handleSelectCategory(cat.id)}
                      >
                        <span className="docs-category-dropdown__item-left">
                          <ItemIcon
                            className="docs-category-dropdown__item-icon"
                            aria-hidden
                          />
                          <span className="docs-category-dropdown__item-title">
                            {getCatTitle(cat)}
                          </span>
                        </span>
                        <span className="docs-category-dropdown__item-right">
                          <span className="docs-category-dropdown__item-count">
                            {cat.subcategories.length}
                          </span>
                          {isSelected && (
                            <Check
                              className="docs-category-dropdown__item-check"
                              aria-hidden
                            />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick-Start Cards Row (hidden while actively searching) */}
        {!normalizedQuery && (
          <div className="docs-quickstart">
            <div className="docs-quickstart__header">
              <span className="docs-quickstart__title">
                <Sparkles aria-hidden />
                {t("docs.quickStart")}
              </span>
            </div>
            <div className="docs-quickstart__grid">
              {QUICK_START_CARDS.map((card) => {
                const CardIcon = card.icon;
                return (
                  <button
                    key={card.id}
                    type="button"
                    className="docs-quickcard"
                    onClick={() => selectSubcategory(card.subcategoryId)}
                  >
                    <div className="docs-quickcard__top">
                      <span className="docs-quickcard__icon" aria-hidden>
                        <CardIcon />
                      </span>
                      <span className="docs-quickcard__badge">{getCardBadge(card)}</span>
                    </div>
                    <h3 className="docs-quickcard__title">{getCardTitle(card)}</h3>
                    <p className="docs-quickcard__desc">{getCardDesc(card)}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* ── Main Multi-Column Layout ───────────────────────────────────────── */}
      <div className="docs-layout">
        {/* Left Sidebar: Categories & Subcategories Tree */}
        <aside className="docs-sidebar" aria-label={t("docs.toc")}>
          <div className="docs-sidebar__header">
            <span className="docs-sidebar__title">{t("docs.toc")}</span>
            <button
              type="button"
              className="docs-sidebar__toggle-all"
              onClick={toggleAllCategories}
            >
              {expandedCategories.size === DOC_CATEGORIES.length
                ? t("docs.collapseAll")
                : t("docs.expandAll")}
            </button>
          </div>

          {DOC_CATEGORIES.map((cat) => {
            const CatIcon = cat.icon;
            const isExpanded = expandedCategories.has(cat.id);
            const containsActive = cat.subcategories.some((s) => s.id === activeSub.id);

            return (
              <div className="docs-category-group" key={cat.id}>
                <button
                  type="button"
                  className={`docs-category-head${
                    isExpanded ? " docs-category-head--expanded" : ""
                  }${containsActive ? " docs-category-head--has-active" : ""}`}
                  onClick={() => toggleCategory(cat.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="docs-category-head__icon" aria-hidden>
                    <CatIcon />
                  </span>
                  <span className="docs-category-head__title">{getCatTitle(cat)}</span>
                  <span className="docs-category-head__count">
                    {cat.subcategories.length}
                  </span>
                  <span className="docs-category-head__chevron" aria-hidden>
                    <ChevronRight />
                  </span>
                </button>

                {isExpanded && (
                  <ul className="docs-category-items">
                    {cat.subcategories.map((sub) => {
                      const isItemActive = activeSub.id === sub.id && !normalizedQuery;
                      return (
                        <li key={sub.id}>
                          <button
                            type="button"
                            className={`docs-subitem-link${
                              isItemActive ? " docs-subitem-link--active" : ""
                            }`}
                            onClick={() => selectSubcategory(sub.id)}
                            aria-current={isItemActive ? "true" : undefined}
                            ref={isItemActive ? activeSidebarItemRef : undefined}
                          >
                            <span className="docs-subitem-link__label">
                              {getSubTitle(sub)}
                            </span>
                            <span
                              className={`docs-subitem-badge docs-subitem-badge--${sub.badge}`}
                            >
                              {getBadgeLabel(sub.badge)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </aside>

        {/* Center: Main Content Canvas (Article or Search Mode) */}
        <main className="docs-content">
          {normalizedQuery ? (
            /* Search Results Mode */
            <div className="docs-search-mode">
              <div className="docs-search-mode__summary" role="status">
                <span>
                  {t("docs.results", {
                    shown: searchResults.length,
                    total: ALL_SUBCATEGORIES.length,
                  })}
                </span>
                <button
                  type="button"
                  className="docs-action-btn"
                  onClick={() => setQuery("")}
                >
                  {t("docs.searchClear")}
                </button>
              </div>

              {searchResults.length === 0 ? (
                <div className="docs-empty">
                  <Search aria-hidden />
                  <h2>{t("docs.noResults", { query })}</h2>
                  <p>{t("docs.noResultsHint")}</p>
                </div>
              ) : (
                <div className="docs-search-mode__grid">
                  {searchResults.map((sub) => {
                    const cat = findCategoryBySubId(sub.id);
                    return (
                      <article
                        key={sub.id}
                        className="docs-search-card"
                        onClick={() => selectSubcategory(sub.id)}
                      >
                        <div className="docs-search-card__top">
                          <span className="docs-search-card__cat">
                            {cat ? getCatTitle(cat) : ""}
                          </span>
                          <span
                            className={`docs-subitem-badge docs-subitem-badge--${sub.badge}`}
                          >
                            {getBadgeLabel(sub.badge)}
                          </span>
                        </div>
                        <h2 className="docs-search-card__title">{getSubTitle(sub)}</h2>
                        <p className="docs-search-card__summary">{getSubSummary(sub)}</p>
                        <div className="docs-search-card__tags">
                          {sub.keywords.slice(0, 5).map((kw) => (
                            <span key={kw} className="docs-search-tag">
                              #{kw}
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Focused Article Mode */
            <article className="docs-article" id={`article-${activeSub.id}`}>
              {/* Breadcrumb Trail */}
              <nav className="docs-breadcrumbs" aria-label="Breadcrumb">
                <button
                  type="button"
                  className="docs-breadcrumb-btn"
                  onClick={() => selectSubcategory("welcome")}
                >
                  {t("docs.title")}
                </button>
                <span className="docs-breadcrumbs__sep">/</span>
                <span>{getCatTitle(activeCategory)}</span>
                <span className="docs-breadcrumbs__sep">/</span>
                <span className="docs-breadcrumbs__current">{getSubTitle(activeSub)}</span>
              </nav>

              {/* Article Header */}
              <header className="docs-article__head">
                <div className="docs-article__title-row">
                  <div className="docs-article__title-wrap">
                    <div className="docs-article__icon" aria-hidden>
                      <ActiveIcon />
                    </div>
                    <div>
                      <h1 className="docs-article__title">{getSubTitle(activeSub)}</h1>
                    </div>
                  </div>

                  <div className="docs-article__actions">
                    <button
                      type="button"
                      className={`docs-action-btn${
                        copiedLink ? " docs-action-btn--copied" : ""
                      }`}
                      onClick={handleCopyLink}
                      title={t("docs.copyLink")}
                    >
                      {copiedLink ? (
                        <>
                          <Check aria-hidden />
                          <span>{t("docs.linkCopied")}</span>
                        </>
                      ) : (
                        <>
                          <Share2 aria-hidden />
                          <span>{t("docs.copyLink")}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="docs-article__meta-row">
                  <span
                    className={`docs-subitem-badge docs-subitem-badge--${activeSub.badge}`}
                  >
                    {getBadgeLabel(activeSub.badge)}
                  </span>
                  <span className="docs-meta-badge">
                    <Clock aria-hidden />
                    {t("docs.readTime", { min: docReadMinutes(activeBody) })}
                  </span>
                  <span className="docs-meta-badge">
                    <Layers aria-hidden />
                    {getCatTitle(activeCategory)}
                  </span>
                </div>
              </header>

              {/* Rich Markdown Prose (100% translated through activeBody) */}
              <div className="docs-article__prose">
                <DocBody text={activeBody} />
              </div>

              {/* Related Topics Shelf */}
              {relatedSubs.length > 0 && (
                <div className="docs-related">
                  <h3 className="docs-related__title">{t("docs.relatedTopics")}</h3>
                  <div className="docs-related__grid">
                    {relatedSubs.map((rel) => {
                      const RelIcon = rel.icon;
                      const relCat = findCategoryBySubId(rel.id);
                      return (
                        <button
                          key={rel.id}
                          type="button"
                          className="docs-related-card"
                          onClick={() => selectSubcategory(rel.id)}
                        >
                          <span className="docs-related-card__icon" aria-hidden>
                            <RelIcon />
                          </span>
                          <div className="docs-related-card__text">
                            <p className="docs-related-card__name">{getSubTitle(rel)}</p>
                            <span className="docs-related-card__cat">
                              {relCat ? getCatTitle(relCat) : ""}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Previous / Next Article Navigation */}
              <nav className="docs-article__nav" aria-label="Article navigation">
                {prevSub ? (
                  <button
                    type="button"
                    className="docs-navbtn docs-navbtn--prev"
                    onClick={() => selectSubcategory(prevSub.id)}
                  >
                    <ChevronLeft aria-hidden />
                    <span>
                      <em>{t("docs.prev")}</em>
                      <strong>{getSubTitle(prevSub)}</strong>
                    </span>
                  </button>
                ) : (
                  <span className="docs-navbtn docs-navbtn--ghost" aria-hidden />
                )}

                {nextSub && (
                  <button
                    type="button"
                    className="docs-navbtn docs-navbtn--next"
                    onClick={() => selectSubcategory(nextSub.id)}
                  >
                    <span>
                      <em>{t("docs.next")}</em>
                      <strong>{getSubTitle(nextSub)}</strong>
                    </span>
                    <ChevronRight aria-hidden />
                  </button>
                )}
              </nav>
            </article>
          )}
        </main>

        {/* Right Rail: Floating In-Page "On this page" Table of Contents */}
        {!normalizedQuery && inPageHeadings.length > 0 && (
          <aside className="docs-toc-inpage" aria-label={t("docs.onThisPage")}>
            <span className="docs-toc-inpage__title">{t("docs.onThisPage")}</span>
            <ul className="docs-toc-inpage__list">
              {inPageHeadings.map((h) => {
                const isActive = activeHeadingId === h.id;
                return (
                  <li
                    key={h.id}
                    className={`docs-toc-inpage__item docs-toc-inpage__item--level${h.level}`}
                  >
                    <button
                      type="button"
                      className={`docs-toc-inpage__link${
                        isActive ? " docs-toc-inpage__link--active" : ""
                      }`}
                      onClick={() => scrollToHeading(h.id)}
                    >
                      {h.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>

      {/* Floating Back to Top Button */}
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
