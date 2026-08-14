import { KpiTile } from "../ui/KpiTile";
import { useLanguage } from "../../context/LanguageContext";

interface NewsStatsHeaderProps {
  total: number;
  unread: number;
  saved: number;
  feeds: number;
  loading: boolean;
}

/**
 * NewsStatsHeader — glass KPI strip above the feed. Mirrors the Deals
 * stats header: four compact tiles so the page opens with a quick
 * pulse of "how much is in here" before the article grid.
 */
export default function NewsStatsHeader({
  total,
  unread,
  saved,
  feeds,
  loading,
}: NewsStatsHeaderProps) {
  const { t } = useLanguage();
  const value = (n: number) => (loading ? "…" : n);

  return (
    <div className="news-stats-header">
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
      <KpiTile
        size="sm"
        glass
        intent="accent"
        label={t("news.statsFeeds")}
        value={value(feeds)}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2v20h20" />
            <path d="M6 16a3 3 0 0 1 3 3" />
            <path d="M6 10a9 9 0 0 1 9 9" />
            <path d="M6 4a15 15 0 0 1 15 15" />
          </svg>
        }
      />
    </div>
  );
}
