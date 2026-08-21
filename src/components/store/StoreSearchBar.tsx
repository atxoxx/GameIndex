import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useSearchSuggestions } from "../../hooks/useSearchSuggestions";
import StoreHighlightText from "./StoreHighlightText";
import { publishSearchQuery, tokenizeSearchQuery } from "./storeSearchQuery";
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
  /** Active filter chips to render inline inside the bar (optional, backward-compatible). */
  activeFilters?: {
    genres: string[];
    platforms: string[];
    yearMin: number | null;
    yearMax: number | null;
    ratingMin: number | null;
  };
  /** Remove an active filter — called when a chip's X is clicked. */
  onRemoveFilter?: (type: "genre" | "platform" | "year" | "rating" | "all", value?: string) => void;
  /** Immediate flush (Enter bypass) — cancels debounce and fetches now. */
  flushSearch?: () => void;
  /** Alias for flushSearch with explicit query (setSearchQueryImmediate). */
  setSearchQueryImmediate?: (query: string) => void;
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

export default function StoreSearchBar({
  value,
  onChange,
  visible,
  recentSearches = [],
  onRemoveRecent,
  onClearRecentSearches,
  onPickSuggestion,
  activeFilters,
  onRemoveFilter,
  flushSearch,
  setSearchQueryImmediate,
}: StoreSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const { t } = useLanguage();

  const { suggestions, loading } = useSearchSuggestions(value);

  // Close the dropdown on outside click + touchstart.
  useEffect(() => {
    if (!focused) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true } as AddEventListenerOptions);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [focused]);

  // Global hotkeys: Ctrl+K/Cmd+K focuses bar, Escape closes.
  useEffect(() => {
    const onGlobal = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        // Don't hijack when palette is open? palette handles its own toggle.
        // If bar is visible, focus it.
        if (!visible) return;
        // Avoid double-handling when typing inside palette/input — still focus bar if not already focused
        const active = document.activeElement as HTMLElement | null;
        const isPaletteInput = active?.classList.contains("store-search-palette-input");
        if (isPaletteInput) return;
        e.preventDefault();
        inputRef.current?.focus();
        setFocused(true);
      }
      if (e.key === "Escape" && focused) {
        setFocused(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onGlobal);
    return () => window.removeEventListener("keydown", onGlobal);
  }, [focused, visible]);

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

  // Grouped suggestions derived from tokens
  const qLower = trimmed.toLowerCase();
  const tokens = useMemo(() => tokenizeSearchQuery(trimmed), [trimmed]);

  const groups = useMemo(() => {
    if (!showSuggestions || suggestions.length === 0) return [];
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
  }, [showSuggestions, suggestions, tokens, qLower]);

  const flatGrouped = useMemo(() => {
    if (groups.length === 0) return suggestions;
    return groups.flatMap((g) => g.items);
  }, [groups, suggestions]);

  const listboxId = "store-search-listbox";
  const hasActiveFilters =
    !!activeFilters &&
    (activeFilters.genres.length > 0 ||
      activeFilters.platforms.length > 0 ||
      activeFilters.yearMin != null ||
      activeFilters.yearMax != null ||
      activeFilters.ratingMin != null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // When dropdown is closed or empty, still handle Enter/Escape
      if (!showSuggestions || flatGrouped.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          setFocused(false);
          inputRef.current?.blur();
        } else if (e.key === "Enter" && trimmed.length >= 1) {
          // Instant search bypass
          if (flushSearch) {
            e.preventDefault();
            flushSearch();
            setFocused(false);
          } else if (setSearchQueryImmediate) {
            e.preventDefault();
            setSearchQueryImmediate(trimmed);
            setFocused(false);
          }
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < flatGrouped.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flatGrouped.length - 1));
      } else if (e.key === "Enter") {
        if (selectedIndex >= 0 && selectedIndex < flatGrouped.length) {
          e.preventDefault();
          const picked = flatGrouped[selectedIndex];
          if (onPickSuggestion) onPickSuggestion(picked);
          setFocused(false);
          inputRef.current?.blur();
        } else if (trimmed.length >= 1) {
          // No suggestion selected — flush the free-text query immediately
          if (flushSearch) {
            e.preventDefault();
            flushSearch();
            setFocused(false);
          } else if (setSearchQueryImmediate) {
            e.preventDefault();
            setSearchQueryImmediate(trimmed);
            setFocused(false);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setFocused(false);
        inputRef.current?.blur();
      }
    },
    [showSuggestions, flatGrouped, selectedIndex, onPickSuggestion, trimmed, flushSearch, setSearchQueryImmediate]
  );

  if (!visible) return null;

  const activeDescendantId =
    selectedIndex >= 0 && flatGrouped[selectedIndex]
      ? `store-suggestion-${flatGrouped[selectedIndex].id}`
      : undefined;

  return (
    <div className="store-search-bar-wrap" ref={rootRef}>
      <div className={`store-search-bar${focused ? " is-focused" : ""}${hasActiveFilters ? " has-chips" : ""}`}>
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
          aria-controls={showSuggestions || showEmptyState ? listboxId : undefined}
          aria-activedescendant={activeDescendantId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
        />

        {/* Inline filter chips */}
        {hasActiveFilters && activeFilters && (
          <div className="store-search-inline-chips" aria-label="Active filters">
            {activeFilters.genres.map((g) => (
              <span key={`genre-${g}`} className="store-search-filter-chip">
                <span className="store-search-filter-chip-label">{g}</span>
                <button
                  type="button"
                  className="store-search-filter-chip-remove"
                  onClick={() => onRemoveFilter?.("genre", g)}
                  aria-label={`Remove genre filter ${g}`}
                  title={`Remove ${g}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            ))}
            {activeFilters.platforms.map((p) => (
              <span key={`platform-${p}`} className="store-search-filter-chip">
                <span className="store-search-filter-chip-label">{p}</span>
                <button
                  type="button"
                  className="store-search-filter-chip-remove"
                  onClick={() => onRemoveFilter?.("platform", p)}
                  aria-label={`Remove platform filter ${p}`}
                  title={`Remove ${p}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            ))}
            {(activeFilters.yearMin != null || activeFilters.yearMax != null) && (
              <span className="store-search-filter-chip">
                <span className="store-search-filter-chip-label">
                  {activeFilters.yearMin != null && activeFilters.yearMax != null
                    ? `${activeFilters.yearMin}–${activeFilters.yearMax}`
                    : activeFilters.yearMin != null
                    ? `≥${activeFilters.yearMin}`
                    : `≤${activeFilters.yearMax}`}
                </span>
                <button
                  type="button"
                  className="store-search-filter-chip-remove"
                  onClick={() => onRemoveFilter?.("year")}
                  aria-label="Remove year filter"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            )}
            {activeFilters.ratingMin != null && (
              <span className="store-search-filter-chip">
                <span className="store-search-filter-chip-label">≥{activeFilters.ratingMin}%</span>
                <button
                  type="button"
                  className="store-search-filter-chip-remove"
                  onClick={() => onRemoveFilter?.("rating")}
                  aria-label="Remove rating filter"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            )}
            <button
              type="button"
              className="store-search-filter-chip store-search-filter-chip-clear"
              onClick={() => onRemoveFilter?.("all")}
              aria-label="Clear all filters"
            >
              Clear
            </button>
          </div>
        )}

        {value ? (
          <button
            type="button"
            className="store-search-clear"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
              setSelectedIndex(-1);
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
        ) : (
          <span className="store-search-kbd" aria-hidden="true" title="Press Ctrl+K to focus search">
            Ctrl K
          </span>
        )}
      </div>

      {showSuggestions && (
        <div className="store-search-dropdown" id={listboxId} role="listbox" aria-label={t("store.search.suggestions")}>
          {loading && flatGrouped.length === 0 ? (
            <div className="store-search-dropdown-loading">
              <span className="store-search-spinner" aria-hidden="true" />
              <span>{t("store.searching")}</span>
            </div>
          ) : flatGrouped.length === 0 ? (
            <div className="store-search-dropdown-empty">
              <span>{t("store.search.noSuggestions")}</span>
            </div>
          ) : groups.length > 0 ? (
            groups.map((group) => (
              <div key={group.key} className="store-search-group">
                <div className="store-search-group-header">{group.label}</div>
                {group.items.map((g) => {
                  const flatIdx = flatGrouped.indexOf(g);
                  const isActive = flatIdx === selectedIndex;
                  return (
                    <button
                      key={g.id}
                      id={`store-suggestion-${g.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`store-search-suggestion${isActive ? " selected" : ""}`}
                      onClick={() => {
                        if (onPickSuggestion) onPickSuggestion(g);
                        setFocused(false);
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
                  id={`store-suggestion-${g.id}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`store-search-suggestion${isActive ? " selected" : ""}`}
                  onClick={() => {
                    if (onPickSuggestion) onPickSuggestion(g);
                    setFocused(false);
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
                        <span className="store-search-suggestion-year">{new Date(g.firstReleaseDate).getFullYear()}</span>
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
          )}
        </div>
      )}

      {showEmptyState && (
        <div className="store-search-dropdown" id={listboxId} role="listbox" aria-label={t("store.search.suggestions")}>
          {recentSearches.length > 0 && (
            <div className="store-search-section">
              <div className="store-search-section-title store-search-section-title-row">
                <span>{t("store.search.recentSearches")}</span>
                {onClearRecentSearches && (
                  <button type="button" className="store-search-clear-all" onClick={onClearRecentSearches}>
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
                      if (setSearchQueryImmediate) setSearchQueryImmediate(q);
                      else onChange(q);
                      setFocused(false);
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
                  onClick={() => {
                    if (setSearchQueryImmediate) setSearchQueryImmediate(q);
                    else onChange(q);
                    setFocused(false);
                  }}
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
