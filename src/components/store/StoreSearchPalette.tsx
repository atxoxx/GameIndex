import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useSearchSuggestions } from "../../hooks/useSearchSuggestions";
import StoreHighlightText from "./StoreHighlightText";
import { tokenizeSearchQuery } from "./storeSearchQuery";
import { STORE_POPULAR_SEARCHES, type StoreGameSummary } from "../../types/game";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";

interface StoreSearchPaletteProps {
  catalogue: StoreCatalogue;
}

function classifySuggestion(
  g: StoreGameSummary,
  tokens: string[],
  qLower: string
): "title" | "genre" | "platform" {
  const nameLower = (g.name || "").toLowerCase();
  if (qLower && nameLower.includes(qLower)) return "title";
  if (tokens.some((tok) => nameLower.includes(tok))) return "title";
  const genresLower = (g.genres ?? []).map((s) => s.toLowerCase());
  if (tokens.some((tok) => genresLower.some((ge) => ge.includes(tok)))) return "genre";
  const platformsLower = (g.platforms ?? []).map((s) => s.toLowerCase());
  if (tokens.some((tok) => platformsLower.some((pl) => pl.includes(tok)))) return "platform";
  return "title";
}

export default function StoreSearchPalette({ catalogue }: StoreSearchPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  const { suggestions, loading } = useSearchSuggestions(query, open);

  const trimmed = query.trim();
  const qLower = trimmed.toLowerCase();
  const tokens = useMemo(() => tokenizeSearchQuery(trimmed), [trimmed]);

  const groups = useMemo(() => {
    if (suggestions.length === 0 || trimmed.length < 2) return [];
    const map: Record<string, StoreGameSummary[]> = { title: [], genre: [], platform: [] };
    for (const g of suggestions) {
      const grp = classifySuggestion(g, tokens, qLower);
      map[grp].push(g);
    }
    const def: { key: string; label: string; items: StoreGameSummary[] }[] = [
      { key: "title", label: "Title matches", items: map.title },
      { key: "genre", label: "Genre", items: map.genre },
      { key: "platform", label: "Platform", items: map.platform },
    ];
    return def.filter((g) => g.items.length > 0);
  }, [suggestions, trimmed, tokens, qLower]);

  const flatGrouped = useMemo(() => {
    if (groups.length === 0) return suggestions;
    return groups.flatMap((g) => g.items);
  }, [groups, suggestions]);

  const showEmptyState = trimmed.length < 2;
  const showSuggestions = trimmed.length >= 2 && flatGrouped.length > 0;

  // Global hotkey Ctrl+K / Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => {
          const next = !prev;
          if (next) {
            setQuery(catalogue.searchQuery);
            setSelectedIndex(-1);
          }
          return next;
        });
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, catalogue.searchQuery]);

  // Focus input when opened + lock scroll + focus trap origin
  useEffect(() => {
    if (open) {
      // sync query from catalogue on open
      setQuery(catalogue.searchQuery);
      setSelectedIndex(-1);
      // delay focus to allow modal mount
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        clearTimeout(t);
        document.body.style.overflow = prevOverflow;
      };
    } else {
      document.body.style.overflow = "";
    }
  }, [open, catalogue.searchQuery]);

  // Close on outside mousedown/touchstart on scrim (handled via scrim onClick)
  // Also handle focus trap: keep focus inside modal
  const handleModalKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const len = flatGrouped.length;
          if (len === 0) return -1;
          return prev < len - 1 ? prev + 1 : 0;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const len = flatGrouped.length;
          if (len === 0) return -1;
          return prev > 0 ? prev - 1 : len - 1;
        });
      } else if (e.key === "Enter") {
        if (selectedIndex >= 0 && selectedIndex < flatGrouped.length) {
          e.preventDefault();
          const picked = flatGrouped[selectedIndex];
          setOpen(false);
          if (catalogue.onCardClick) catalogue.onCardClick(picked);
        } else if (trimmed.length >= 1) {
          e.preventDefault();
          // Apply query via immediate flush path
          if (catalogue.applyExternalQuery) catalogue.applyExternalQuery(trimmed);
          else if (catalogue.setSearchQueryImmediate) catalogue.setSearchQueryImmediate(trimmed);
          else catalogue.setSearchQuery(trimmed);
          setOpen(false);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [flatGrouped, selectedIndex, trimmed, catalogue]
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(-1);
  }, [query]);

  if (!open) return null;

  return createPortal(
    <div
      className="store-search-palette-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Search command palette"
      onClick={() => setOpen(false)}
    >
      <div
        className="store-search-palette"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleModalKeyDown}
      >
        <div className="store-search-palette-header">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="store-search-palette-input"
            placeholder={t("store.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("store.searchPlaceholder")}
            role="combobox"
            aria-expanded={showSuggestions || showEmptyState}
            aria-controls="store-palette-listbox"
            aria-activedescendant={
              selectedIndex >= 0 && flatGrouped[selectedIndex]
                ? `store-palette-option-${flatGrouped[selectedIndex].id}`
                : undefined
            }
            aria-autocomplete="list"
          />
          <kbd className="store-search-palette-kbd">ESC</kbd>
        </div>

        <div className="store-search-palette-body" id="store-palette-listbox" role="listbox" aria-label={t("store.search.suggestions")}>
          {loading && trimmed.length >= 2 && flatGrouped.length === 0 ? (
            <div className="store-search-dropdown-loading" style={{ padding: "16px" }}>
              <span className="store-search-spinner" aria-hidden="true" />
              <span>{t("store.searching")}</span>
            </div>
          ) : showSuggestions ? (
            groups.length > 0 ? (
              groups.map((group) => (
                <div key={group.key} className="store-search-group">
                  <div className="store-search-group-header">{group.label}</div>
                  {group.items.map((g) => {
                    const flatIdx = flatGrouped.indexOf(g);
                    const isActive = flatIdx === selectedIndex;
                    return (
                      <button
                        key={g.id}
                        id={`store-palette-option-${g.id}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={`store-search-suggestion${isActive ? " selected" : ""}`}
                        onClick={() => {
                          setOpen(false);
                          if (catalogue.onCardClick) catalogue.onCardClick(g);
                        }}
                        onMouseEnter={() => setSelectedIndex(flatIdx)}
                      >
                        {g.coverUrl ? (
                          <img src={g.coverUrl} alt="" className="store-search-suggestion-thumb" loading="lazy" />
                        ) : (
                          <span className="store-search-suggestion-thumb placeholder" />
                        )}
                        <div className="store-search-suggestion-info">
                          <span className="store-search-suggestion-name">
                            <StoreHighlightText text={g.name} query={trimmed} />
                          </span>
                          <div className="store-search-suggestion-meta">
                            {g.firstReleaseDate && (
                              <span className="store-search-suggestion-year">
                                {new Date(g.firstReleaseDate).getFullYear()}
                              </span>
                            )}
                            {g.genres && g.genres.length > 0 && (
                              <span className="store-search-suggestion-genre">{g.genres[0]}</span>
                            )}
                          </div>
                        </div>
                        {g.rating != null && (
                          <span className="store-search-suggestion-score">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden="true">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                            {Math.round(g.rating)}%
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            ) : (
              flatGrouped.map((g) => {
                const flatIdx = flatGrouped.indexOf(g);
                const isActive = flatIdx === selectedIndex;
                return (
                  <button
                    key={g.id}
                    id={`store-palette-option-${g.id}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`store-search-suggestion${isActive ? " selected" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      if (catalogue.onCardClick) catalogue.onCardClick(g);
                    }}
                    onMouseEnter={() => setSelectedIndex(flatIdx)}
                  >
                    {g.coverUrl ? (
                      <img src={g.coverUrl} alt="" className="store-search-suggestion-thumb" loading="lazy" />
                    ) : (
                      <span className="store-search-suggestion-thumb placeholder" />
                    )}
                    <div className="store-search-suggestion-info">
                      <span className="store-search-suggestion-name">
                        <StoreHighlightText text={g.name} query={trimmed} />
                      </span>
                      <div className="store-search-suggestion-meta">
                        {g.firstReleaseDate && (
                          <span className="store-search-suggestion-year">
                            {new Date(g.firstReleaseDate).getFullYear()}
                          </span>
                        )}
                        {g.genres && g.genres.length > 0 && <span className="store-search-suggestion-genre">{g.genres[0]}</span>}
                      </div>
                    </div>
                    {g.rating != null && (
                      <span className="store-search-suggestion-score">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden="true">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        {Math.round(g.rating)}%
                      </span>
                    )}
                  </button>
                );
              })
            )
          ) : showEmptyState ? (
            <div style={{ padding: "8px 0" }}>
              {catalogue.recentSearches.length > 0 && (
                <div className="store-search-section">
                  <div className="store-search-section-title store-search-section-title-row">
                    <span>{t("store.search.recentSearches")}</span>
                    {catalogue.clearRecentSearches && (
                      <button type="button" className="store-search-clear-all" onClick={catalogue.clearRecentSearches}>
                        {t("store.search.clearRecent")}
                      </button>
                    )}
                  </div>
                  {catalogue.recentSearches.map((q) => (
                    <div key={q} className="store-search-recent-row">
                      <button
                        type="button"
                        className="store-search-recent"
                        onClick={() => {
                          setQuery(q);
                          // apply immediately and close
                          if (catalogue.applyExternalQuery) catalogue.applyExternalQuery(q);
                          else if (catalogue.setSearchQueryImmediate) catalogue.setSearchQueryImmediate(q);
                          else catalogue.setSearchQuery(q);
                          setOpen(false);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <polyline points="12 7 12 12 15 14" />
                        </svg>
                        <span>{q}</span>
                      </button>
                      {catalogue.removeRecentSearch && (
                        <button
                          type="button"
                          className="store-search-recent-remove"
                          onClick={() => catalogue.removeRecentSearch(q)}
                          aria-label={t("store.search.removeRecentAria", { query: q })}
                          title={t("common.remove")}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="store-search-section">
                <div className="store-search-section-title">{t("store.popularSearches")}</div>
                <div className="store-search-popular-chips">
                  {STORE_POPULAR_SEARCHES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="store-search-popular-chip"
                      onClick={() => {
                        setQuery(q);
                        if (catalogue.applyExternalQuery) catalogue.applyExternalQuery(q);
                        else if (catalogue.setSearchQueryImmediate) catalogue.setSearchQueryImmediate(q);
                        else catalogue.setSearchQuery(q);
                        setOpen(false);
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="store-search-dropdown-empty" style={{ padding: "16px" }}>
              <span>{t("store.search.noSuggestions")}</span>
            </div>
          )}
        </div>

        <div className="store-search-palette-footer">
          <span>
            <kbd>↵</kbd> {t("store.search.clearSearch") || "to select"}
          </span>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>ESC</kbd> close
          </span>
          <span style={{ marginLeft: "auto", opacity: 0.7 }}>Ctrl+K</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
