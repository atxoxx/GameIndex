import { useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import {
  formatBytesShort,
  formatProgress,
  formatSpeed,
  getStatusLabel,
  isActiveStatus,
  isCompletedStatus,
  type TorrentDownload,
} from "../../types/download";

const MAX_ROWS = 5;

/**
 * Collapsible strip showing the live download queue inside the modal, so
 * users keep context while browsing sources. Read-only.
 */
export function QueuePreview({ downloads }: { downloads: TorrentDownload[] }) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const [open, setOpen] = useState(true);

  const activeCount = useMemo(
    () => downloads.filter((d) => isActiveStatus(d.status)).length,
    [downloads],
  );

  const rows = useMemo(() => {
    const active = downloads.filter((d) => isActiveStatus(d.status));
    const recent = downloads.filter((d) => isCompletedStatus(d.status));
    return [...active, ...recent].slice(0, MAX_ROWS);
  }, [downloads]);

  if (rows.length === 0) return null;

  return (
    <section className={`dl-queue-preview${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="dl-queue-preview-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={
          open
            ? t("downloadModal.queueToggleHide")
            : t("downloadModal.queueToggleShow")
        }
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span className="dl-queue-preview-title">
          {t("downloadModal.queueTitle")}
        </span>
        {activeCount > 0 && (
          <span className="dl-queue-preview-count">
            {t("downloadModal.queueActive", { count: activeCount })}
          </span>
        )}
        <svg
          className={`dl-queue-preview-chevron${open ? " open" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul className="dl-queue-preview-list">
          {rows.map((d) => {
            const done = isCompletedStatus(d.status);
            const pct = done ? 1 : d.progress;
            return (
              <li key={d.id} className="dl-queue-preview-row">
                <span className="dl-queue-preview-name" title={d.name}>
                  {d.name}
                </span>
                <span className="dl-queue-preview-status">
                  {getStatusLabel(d.status, t)}
                </span>
                <span className="dl-queue-preview-progress">
                  <span className="dl-queue-preview-track">
                    <span
                      className={`dl-queue-preview-fill${done ? " is-done" : ""}`}
                      style={{ width: `${Math.round((pct ?? 0) * 100)}%` }}
                    />
                  </span>
                  <span className="dl-queue-preview-pct">
                    {done ? "100%" : formatProgress(d.progress)}
                  </span>
                </span>
                <span className="dl-queue-preview-speed">
                  {d.downloadSpeed > 0 ? formatSpeed(d.downloadSpeed) : ""}
                </span>
                <span className="dl-queue-preview-size">
                  {formatBytesShort(d.downloaded, unit)}
                  {d.totalSize ? ` / ${formatBytesShort(d.totalSize, unit)}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
