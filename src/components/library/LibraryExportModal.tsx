import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Game } from "../../types/game";
import { Button } from "../ui";
import {
  buildLibraryExportHtml,
  type LibraryExportOptions,
  type LibraryExportSort,
  type LibraryExportTheme,
} from "../../utils/libraryExportHtml";

interface LibraryExportModalProps {
  /** The entire library (used by the "Entire library" scope). */
  games: Game[];
  /** The currently filtered/sorted view (used by the "Current view" scope). */
  filteredGames: Game[];
  onClose: () => void;
}

interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** Tiny segmented control used for scope / sort / theme choices. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="lib-export-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          className={`lib-export-seg-btn${opt.value === value ? " active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Download/share glyph used on the toolbar trigger + export button. */
const ExportIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3v12" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </svg>
);

/**
 * LibraryExportModal — configure + write a standalone HTML showcase of
 * the library. The user picks what to embed (covers, playtime, badges,
 * genres, ratings, year), the sort order, the scope (current filtered
 * view vs. the whole library) and the exported page's theme, then the
 * modal opens the native save dialog and writes the file via the
 * existing `save_text_file` Tauri command.
 */
export default function LibraryExportModal({
  games,
  filteredGames,
  onClose,
}: LibraryExportModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [includeCovers, setIncludeCovers] = useState(true);
  const [includePlaytime, setIncludePlaytime] = useState(true);
  const [includePlatforms, setIncludePlatforms] = useState(true);
  const [includeGenres, setIncludeGenres] = useState(true);
  const [includeRating, setIncludeRating] = useState(false);
  const [includeYear, setIncludeYear] = useState(false);
  const [groupByPlatform, setGroupByPlatform] = useState(true);
  const [sort, setSort] = useState<LibraryExportSort>("name");
  const [scope, setScope] = useState<"current" | "all">("current");
  const [theme, setTheme] = useState<LibraryExportTheme>("dark");
  const [exporting, setExporting] = useState(false);

  // Close on Escape, mirroring the emulator editor modal pattern.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const targetGames = scope === "current" ? filteredGames : games;
  const targetCount = targetGames.length;

  const sortOptions = useMemo<SegOption<LibraryExportSort>[]>(
    () => [
      { value: "name", label: t("libraryExport.sortName") },
      { value: "recent", label: t("libraryExport.sortRecent") },
      { value: "played", label: t("libraryExport.sortPlayed") },
    ],
    [t]
  );

  const scopeOptions = useMemo<SegOption<"current" | "all">[]>(
    () => [
      { value: "current", label: t("libraryExport.scopeCurrent") },
      { value: "all", label: t("libraryExport.scopeAll") },
    ],
    [t]
  );

  const themeOptions = useMemo<SegOption<LibraryExportTheme>[]>(
    () => [
      { value: "dark", label: t("libraryExport.themeDark") },
      { value: "light", label: t("libraryExport.themeLight") },
    ],
    [t]
  );

  async function handleExport() {
    if (targetCount === 0) return;
    setExporting(true);
    try {
      const filePath = await save({
        title: t("libraryExport.saveTitle"),
        defaultPath: `gamelib-library-${new Date().toISOString().slice(0, 10)}.html`,
        filters: [{ name: t("libraryExport.htmlFile"), extensions: ["html"] }],
      });
      if (!filePath) return; // user cancelled the save dialog

      const options: LibraryExportOptions = {
        includeCovers,
        includePlaytime,
        includePlatforms,
        includeGenres,
        includeRating,
        includeYear,
        groupByPlatform,
        sort,
        theme,
      };
      const html = buildLibraryExportHtml(targetGames, options);
      await invoke("save_text_file", { filePath, contents: html });
      showToast(t("libraryExport.exported"), "success");
      onClose();
    } catch (error) {
      console.error("Library export error:", error);
      showToast(t("libraryExport.exportFailed", { error: String(error) }), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="modal-overlay lib-export-overlay" onMouseDown={onClose}>
      <div
        className="modal lib-export-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("libraryExport.title")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-text">
            <h2 className="modal-title">{t("libraryExport.title")}</h2>
            <p className="modal-subtitle">{t("libraryExport.subtitle")}</p>
          </div>
          <button className="modal-close lib-export-close" aria-label={t("common.close")} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body lib-export-body">
          {/* Export scope */}
          <section className="lib-export-section">
            <h3 className="lib-export-section-title">{t("libraryExport.scope")}</h3>
            <Segmented options={scopeOptions} value={scope} onChange={setScope} ariaLabel={t("libraryExport.scope")} />
            <p className="lib-export-scope-count">
              {t("libraryExport.count", { count: targetCount })}
            </p>
          </section>

          {/* Sort order */}
          <section className="lib-export-section">
            <h3 className="lib-export-section-title">{t("libraryExport.sort")}</h3>
            <Segmented options={sortOptions} value={sort} onChange={setSort} ariaLabel={t("libraryExport.sort")} />
          </section>

          {/* Theme */}
          <section className="lib-export-section">
            <h3 className="lib-export-section-title">{t("libraryExport.theme")}</h3>
            <Segmented options={themeOptions} value={theme} onChange={setTheme} ariaLabel={t("libraryExport.theme")} />
          </section>

          {/* Layout */}
          <section className="lib-export-section">
            <h3 className="lib-export-section-title">{t("libraryExport.layout")}</h3>
            <div className="lib-export-checks">
              <label className="lib-export-check">
                <input
                  type="checkbox"
                  checked={groupByPlatform}
                  onChange={(e) => setGroupByPlatform(e.target.checked)}
                />
                <span className="lib-export-check-text">
                  <span className="lib-export-check-title">{t("libraryExport.groupByPlatform")}</span>
                  <span className="lib-export-check-desc">{t("libraryExport.groupByPlatformDesc")}</span>
                </span>
              </label>
            </div>
          </section>

          {/* Content toggles */}
          <section className="lib-export-section">
            <h3 className="lib-export-section-title">{t("libraryExport.include")}</h3>
            <div className="lib-export-checks">
              <label className="lib-export-check">
                <input type="checkbox" checked={includeCovers} onChange={(e) => setIncludeCovers(e.target.checked)} />
                <span className="lib-export-check-text">
                  <span className="lib-export-check-title">{t("libraryExport.includeCovers")}</span>
                  <span className="lib-export-check-desc">{t("libraryExport.includeCoversDesc")}</span>
                </span>
              </label>
              <label className="lib-export-check">
                <input type="checkbox" checked={includePlaytime} onChange={(e) => setIncludePlaytime(e.target.checked)} />
                <span className="lib-export-check-text">
                  <span className="lib-export-check-title">{t("libraryExport.includePlaytime")}</span>
                  <span className="lib-export-check-desc">{t("libraryExport.includePlaytimeDesc")}</span>
                </span>
              </label>
              <label className="lib-export-check">
                <input type="checkbox" checked={includePlatforms} onChange={(e) => setIncludePlatforms(e.target.checked)} />
                <span className="lib-export-check-text">
                  <span className="lib-export-check-title">{t("libraryExport.includePlatforms")}</span>
                  <span className="lib-export-check-desc">{t("libraryExport.includePlatformsDesc")}</span>
                </span>
              </label>
              <label className="lib-export-check">
                <input type="checkbox" checked={includeGenres} onChange={(e) => setIncludeGenres(e.target.checked)} />
                <span className="lib-export-check-text">
                  <span className="lib-export-check-title">{t("libraryExport.includeGenres")}</span>
                  <span className="lib-export-check-desc">{t("libraryExport.includeGenresDesc")}</span>
                </span>
              </label>
              <label className="lib-export-check">
                <input type="checkbox" checked={includeRating} onChange={(e) => setIncludeRating(e.target.checked)} />
                <span className="lib-export-check-text">
                  <span className="lib-export-check-title">{t("libraryExport.includeRating")}</span>
                  <span className="lib-export-check-desc">{t("libraryExport.includeRatingDesc")}</span>
                </span>
              </label>
              <label className="lib-export-check">
                <input type="checkbox" checked={includeYear} onChange={(e) => setIncludeYear(e.target.checked)} />
                <span className="lib-export-check-text">
                  <span className="lib-export-check-title">{t("libraryExport.includeYear")}</span>
                  <span className="lib-export-check-desc">{t("libraryExport.includeYearDesc")}</span>
                </span>
              </label>
            </div>
          </section>

          {targetCount === 0 && (
            <p className="lib-export-empty-hint">{t("libraryExport.emptyHint")}</p>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {t("libraryExport.count", { count: targetCount })}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleExport}
              isLoading={exporting}
              disabled={targetCount === 0}
              leftIcon={<ExportIcon />}
            >
              {t("libraryExport.exportButton")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
