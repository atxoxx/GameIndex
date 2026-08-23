import { useState, useMemo } from "react";
import { Button } from "../ui";
import { formatBytesShort } from "../../types/download";
import { useLanguage } from "../../context/LanguageContext";
import { getFileCategory } from "./helpers";

export function FileSelection({
  files,
  selectedFiles,
  onChange,
}: {
  files: { name: string; size: number }[];
  selectedFiles: Set<number>;
  onChange: (indices: Set<number>) => void;
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    return files
      .map((f, i) => ({ file: f, idx: i }))
      .filter(({ file }) => file.name.toLowerCase().includes(filter.toLowerCase()));
  }, [files, filter]);

  const handleToggle = (idx: number) => {
    const next = new Set(selectedFiles);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    onChange(next);
  };

  const handleSelectAll = () => onChange(new Set(files.map((_, i) => i)));
  const handleDeselectAll = () => onChange(new Set());

  const selectedBytes = files.reduce(
    (sum, f, i) => (selectedFiles.has(i) ? sum + f.size : sum),
    0,
  );
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const percentage = totalBytes > 0 ? Math.round((selectedBytes / totalBytes) * 100) : 0;

  const renderFileIcon = (category: ReturnType<typeof getFileCategory>) => {
    switch (category) {
      case "executable":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        );
      case "archive":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        );
      case "disc":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        );
      case "media":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        );
      case "data":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        );
    }
  };

  return (
    <div className="dl-file-selector-container">
      {/* Heading & Summary Bar */}
      <div className="dl-file-selector-hero">
        <div className="dl-file-hero-info">
          <h3 className="dl-file-hero-title">{t("downloadFiles.heading")}</h3>
          <p className="dl-file-hero-desc">{t("downloadFiles.headingHint")}</p>
        </div>

        {/* Selected Weight Progress Badge */}
        <div className="dl-file-weight-card">
          <div className="dl-file-weight-top">
            <span className="dl-file-weight-label">
              <strong>{selectedFiles.size}</strong> {t("downloadFiles.ofFilesSelected", { count: selectedFiles.size, total: files.length })}
            </span>
            <span className="dl-file-weight-percent">{percentage}%</span>
          </div>
          <div className="dl-file-weight-track">
            <div className="dl-file-weight-fill" style={{ width: `${percentage}%` }} />
          </div>
          <span className="dl-file-weight-bytes">
            {t("downloadFiles.bytesOf", {
              loaded: formatBytesShort(selectedBytes),
              total: formatBytesShort(totalBytes),
            })}
          </span>
        </div>
      </div>

      {/* Filter and Quick Action Toolbar */}
      <div className="dl-file-toolbar">
        <div className="dl-file-search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="dl-file-search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={t("downloadFiles.filterPlaceholder")}
            className="dl-file-search-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={t("downloadFiles.filterAria")}
          />
          {filter && (
            <button
              type="button"
              className="dl-file-search-clear"
              onClick={() => setFilter("")}
              aria-label={t("downloadsFilter.clearSearch")}
            >
              ×
            </button>
          )}
        </div>

        <div className="dl-file-toolbar-actions">
          <Button variant="secondary" size="sm" onClick={handleSelectAll}>
            {t("downloadFiles.selectAll")}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDeselectAll}>
            {t("common.clear")}
          </Button>
        </div>
      </div>

      {/* File List */}
      <div className="dl-file-table-list scrollable">
        {filtered.length === 0 ? (
          <div className="dl-file-empty">{t("downloadFiles.noMatch")}</div>
        ) : (
          filtered.map(({ file, idx }) => {
            const isChecked = selectedFiles.has(idx);
            const category = getFileCategory(file.name);
            return (
              <label
                key={idx}
                className={`dl-file-row${isChecked ? " is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  className="dl-file-checkbox"
                  checked={isChecked}
                  onChange={() => handleToggle(idx)}
                />
                <div className={`dl-file-type-icon dl-file-type-icon--${category}`}>
                  {renderFileIcon(category)}
                </div>
                <span className="dl-file-item-name" title={file.name}>
                  {file.name}
                </span>
                <span className="dl-file-item-size">{formatBytesShort(file.size)}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
