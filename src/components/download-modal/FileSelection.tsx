import { useState, useMemo } from "react";
import { Button } from "../ui";
import { formatBytesShort } from "../../types/download";
import { useLanguage } from "../../context/LanguageContext";

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

  return (
    <div className="dl-file-selection">
      <div className="dl-file-selection-heading">
        <h3>{t('downloadFiles.heading')}</h3>
        <p>{t('downloadFiles.headingHint')}</p>
      </div>

      <div className="dl-file-selection-header">
        <input
          type="text"
          placeholder={t('downloadFiles.filterPlaceholder')}
          className="search-input dl-file-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t('downloadFiles.filterAria')}
        />
        <div className="dl-file-selection-actions">
          <Button variant="secondary" size="sm" onClick={handleSelectAll}>
            {t('downloadFiles.selectAll')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDeselectAll}>
            {t('common.clear')}
          </Button>
        </div>
      </div>

      <div className="dl-file-selection-summary">
        <span>
          <strong>{selectedFiles.size}</strong> {t('downloadFiles.ofFilesSelected', { total: files.length })}
        </span>
        <span className="dl-file-selection-bytes">
          {t('downloadFiles.bytesOf', { selected: formatBytesShort(selectedBytes), total: formatBytesShort(totalBytes) })}
        </span>
      </div>

      <div className="dl-file-list scrollable">
        {filtered.length === 0 ? (
          <div className="dl-file-empty">{t('downloadFiles.noMatch')}</div>
        ) : (
          filtered.map(({ file, idx }) => {
            const isChecked = selectedFiles.has(idx);
            return (
              <label
                key={idx}
                className={`dl-file-select-item${isChecked ? " checked" : ""}`}
              >
                <input type="checkbox" checked={isChecked} onChange={() => handleToggle(idx)} />
                <span className="dl-file-name" title={file.name}>
                  {file.name}
                </span>
                <span className="dl-file-size">{formatBytesShort(file.size)}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
