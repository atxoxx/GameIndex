import { memo, useRef } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { SidebarSearchProps } from "./types";

/**
 * SidebarSearch
 * ─────────────
 * Search input field for filtering the sidebar game list.
 * Features real-time typing, dedicated clear button (×),
 * Escape shortcut to clear & blur, and smooth focus transitions.
 */
function SidebarSearchBase({
  searchQuery,
  onSearchChange,
  onClear,
}: SidebarSearchProps) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onClear();
    inputRef.current?.focus();
  };

  return (
    <div className="sidebar-search">
      <svg
        className="sidebar-search-icon"
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
        placeholder={t("friends.searchGames")}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && searchQuery !== "") {
            e.preventDefault();
            onClear();
            e.currentTarget.blur();
          }
        }}
        aria-label={t("friends.searchGames")}
      />
      {searchQuery.trim() !== "" && (
        <button
          type="button"
          className="sidebar-search-clear"
          onClick={handleClear}
          title={t("sidebar.clearSearch")}
          aria-label={t("sidebar.clearSearch")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
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
  );
}

export const SidebarSearch = memo(SidebarSearchBase);
export default SidebarSearch;
