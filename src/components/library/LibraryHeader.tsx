import { ArrowDownToLine, CheckSquare, Plus, Store } from "lucide-react";
import { Button } from "../ui";
import { PageHeader } from "../ui/PageHeader";
import { useLanguage } from "../../context/LanguageContext";

interface LibraryHeaderProps {
  /** Total games in the library, rendered next to the title. */
  total: number;
  bulkMode: boolean;
  onToggleBulkMode: () => void;
  onImport: () => void;
  onBrowseStore: () => void;
  onExport: () => void;
}

/**
 * LibraryHeader — the page's title block and page-level actions.
 *
 * Deliberately the only non-sticky row above the fold: the title, the owned
 * game count, and the actions that are not part of the browsing loop
 * (import, store, export, bulk selection). Search, filters, sorting and
 * density live in the sticky command bar below.
 */
export default function LibraryHeader({
  total,
  bulkMode,
  onToggleBulkMode,
  onImport,
  onBrowseStore,
  onExport,
}: LibraryHeaderProps) {
  const { t } = useLanguage();

  return (
    <PageHeader
      className="library-header"
      eyebrow={t("library.header.eyebrow")}
      title={
        <>
          <span className="library-header-title">{t("nav.library")}</span>
          <span className="library-header-count" aria-hidden="true">
            {total}
          </span>
        </>
      }
      actions={
        <div className="library-header-actions">
          <Button size="sm" leftIcon={<Plus size={15} />} onClick={onImport}>
            {t("lib.hero.importGames")}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Store size={15} />}
            onClick={onBrowseStore}
          >
            {t("lib.hero.browseStore")}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            iconOnly
            title={t("libraryExport.export")}
            aria-label={t("libraryExport.export")}
            onClick={onExport}
          >
            <ArrowDownToLine size={16} />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            iconOnly
            active={bulkMode}
            aria-pressed={bulkMode}
            title={t("storeToolbar.selectMultiple")}
            aria-label={t("storeToolbar.selectMultiple")}
            onClick={onToggleBulkMode}
          >
            <CheckSquare size={16} />
          </Button>
        </div>
      }
    />
  );
}
