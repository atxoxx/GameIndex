// BigScreenState — the three shared "this rail/pane has nothing yet"
// surfaces for Big Screen pages: loading, empty and error.
//
// A controller-first page needs one thing from each of these states:
// something the D-pad can land on (the retry button on errors), a
// glanceable message sized for a couch, and a stable layout so the
// page doesn't jump when the real content arrives.
//
// Loading and empty are inert; only the error state carries a
// focusable retry action when `onRetry` is provided.

import { useFocusable } from "../../hooks/useFocusable";
import { useLanguage } from "../../context/LanguageContext";

interface BigScreenStateBaseProps {
  /** Message body. Localized by the caller. */
  message: string;
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  const retryProps = useFocusable(onRetry);
  return (
    <button
      type="button"
      className="bigscreen-state-retry"
      {...retryProps}
    >
      {t("bigscreen.state.retry")}
    </button>
  );
}

/** Warm, centered spinner + label while data is in flight. */
export function BigScreenLoadingState({ message }: BigScreenStateBaseProps) {
  return (
    <div className="bigscreen-state bigscreen-state--loading" role="status" aria-live="polite">
      <span className="bigscreen-state-spinner" aria-hidden="true" />
      <span className="bigscreen-state-message">{message}</span>
    </div>
  );
}

/** Quiet empty state for a legitimately empty rail or pane. */
export function BigScreenEmptyState({ message }: BigScreenStateBaseProps) {
  return (
    <div className="bigscreen-state bigscreen-state--empty" role="status">
      <span className="bigscreen-state-message">{message}</span>
    </div>
  );
}

/** Error state with a controller-A-activatable Retry. */
export function BigScreenErrorState({
  message,
  onRetry,
}: BigScreenStateBaseProps & { onRetry: () => void }) {
  return (
    <div className="bigscreen-state bigscreen-state--error" role="alert">
      <span className="bigscreen-state-message">{message}</span>
      <RetryButton onRetry={onRetry} />
    </div>
  );
}
