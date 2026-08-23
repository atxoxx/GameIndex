import { useMemo } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  formatBytesShort,
  formatBytesPerSecond,
  formatProgress,
  formatEta,
  type DownloadStatus,
  type TorrentDownload,
} from "../../types/download";
import HomeSection from "./HomeSection";

const ACTIVE_KINDS: DownloadStatus["kind"][] = [
  "queued",
  "fetchingMetadata",
  "downloading",
  "paused",
  "seeding",
];

/**
 * HomeDownloads — live snapshot of everything currently in flight,
 * rendered as compact progress rows with pause/resume. Mirrors the
 * Downloads page's data source (`DownloadContext`) so the widget stays
 * in sync with the 2 s `download-progress` event stream. Renders nothing
 * when nothing is downloading.
 */
export default function HomeDownloads() {
  const { activeDownloads, pauseDownload, resumeDownload } = useDownloads();
  const { t } = useLanguage();

  const inFlight = useMemo(
    () => activeDownloads.filter((d) => ACTIVE_KINDS.includes(d.status.kind)),
    [activeDownloads]
  );

  if (inFlight.length === 0) return null;

  return (
    <HomeSection
      className="home-downloads"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      }
      title={t("home.downloads.title")}
      subtitle={t("home.downloads.subtitle", { count: inFlight.length })}
      viewAllPath="/downloads"
    >
      <div className="home-downloads__list">
        {inFlight.slice(0, 4).map((d) => (
          <HomeDownloadRow
            key={d.id}
            download={d}
            onPause={() => pauseDownload(d.id)}
            onResume={() => resumeDownload(d.id)}
          />
        ))}
      </div>
    </HomeSection>
  );
}

function HomeDownloadRow({
  download,
  onPause,
  onResume,
}: {
  download: TorrentDownload;
  onPause: () => void;
  onResume: () => void;
}) {
  const { t } = useLanguage();
  const paused = download.status.kind === "paused";
  const pct = formatProgress(download.progress);
  const eta = formatEta(download.downloaded, download.totalSize, download.downloadSpeed, t);

  return (
    <div className="home-downloads__row">
      <div className="home-downloads__row-top">
        <span className="home-downloads__name" title={download.name}>
          {download.name}
        </span>
        <button
          type="button"
          className="home-downloads__toggle"
          onClick={paused ? onResume : onPause}
          title={paused ? t("downloadRow.resume") : t("downloadRow.pause")}
          aria-label={paused ? t("downloadRow.resume") : t("downloadRow.pause")}
        >
          {paused ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
        </button>
      </div>
      <div className="home-downloads__bar">
        <div
          className={`home-downloads__bar-fill${paused ? " paused" : ""}${
            download.progress == null ? " indeterminate" : ""
          }`}
          style={{
            width: download.progress != null ? `${Math.min(100, download.progress * 100)}%` : "100%",
          }}
        />
      </div>
      <div className="home-downloads__meta">
        <span className={`home-downloads__status home-downloads__status--${download.status.kind}`}>
          {t(`download.status.${download.status.kind}`)}
        </span>
        <span className="home-downloads__bytes">
          {formatBytesShort(download.downloaded)}
          {download.totalSize != null ? ` / ${formatBytesShort(download.totalSize)}` : ""}
          {download.totalSize != null ? ` · ${pct}` : ""}
        </span>
        {download.downloadSpeed > 0 && (
          <span className="home-downloads__speed">
            {formatBytesPerSecond(download.downloadSpeed)}
            {eta ? ` · ${eta}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
