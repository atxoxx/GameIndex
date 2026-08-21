import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { buildStoreSearchUrl } from "../store/storeSearchQuery";

interface BigScreenSearchOverlayProps {
  open: boolean;
  onClose: () => void;
}

const SearchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const CloseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/**
 * BigScreenSearchOverlay: full-screen "press to search" modal for Big
 * Screen Mode. Launched from the header search button (or the `/` key).
 *
 * Gamepad model:
 *  - The text input is wrapped in `useFocusable` so D-pad / left-stick
 *    navigation and the A button still work; the X button (Escape) and
 *    the header's close affordance both close it.
 *  - Typing is done with the on-screen virtual cursor (right stick) or
 *    a physical keyboard when one is attached to the TV box.
 *  - Submitting (Enter or the View button) navigates to the Store with
 *    the query pre-filled via the `?q=` URL param (StorePage reads it via
 *    useSearchParams + applyExternalQuery). Lane A's searchMemoryCache /
 *    dedupedSearchFetch ensures that if the same query was fetched recently
 *    (e.g., via StoreSearchBar suggestions within the 10-min TTL) no second
 *    IGDB call is issued — the cached 20-result payload is reused instantly.
 */
export default function BigScreenSearchOverlay({
  open,
  onClose,
}: BigScreenSearchOverlayProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const submitSearch = useCallback(() => {
    const q = query.trim();
    if (!q) {
      onClose();
      return;
    }
    // Build shareable Store URL with ?q= — StorePage consumes it on mount
    // via applyExternalQuery(q) and syncs catalogue.searchQuery -> URL so
    // back/forward and shared links work. Using the Lane A helper keeps
    // encoding and param-key canonical (STORE_SEARCH_QUERY_PARAM = "q").
    const target = buildStoreSearchUrl("/store", q);
    navigate(target);
    // Overlay closes immediately; focus is restored by the open->false effect below.
    // Because Lane A's searchMemoryCache is module-singleton, the StorePage's
    // subsequent applyExternalQuery(targetQ) will hit the cache and skip the
    // network when the query is still fresh (no duplicate fetch).
    onClose();
  }, [query, navigate, onClose]);

  const inputFocusable = useFocusable(() => inputRef.current?.focus());
  const clearFocusable = useFocusable(() => {
    setQuery("");
    inputRef.current?.focus();
  });
  const submitFocusable = useFocusable(submitSearch);
  const cancelFocusable = useFocusable(onClose);

  // Merge the focusable's callback ref (registers with the Big Screen
  // nav registry) with a local ref so we can still imperatively focus.
  const setInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      (inputFocusable.ref as (node: HTMLElement | null) => void)(el);
    },
    [inputFocusable],
  );

  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      // Defer focus so the entrance animation has painted and the
      // gamepad registry has the input registered.
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    } else {
      // Focus return on close: restore to the element that opened the overlay
      // (header search button or main content) so controller navigation stays
      // coherent and keyboard users don't lose their place.
      const prev = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (prev && document.contains(prev) && typeof prev.focus === "function") {
        // Defer to next frame so the overlay has unmounted and focus isn't
        // immediately trapped by the closing animation.
        const raf = window.requestAnimationFrame(() => {
          try {
            prev.focus({ preventScroll: true } as FocusOptions);
          } catch {
            prev.focus();
          }
        });
        return () => window.cancelAnimationFrame(raf);
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        submitSearch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitSearch]);

  if (!open) return null;

  return (
    <div className="bigscreen-search-overlay" role="dialog" aria-modal="true" aria-label={t("bigscreen.search.searchStore")}>
      <div className="bigscreen-search-scrim" onClick={onClose} />
      <div className="bigscreen-search-panel">
        <div className="bigscreen-search-field">
          <span className="bigscreen-search-field-icon" aria-hidden="true">
            {SearchIcon}
          </span>
          <input
            ref={setInputRef}
            className="bigscreen-search-input"
            type="text"
            placeholder={t("bigscreen.search.placeholder")}
            value={query}
            tabIndex={inputFocusable.tabIndex}
            role={inputFocusable.role}
            onClick={inputFocusable.onClick}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("bigscreen.search.searchStore")}
          />
          {query && (
            <button
              type="button"
              className="bigscreen-search-clear"
              aria-label={t("bigscreen.search.clearSearch")}
              {...clearFocusable}
            >
              {CloseIcon}
            </button>
          )}
        </div>

        <div className="bigscreen-search-actions">
          <button
            type="button"
            className="bigscreen-search-btn bigscreen-search-btn--primary"
            {...submitFocusable}
          >
            {t("common.search")}
          </button>
          <button
            type="button"
            className="bigscreen-search-btn"
            {...cancelFocusable}
          >
            {t("common.cancel")}
          </button>
        </div>

        <p className="bigscreen-search-hint">
          {t("bigscreen.search.pressEnter")}
        </p>
      </div>
    </div>
  );
}
