import { useLanguage } from "../../context/LanguageContext";

interface LibraryFilteredEmptyProps {
  onReset: () => void;
}

/**
 * Empty state shown when the library has games but the active filters
 * match nothing. Extracted from the page monolith so the grid area stays
 * a single composable unit.
 */
export default function LibraryFilteredEmpty({ onReset }: LibraryFilteredEmptyProps) {
  const { t } = useLanguage();

  return (
    <div className="lib-filtered-empty">
      <svg className="lib-filtered-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
      <p className="lib-filtered-empty-title">{t("page.library.noFilterResultsTitle")}</p>
      <p className="lib-filtered-empty-subtitle">{t("page.library.noFilterResultsSubtitle")}</p>
      <button type="button" className="lib-filtered-empty-reset" onClick={onReset}>
        {t("page.library.clearFilters")}
      </button>
    </div>
  );
}
