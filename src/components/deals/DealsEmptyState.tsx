import type { ReactNode } from "react";
import { useLanguage } from "../../context/LanguageContext";

interface DealsEmptyStateProps {
  icon: ReactNode;
  message: string;
  onRetry?: () => void;
}

export default function DealsEmptyState({
  icon,
  message,
  onRetry,
}: DealsEmptyStateProps) {
  const { t } = useLanguage();

  return (
    <div className="deals-empty" role="status">
      <span className="deals-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          className="deals-empty-retry"
          onClick={onRetry}
        >
          {t("deals.retryButton")}
        </button>
      )}
    </div>
  );
}

interface DealsErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function DealsErrorState({ message, onRetry }: DealsErrorStateProps) {
  const { t } = useLanguage();

  return (
    <div className="deals-error" role="alert">
      <svg
        className="deals-error-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          className="deals-error-retry"
          onClick={onRetry}
        >
          {t("deals.retryButton")}
        </button>
      )}
    </div>
  );
}
