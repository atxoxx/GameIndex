import { KpiTile } from "../ui/KpiTile";
import { useLanguage } from "../../context/LanguageContext";

interface NewsStatsHeaderProps {
  total: number;
  unread: number;
  saved: number;
  feeds: number;
  matchedGamesCount: number;
  loading: boolean;
  onFilterAll?: () => void;
  onToggleUnread?: () => void;
  onFilterYourGames?: () => void;
  onOpenSaved?: () => void;
  onOpenSettings?: () => void;
}

/**
 * NewsStatsHeader — Interactive glass KPI strip above the feed.
 * Clicking a tile directly filters the feed or opens settings.
 */
export default function NewsStatsHeader({
  total,
  unread,
  saved,
  feeds,
  matchedGamesCount,
  loading,
  onFilterAll,
  onToggleUnread,
  onFilterYourGames,
  onOpenSaved,
  onOpenSettings,
}: NewsStatsHeaderProps) {
  const { t } = useLanguage();
  const value = (n: number) => (loading ? "…" : n);

  return (
    <div className="news-stats-header">
      <div
        className="news-kpi-clickable"
        onClick={onFilterAll}
        role="button"
        tabIndex={0}
        aria-label={t("news.statsArticles")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onFilterAll?.();
          }
        }}
      >
        <KpiTile
          size="sm"
          glass
          intent="accent"
          label={t("news.statsArticles")}
          value={value(total)}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
          }
        />
      </div>

      <div
        className="news-kpi-clickable"
        onClick={onToggleUnread}
        role="button"
        tabIndex={0}
        aria-label={t("news.statsUnread")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleUnread?.();
          }
        }}
      >
        <KpiTile
          size="sm"
          glass
          intent={unread > 0 ? "warning" : "default"}
          label={t("news.statsUnread")}
          value={value(unread)}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10" />
              <polyline points="16 2 22 8 16 8" />
              <line x1="22" y1="2" x2="16" y2="8" />
            </svg>
          }
        />
      </div>

      {matchedGamesCount > 0 && (
        <div
          className="news-kpi-clickable"
          onClick={onFilterYourGames}
          role="button"
          tabIndex={0}
          aria-label={t("news.statsYourGames")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onFilterYourGames?.();
            }
          }}
        >
          <KpiTile
            size="sm"
            glass
            intent="accent"
            label={t("news.statsYourGames")}
            value={value(matchedGamesCount)}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <line x1="6" y1="12" x2="10" y2="12" />
                <line x1="8" y1="10" x2="8" y2="14" />
                <line x1="15" y1="11" x2="15.01" y2="11" />
                <line x1="18" y1="13" x2="18.01" y2="13" />
              </svg>
            }
          />
        </div>
      )}

      <div
        className="news-kpi-clickable"
        onClick={onOpenSaved}
        role="button"
        tabIndex={0}
        aria-label={t("news.statsSaved")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenSaved?.();
          }
        }}
      >
        <KpiTile
          size="sm"
          glass
          intent={saved > 0 ? "success" : "default"}
          label={t("news.statsSaved")}
          value={value(saved)}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          }
        />
      </div>

      <div
        className="news-kpi-clickable"
        onClick={onOpenSettings}
        role="button"
        tabIndex={0}
        aria-label={t("news.statsFeeds")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenSettings?.();
          }
        }}
      >
        <KpiTile
          size="sm"
          glass
          intent="accent"
          label={t("news.statsFeeds")}
          value={value(feeds)}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
