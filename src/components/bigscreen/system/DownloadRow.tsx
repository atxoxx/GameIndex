// DownloadRow — one download's name, progress bar and actions row.
// Owns its focusable hooks unconditionally (rules-of-hooks).

import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import type { TorrentDownload } from "../../../context/DownloadContext";

export default function DownloadRow({
  dl,
  onPause,
  onResume,
  onCancel,
}: {
  dl: TorrentDownload;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const resumeProps = useFocusable(onResume);
  const pauseProps = useFocusable(onPause);
  const cancelProps = useFocusable(onCancel);

  const isDownloading =
    dl.status.kind === "downloading" || dl.status.kind === "fetchingMetadata";

  // Human status label — the six shared kinds reuse the desktop
  // `download.status.*` keys; `seeding` has no desktop key yet.
  const statusLabel =
    dl.status.kind === "seeding"
      ? t("bigscreen.system.statusSeeding")
      : t(`download.status.${dl.status.kind}`);

  return (
    <div className="system-download-row">
      <div className="dl-row-header">
        <span className="dl-name">{dl.name}</span>
        <span className="dl-status-badge">{statusLabel}</span>
      </div>
      <div className="dl-progress-container">
        <div className="dl-progress-bar">
          <div className="dl-progress-fill" style={{ width: `${(dl.progress || 0) * 100}%` }} />
        </div>
        <span className="dl-percent">{Math.round((dl.progress || 0) * 100)}%</span>
      </div>
      <div className="dl-actions-row">
        {isDownloading ? (
          <button type="button" className="dl-action-btn dl-btn-pause" {...pauseProps}>
            {t("bigscreen.system.pause")}
          </button>
        ) : (
          <button type="button" className="dl-action-btn dl-btn-play" {...resumeProps}>
            {t("bigscreen.system.resume")}
          </button>
        )}
        <button type="button" className="dl-action-btn dl-btn-cancel" {...cancelProps}>
          {t("bigscreen.system.cancel")}
        </button>
      </div>
    </div>
  );
}
