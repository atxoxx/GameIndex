import { useLanguage } from "../../../context/LanguageContext";

/** Fixed widths keep the shimmer from looking like a random barcode. */
const SKELETON_WIDTHS = ["92%", "64%", "78%", "45%", "86%", "58%", "71%", "38%"];

/**
 * Loading placeholder: eight shimmer rows instead of a spinner, so the
 * terminal footprint does not jump when the first read lands.
 */
export function WineLogsSkeleton() {
  const { t } = useLanguage();
  return (
    <div
      className="wine-logs-skeleton"
      role="status"
      aria-label={t("wineLogs.reading")}
    >
      {SKELETON_WIDTHS.map((width, index) => (
        <div className="wine-logs-skeleton-row" key={index}>
          <span className="wine-logs-skeleton-bar" style={{ width }} />
        </div>
      ))}
    </div>
  );
}
