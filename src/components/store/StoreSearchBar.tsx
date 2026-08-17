import { useRef, useEffect, useState, useCallback } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useSearchSuggestions } from "../../hooks/useSearchSuggestions";
import StoreHighlightText from "./StoreHighlightText";
import { publishSearchQuery } from "./storeSearchQuery";
import { STORE_POPULAR_SEARCHES, type StoreGameSummary } from "../../types/game";

interface StoreSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  /** Recent queries (most-recent first) for the empty-state suggestions. */
  recentSearches?: string[];
  /** Remove a single recent search entry. */
  onRemoveRecent?: (query: string) => void;
  /** Clear the whole recent-searches list at once. */
  onClearRecentSearches?: () => void;
  /** Navigate directly to a suggested game (bypasses full search). */
  onPickSuggestion?: (game: StoreGameSummary) => void;
}

export default function StoreSearchBar({
  value,
  onChange,
  visible,
  recentSearches = [],
  onRemoveRecent,
  onClearRecentSearches,
  onPickSuggestion,
}: StoreSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const { t } = useLanguage();

  const { suggestions, loading } = useSearchSuggestions(value);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!focused) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [focused]);

  // Mirror query to global highlight publisher
  useEffect(() => {
    publishSearchQuery(value);
  }, [value]);

  useEffect(() => {
    return () => publishSearchQuery("");
  }, []);

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(-1);
  }, [value]);

  const trimmed = value.trim();
  const showSuggestions = focused && trimmed.length >= 2;
  const showEmptyState =
    focused && trimmed.length < 2 && (recentSearches.length > 0 || STORE_POPULAR_SEARCHES.length > 0);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions || suggestions.length === 0) {
        if (e.key === "Escape") {
          setFocused(false);
          inputRef.current?.blur();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
      } else if (e.key === "Enter") {
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          e.preventDefault();
          const picked = suggestions[selectedIndex];
          if (onPickSuggestion) onPickSuggestion(picked);
          setFocused(false);
          inputRef.current?.blur();
        }
      } else if (e.key === "Escape") {
        setFocused(false);
        inputRef.current?.blur();
      }
    },
    [showSuggestions, suggestions, selectedIndex, onPickSuggestion]
  );

  if (!visible) return null;

  return (
    <div className="store-search-bar-wrap" ref={rootRef}>
      <div className={`store-search-bar${focused ? " is-focused" : ""}`}>
        <svg
          className="store-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="store-search-input"
          placeholder={t("store.searchPlaceholder")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={showSuggestions || showEmptyState}
          aria-autocomplete="list"
        />
        {value && (
          <button
            type="button"
            className="store-search-clear"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label={t("bigscreen.search.clearSearch")}
            title={t("bigscreen.search.clearSearch")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {showSuggestions && (
        <div className="store-search-dropdown" role="listbox">
          <div className="store-search-dropdown-header">
            <span>{t("store.search.suggestions")}</span>
          </div>

          {loading && suggestions.length === 0 ? (
            <div className="store-search-dropdown-loading">
              <span className="store-search-spinner" aria-hidden="true" />
              <span>{t("store.searching")}</span>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="store-search-dropdown-empty">
              <span>{t("store.search.noSuggestions")}</span>
            </div>
          ) : (
            suggestions.map((g, idx) => (
              <button
                key={g.id}
                type="button"
                role="option"
                aria-selected={idx === selectedIndex}
                className={`store-search-suggestion${idx === selectedIndex ? " selected" : ""}`}
                onClick={() => {
                  if (onPickSuggestion) onPickSuggestion(g);
                  setFocused(false);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
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
                      <span className="store-search-suggestion-genre">
                        {g.genres[0]}
                      </span>
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
            ))
          )}
        </div>
      )}

      {showEmptyState && (
        <div className="store-search-dropdown">
          {recentSearches.length > 0 && (
            <div className="store-search-section">
              <div className="store-search-section-title store-search-section-title-row">
                <span>{t("store.search.recentSearches")}</span>
                {onClearRecentSearches && (
                  <button
                    type="button"
                    className="store-search-clear-all"
                    onClick={onClearRecentSearches}
                  >
                    {t("store.search.clearRecent")}
                  </button>
                )}
              </div>
              {recentSearches.map((q) => (
                <div key={q} className="store-search-recent-row">
                  <button
                    type="button"
                    className="store-search-recent"
                    onClick={() => {
                      onChange(q);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <polyline points="12 7 12 12 15 14" />
                    </svg>
                    <span>{q}</span>
                  </button>
                  {onRemoveRecent && (
                    <button
                      type="button"
                      className="store-search-recent-remove"
                      onClick={() => onRemoveRecent(q)}
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
                  onClick={() => onChange(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
