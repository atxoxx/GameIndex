import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

interface DealsEmptyStateProps {
  icon: ReactNode;
  message: string;
  onRetry?: () => void;
}

/** Neutral state for "nothing here" — tonal surface, not a warning box. */
export default function DealsEmptyState({ icon, message, onRetry }: DealsEmptyStateProps) {
  const { t } = useLanguage();

  return (
    <div className="deals-state">
      <span className="deals-state__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="deals-state__message">{message}</p>
      {onRetry && (
        <button type="button" className="deals-state__action" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
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

/** Failure state — the same shape as the empty state, tinted with danger. */
export function DealsErrorState({ message, onRetry }: DealsErrorStateProps) {
  const { t } = useLanguage();

  return (
    <div className="deals-state deals-state--error" role="alert">
      <span className="deals-state__icon" aria-hidden="true">
        <AlertTriangle size={22} strokeWidth={1.6} />
      </span>
      <p className="deals-state__message">{message}</p>
      {onRetry && (
        <button type="button" className="deals-state__action" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          {t("deals.retryButton")}
        </button>
      )}
    </div>
  );
}
