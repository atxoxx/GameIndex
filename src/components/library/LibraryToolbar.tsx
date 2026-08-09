import type { LibrarySort } from "../../hooks/useLibraryFilters";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import DensityToggle from "../DensityToggle";
import LibrarySortMenu from "./LibrarySortMenu";

interface LibraryToolbarProps {
  /** Primary heading ("Library" or "Your Games"). */
  title: string;
  /** Optional count badge shown next to the title. */
  count?: string | number | null;
  /** Search input value. */
  search: string;
  onSearchChange: (q: string) => void;
  sort: LibrarySort;
  onSortChange: (s: LibrarySort) => void;
  density: ViewDensity;
  onDensityChange: (d: ViewDensity) => void;
  /** Opens the "Export library as HTML" modal. */
  onExport: () => void;
}

/** Share/download glyph for the export trigger. */
const ExportIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </svg>
);

/**
 * LibraryToolbar — the sticky pill bar at the top of the grid: title +
 * count on the left, search + sort + density controls on the right.
 * Extracted from the old LibraryPage monolith so the page shell only
 * orchestrates layout.
 */
export default function LibraryToolbar({
  title,
  count,
  search,
  onSearchChange,
  sort,
  onSortChange,
  density,
  onDensityChange,
  onExport,
}: LibraryToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className="lib-toolbar">
      <div className="lib-toolbar-title">
        <h2>{title}</h2>
        {count != null && count !== "" && (
          <span className="lib-toolbar-count">{count}</span>
        )}
      </div>

      <div className="lib-toolbar-controls">
        <div className="lib-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("page.library.searchPlaceholder")}
            aria-label={t("page.library.searchLabel")}
          />
        </div>
        <LibrarySortMenu value={sort} onChange={onSortChange} />
        <button
          type="button"
          className="lib-export-trigger"
          onClick={onExport}
          title={t("libraryExport.export")}
          aria-label={t("libraryExport.export")}
        >
          <span className="lib-export-trigger-icon" aria-hidden="true"><ExportIcon /></span>
          <span>{t("libraryExport.export")}</span>
        </button>
        <div className="lib-toolbar-group" role="radiogroup" aria-label={t("libraryPage.layoutDensity")}>
          <DensityToggle density={density} onChange={onDensityChange} />
        </div>
      </div>
    </div>
  );
}
