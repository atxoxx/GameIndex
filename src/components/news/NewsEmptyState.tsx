import type { ReactNode } from "react";
import { useLanguage } from "../../context/LanguageContext";

interface NewsEmptyStateProps {
  icon: ReactNode;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * NewsEmptyState — the feed has nothing to show. Variants are picked by
 * the parent (no sources / no saved / no search hits / just empty).
 */
export default function NewsEmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: NewsEmptyStateProps) {
  return (
    <div className="news-empty" role="status">
      <span className="news-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {actionLabel && onAction && (
        <button type="button" className="news-retry-btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

interface NewsErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function NewsErrorState({ message, onRetry }: NewsErrorStateProps) {
  const { t } = useLanguage();

  return (
    <div className="news-error" role="alert">
      <svg
        className="news-error-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h3>{t("news.couldntLoad")}</h3>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="news-retry-btn" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
