import React, { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { ChevronDownIcon, CustomLinkIcon } from "./WebLinksIcons";
import { MY_LINKS_KEY, SOURCE_CATEGORIES } from "./sources";
import type { SourceCategoryKey, SourceDef } from "./types";

interface WebLinksSourceStripProps {
  sources: SourceDef[];
  activeSourceKey: string;
  onSelectSource: (key: string) => void;
  customLinksCount: number;
  showMyLinksTab?: boolean;
  activeCategory: SourceCategoryKey;
  onSelectCategory: (category: SourceCategoryKey) => void;
  counts: Record<SourceCategoryKey, number>;
  onMenuOpenChange?: (open: boolean) => void;
}

export default function WebLinksSourceStrip({
  sources,
  activeSourceKey,
  onSelectSource,
  customLinksCount,
  showMyLinksTab = true,
  activeCategory,
  onSelectCategory,
  counts,
  onMenuOpenChange,
}: WebLinksSourceStripProps) {
  const { t } = useLanguage();
  const stripRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const activeCategoryDef =
    SOURCE_CATEGORIES.find((cat) => cat.key === activeCategory) ??
    SOURCE_CATEGORIES[0];

  const setOpen = (open: boolean) => {
    setMenuOpen(open);
    onMenuOpenChange?.(open);
  };

  // Close the category menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      setMenuOpen(false);
      onMenuOpenChange?.(false);
    };
    const onDocMouseDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [menuOpen, onMenuOpenChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    );
    if (tabs.length === 0) return;
    const current = tabs.findIndex((tab) => tab.tabIndex === 0);
    let next = current;

    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;

    e.preventDefault();
    tabs[next]?.click();
    tabs[next]?.focus();
  };

  const isMyLinksActive = activeSourceKey === MY_LINKS_KEY;

  return (
    <div ref={stripRef} className="wl-source-tabs" onKeyDown={handleKeyDown}>
      {/* Category filter dropdown */}
      <div ref={filterRef} className="wl-category-filter">
        <button
          type="button"
          className="wl-category-filter-btn"
          onClick={() => setOpen(!menuOpen)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={t("weblinks.filterByCategory")}
        >
          <span className="wl-category-filter-label">
            {t(activeCategoryDef.i18nKey)}
          </span>
          <span className={`wl-category-filter-chevron${menuOpen ? " open" : ""}`}>
            <ChevronDownIcon />
          </span>
        </button>

        {menuOpen && (
          <div className="wl-category-menu" role="menu">
            {SOURCE_CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.key;
              const count = counts[cat.key] ?? 0;
              return (
                <button
                  key={cat.key}
                  type="button"
                  role="menuitem"
                  className={`wl-category-menu-item${isActive ? " active" : ""}`}
                  onClick={() => {
                    onSelectCategory(cat.key);
                    setOpen(false);
                  }}
                >
                  <span>{t(cat.i18nKey)}</span>
                  {count > 0 && (
                    <span className="wl-category-menu-count">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <span className="wl-source-tabs-divider" aria-hidden="true" />

      {/* Scrollable source tabs */}
      <div
        className="wl-source-tabs-scroll"
        role="tablist"
        aria-label="Web sources"
      >
        {sources.map((src) => {
          const isActive = activeSourceKey === src.key;
          return (
            <button
              key={src.key}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              className={`wl-source-tab${isActive ? " active" : ""}`}
              onClick={() => onSelectSource(src.key)}
              style={
                isActive
                  ? {
                      color: src.accent,
                      borderBottomColor: src.accent,
                      background: `linear-gradient(180deg, ${src.iconBg}44, transparent)`,
                    }
                  : undefined
              }
            >
              <span
                className="wl-source-tab-icon"
                style={{
                  background: isActive ? src.iconBg : "var(--color-bg-tertiary)",
                  color: isActive ? src.accent : "inherit",
                }}
              >
                {src.icon}
              </span>
              <span className="wl-source-tab-label">{src.label}</span>
            </button>
          );
        })}

        {showMyLinksTab && (
          <button
            key={MY_LINKS_KEY}
            role="tab"
            tabIndex={isMyLinksActive ? 0 : -1}
            aria-selected={isMyLinksActive}
            className={`wl-source-tab mylinks${isMyLinksActive ? " active" : ""}`}
            onClick={() => onSelectSource(MY_LINKS_KEY)}
            style={
              isMyLinksActive
                ? {
                    color: "var(--color-accent)",
                    borderBottomColor: "var(--color-accent)",
                    background:
                      "linear-gradient(180deg, var(--color-accent-soft), transparent)",
                  }
                : undefined
            }
          >
            <span className="wl-source-tab-icon">
              <CustomLinkIcon />
            </span>
            <span className="wl-source-tab-label">{t("weblinks.myLinks")}</span>
            {customLinksCount > 0 && (
              <span className="wl-source-tab-count">{customLinksCount}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
