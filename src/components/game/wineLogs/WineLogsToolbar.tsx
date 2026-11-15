import type { KeyboardEvent, RefObject } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  WrapText,
  X,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { formatCount } from "./logAnalysis";

interface WineLogsToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  matchCount: number;
  /** 1-based position of the focused match; 0 when there is none. */
  activeMatch: number;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  /** True when the current view contains at least one error line. */
  hasError: boolean;
  onJumpToError: () => void;
  wrap: boolean;
  onToggleWrap: () => void;
  onRefresh: () => void;
  loading: boolean;
  visibleCount: number;
  totalCount: number;
}

export function WineLogsToolbar({
  query,
  onQueryChange,
  searchRef,
  onSearchKeyDown,
  matchCount,
  activeMatch,
  onPreviousMatch,
  onNextMatch,
  hasError,
  onJumpToError,
  wrap,
  onToggleWrap,
  onRefresh,
  loading,
  visibleCount,
  totalCount,
}: WineLogsToolbarProps) {
  const { t } = useLanguage();
  const hasQuery = query.trim().length > 0;

  return (
    <div className="wine-logs-toolbar">
      <div className="wine-logs-search">
        <Search size={13} className="wine-logs-search-icon" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          className="wine-logs-search-input"
          placeholder={t("wineLogs.searchPlaceholder")}
          aria-label={t("wineLogs.searchPlaceholder")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
          spellCheck={false}
        />
        {hasQuery ? (
          <span className="wine-logs-search-count" aria-live="polite">
            {matchCount === 0 ? 0 : activeMatch > 0 ? activeMatch : 1} / {formatCount(matchCount)}
          </span>
        ) : null}
        {hasQuery ? (
          <>
            <button
              type="button"
              className="wine-logs-search-btn"
              onClick={onPreviousMatch}
              disabled={matchCount === 0}
              title={t("wineLogs.previousMatch")}
              aria-label={t("wineLogs.previousMatch")}
            >
              <ChevronUp size={13} />
            </button>
            <button
              type="button"
              className="wine-logs-search-btn"
              onClick={onNextMatch}
              disabled={matchCount === 0}
              title={t("wineLogs.nextMatch")}
              aria-label={t("wineLogs.nextMatch")}
            >
              <ChevronDown size={13} />
            </button>
            <button
              type="button"
              className="wine-logs-search-btn"
              onClick={() => onQueryChange("")}
              title={t("wineLogs.clearSearch")}
              aria-label={t("wineLogs.clearSearch")}
            >
              <X size={13} />
            </button>
          </>
        ) : null}
      </div>

      <span className="wine-logs-toolbar-divider" aria-hidden />

      <div className="wine-logs-toolbar-actions">
        <button
          type="button"
          className="wine-logs-icon-btn"
          onClick={onJumpToError}
          disabled={!hasError}
          title={t("wineLogs.jumpToError")}
          aria-label={t("wineLogs.jumpToError")}
        >
          <AlertTriangle size={14} />
        </button>
        <button
          type="button"
          className={`wine-logs-icon-btn${wrap ? " is-active" : ""}`}
          onClick={onToggleWrap}
          aria-pressed={wrap}
          title={t("wineLogs.wrap")}
          aria-label={t("wineLogs.wrap")}
        >
          <WrapText size={14} />
        </button>
        <button
          type="button"
          className="wine-logs-icon-btn"
          onClick={onRefresh}
          disabled={loading}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <span className="wine-logs-count">
        {visibleCount === totalCount
          ? formatCount(totalCount)
          : `${formatCount(visibleCount)} / ${formatCount(totalCount)}`}{" "}
        {t("wineLogs.lines")}
      </span>
    </div>
  );
}
