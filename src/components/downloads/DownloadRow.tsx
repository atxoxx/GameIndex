import React, { useState, useMemo } from "react";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useDownloadCoverArt } from "../../hooks/useDownloadCoverArt";
import { useDownloads } from "../../context/DownloadContext";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  PlayIcon,
  PauseIcon,
  RemoveIcon,
  TrashIcon,
  ChevronIcon,
  PeersIcon,
  SeedsIcon,
  FolderIcon,
  GameFallbackIcon,
} from "./DownloadIcons";
import {
  formatBytesPerSecond,
  formatBytesShort,
  formatProgress,
  getStatusError,
  getStatusLabel,
  getStatusClassSuffix,
  getActivityMessage,
  isActiveStatus,
  formatEta,
  type TorrentDownload,
} from "../../types/download";

interface DownloadRowProps {
  download: TorrentDownload;
  compact?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteFiles: (download: TorrentDownload) => void;
}

export const DownloadRow = React.memo(
  ({
    download,
    compact = false,
    selected = false,
    onToggleSelect,
    onPause,
    onResume,
    onRemove,
    onDeleteFiles,
  }: DownloadRowProps) => {
    const { unit: sizeUnit } = useSizeUnit();
    const { unit: speedUnit } = useSpeedUnit();
    const { launchGame } = useGames();
    const {
      updateSelectedFiles,
      openDownloadFolder,
      setSeeding,
    } = useDownloads();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const [expanded, setExpanded] = useState(false);

    // Resolve game artwork from library or automated metadata search
    const { matchedGame, coverArtUrl: artworkUrl } = useDownloadCoverArt(download);

    const handleToggleFile = async (idx: number) => {
      if (!download.files) return;

      const currentSelected = download.files
        .map((f, i) => ({ selected: f.selected, index: i }))
        .filter((item) => item.selected)
        .map((item) => item.index);

      let newSelected: number[];
      if (download.files[idx].selected) {
        if (currentSelected.length <= 1) {
          showToast(t("downloadModal.fileSelectRequired"), "error");
          return;
        }
        newSelected = currentSelected.filter((i) => i !== idx);
      } else {
        newSelected = [...currentSelected, idx];
      }

      try {
        await updateSelectedFiles(download.id, newSelected);
      } catch (err) {
        showToast(t("downloadRow.fileSelectionFailed", { error: String(err) }), "error");
      }
    };

    const status = download.status;
    const indeterminate = download.progress == null && isActiveStatus(status);
    const isPaused = status.kind === "paused";
    const isCompleted = status.kind === "completed";
    const isError = status.kind === "error";
    const fileSelectionLocked =
      isCompleted || (download.kind === "debrid" && isActiveStatus(status));
    const errorMessage = getStatusError(status);
    const isDirect = download.kind === "direct" || download.kind === "debrid";
    const activity = getActivityMessage(download, t);
    const isSeeding = status.kind === "seeding";

    const isStalledActivity =
      !isDirect &&
      status.kind === "downloading" &&
      download.peers > 0 &&
      download.downloadSpeed === 0 &&
      (download.totalSize ?? 0) > 0;

    // Swarm Health Calculation (0 to 4 bars)
    const swarmHealth = useMemo(() => {
      if (isDirect) return 4;
      if (isCompleted || isPaused) return 0;
      if (isStalledActivity) return 1;
      if (download.peers >= 15 || download.seeds >= 10) return 4;
      if (download.peers >= 5 || download.seeds >= 3) return 3;
      if (download.peers > 0 || download.seeds > 0) return 2;
      return 1;
    }, [isDirect, isCompleted, isPaused, isStalledActivity, download.peers, download.seeds]);

    const rowClass = [
      "dl-row",
      compact && "dl-row--compact",
      selected && "dl-row--selected",
      isError && "error",
      isCompleted && "completed",
      isPaused && "paused",
      indeterminate && "indeterminate",
    ]
      .filter(Boolean)
      .join(" ");

    const handleLaunch = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!matchedGame) return;
      try {
        await launchGame(matchedGame);
      } catch (err) {
        showToast(t("gameContext.launchFailed", { error: String(err) }), "error");
      }
    };

    const isPlayable = isCompleted && matchedGame && matchedGame.installed;

    return (
      <div className="dl-row-container">
        <div className={rowClass}>
          {/* Multi-select checkbox */}
          {onToggleSelect && (
            <div className="dl-row-checkbox-cell" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className="dl-row-checkbox"
                checked={selected}
                onChange={() => onToggleSelect(download.id)}
                aria-label={`Select ${download.name}`}
              />
            </div>
          )}

          {/* Thumbnail artwork (always rendered in detailed mode to maintain stable grid layout) */}
          {!compact && (
            <div className="dl-row-thumb" title={matchedGame?.name || download.name}>
              {artworkUrl ? (
                <img src={artworkUrl} alt={download.name} className="dl-row-thumb-img" />
              ) : (
                <div className="dl-row-thumb-placeholder">
                  <GameFallbackIcon style={{ width: 22, height: 22, opacity: 0.4 }} />
                </div>
              )}
            </div>
          )}

          {/* Main Info, Badges & Progress */}
          <div className="dl-row-main">
            <div className="dl-row-name-row">
              <div className="dl-row-name-group">
                <span className="dl-row-name" title={download.name}>
                  {download.name}
                </span>

                {/* Status Pill Badge next to title */}
                <span
                  className={`dl-row-status dl-row-status--${getStatusClassSuffix(status)}`}
                  title={getStatusLabel(status, t)}
                >
                  {getStatusLabel(status, t)}
                </span>

                {download.kind === "direct" && (
                  <span className="dl-row-badge dl-row-badge--direct">{t("downloadRow.badgeDirect")}</span>
                )}
                {download.kind === "debrid" && (
                  <span className="dl-row-badge dl-row-badge--debrid">{t("downloadRow.badgeDebrid")}</span>
                )}
                {download.kind === "debrid" && download.debridCached && (
                  <span className="dl-row-badge dl-row-badge--cached">{t("downloadRow.badgeCached")}</span>
                )}
                {isSeeding && (
                  <span className="dl-row-badge dl-row-badge--seeding">{t("downloadRow.badgeSeeding")}</span>
                )}
              </div>

              <div className="dl-row-meta-tags">
                <span
                  className="dl-row-source"
                  title={t("downloadRow.sourceTitle", { source: download.sourceName })}
                >
                  {download.sourceName}
                </span>
              </div>
            </div>

            {/* Progress Bar & ETA */}
            <div className="dl-row-progress-row">
              <div className="dl-row-bar">
                <div
                  className={`dl-row-bar-fill${status.kind === "downloading" ? " dl-row-bar-fill--active" : ""}`}
                  style={{
                    width: indeterminate ? "30%" : `${Math.max(0, Math.min(100, (download.progress ?? 0) * 100))}%`,
                  }}
                />
              </div>
              <span className="dl-row-progress">
                {formatProgress(download.progress)}
                {download.totalSize != null ? (
                  <span className="dl-row-size">
                    {" · "}
                    {formatBytesShort(download.downloaded, sizeUnit)} / {formatBytesShort(download.totalSize, sizeUnit)}
                  </span>
                ) : (
                  download.downloaded > 0 && (
                    <span className="dl-row-size">
                      {" · "}
                      {formatBytesShort(download.downloaded, sizeUnit)}
                    </span>
                  )
                )}
                {isActiveStatus(status) && download.downloadSpeed > 0 && download.totalSize != null && (
                  <span className="dl-row-eta">
                    {formatEta(download.downloaded, download.totalSize, download.downloadSpeed, t)}
                  </span>
                )}
              </span>
            </div>

            {/* Status activity string / error message */}
            {activity && !isError && (
              <div
                className={`dl-row-activity${isStalledActivity ? " dl-row-activity--stalled" : ""}${
                  isCompleted ? " dl-row-activity--completed" : ""
                }`}
              >
                <span className="dl-row-activity-dot" aria-hidden="true" />
                <span>{activity}</span>
              </div>
            )}

            {isError && errorMessage && (
              <div className="dl-row-error" role="alert">
                {errorMessage}
              </div>
            )}
          </div>

          {/* Speed Column (↓ / ↑) */}
          <div className="dl-row-speed">
            {isActiveStatus(status) && download.downloadSpeed > 0 ? (
              <span className="dl-row-speed-dl">
                ↓ {formatBytesPerSecond(download.downloadSpeed, speedUnit)}
              </span>
            ) : isSeeding && download.uploadSpeed > 0 ? (
              <span className="dl-row-speed-ul">
                ↑ {formatBytesPerSecond(download.uploadSpeed, speedUnit)}
              </span>
            ) : (
              <span className="dl-row-speed-muted">
                {isPaused ? t("download.status.paused") : isCompleted ? t("downloadRow.done") : "—"}
              </span>
            )}
            {isActiveStatus(status) && download.uploadSpeed > 0 && (
              <span className="dl-row-speed-ul">
                ↑ {formatBytesPerSecond(download.uploadSpeed, speedUnit)}
              </span>
            )}
          </div>

          {/* Swarm Column (Peers, Seeds, Health) */}
          <div className="dl-row-swarm">
            <div className="dl-row-swarm-counts">
              <span title={t("downloadRow.peersInSwarm")}>
                <PeersIcon style={{ width: 12, height: 12 }} />
                {download.peers}
              </span>
              <span title={t("downloadRow.seeds")} className="dl-row-swarm-seeds">
                <SeedsIcon style={{ width: 12, height: 12 }} />
                {download.seeds}
              </span>
            </div>
            {!isDirect && (
              <div
                className={`dl-swarm-health dl-swarm-health--${swarmHealth}`}
                title={t("downloadRow.swarmHealthTitle")}
              >
                <div className="dl-swarm-bar" />
                <div className="dl-swarm-bar" />
                <div className="dl-swarm-bar" />
                <div className="dl-swarm-bar" />
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="dl-row-actions">
            {/* Direct Play if game is installed */}
            {isPlayable && (
              <button
                type="button"
                className="dl-row-btn play-btn"
                onClick={handleLaunch}
                title={t("game.play")}
              >
                <PlayIcon />
              </button>
            )}



            {/* Open Download Folder */}
            <button
              type="button"
              className="dl-row-btn"
              onClick={async () => {
                try {
                  await openDownloadFolder(download.id);
                } catch (err) {
                  showToast(t("downloadRow.openFolderFailed", { error: String(err) }), "error");
                }
              }}
              title={t("downloadRow.openFolder")}
            >
              <FolderIcon />
            </button>

            {/* Expand Files Tree Button (if torrent has files list) */}
            {download.files && download.files.length > 0 && (
              <button
                type="button"
                className={`dl-row-btn${expanded ? " active" : ""}`}
                onClick={() => setExpanded(!expanded)}
                title={expanded ? t("downloadRow.hideFiles") : t("downloadRow.showFiles")}
                aria-expanded={expanded}
              >
                <ChevronIcon style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
              </button>
            )}

            {/* Pause Action */}
            {(status.kind === "downloading" || status.kind === "fetchingMetadata") && (
              <button
                type="button"
                className="dl-row-btn"
                onClick={() => onPause(download.id)}
                title={t("downloadRow.pause")}
              >
                <PauseIcon />
              </button>
            )}

            {/* Resume Action */}
            {isPaused && (
              <button
                type="button"
                className="dl-row-btn"
                onClick={() => onResume(download.id)}
                title={t("downloadRow.resume")}
              >
                <PlayIcon />
              </button>
            )}

            {/* Seeding Stop Toggle */}
            {isSeeding && (
              <button
                type="button"
                className="dl-row-btn"
                onClick={async () => {
                  try {
                    await setSeeding(download.id, false);
                  } catch (err) {
                    showToast(t("downloadRow.stopSeedingFailed", { error: String(err) }), "error");
                  }
                }}
                title={t("downloadRow.stopSeeding")}
              >
                <PauseIcon />
              </button>
            )}

            {/* Remove / Cancel (Keep Files) */}
            <button
              type="button"
              className="dl-row-btn danger"
              onClick={() => onRemove(download.id)}
              title={t("common.remove")}
            >
              <RemoveIcon />
            </button>

            {/* Delete Files from Disk */}
            <button
              type="button"
              className="dl-row-btn danger-fill"
              onClick={() => onDeleteFiles(download)}
              title={
                download.autoExtract
                  ? t("downloads.deleteArchivesHint")
                  : t("downloadRow.deleteFromDisk")
              }
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* Collapsible Files Selection Drawer */}
        {expanded && download.files && download.files.length > 0 && (
          <div className="dl-row-details">
            <div className="dl-files-list">
              {download.files.map((file, idx) => {
                const isSkipped = !file.selected;
                return (
                  <div
                    key={file.name || idx}
                    className={`dl-file-item${isSkipped ? " dl-file-item--skipped" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="dl-file-checkbox"
                      checked={file.selected}
                      disabled={fileSelectionLocked}
                      onChange={() => handleToggleFile(idx)}
                      aria-label={`Select ${file.name}`}
                    />
                    <span
                      className={`dl-file-name${isSkipped ? " dl-file-name--skipped" : ""}`}
                      title={file.name}
                    >
                      {file.name}
                    </span>
                    <span className="dl-file-size">
                      {formatBytesShort(file.size, sizeUnit)}
                    </span>
                    <div className="dl-file-progress-bar">
                      <div
                        className="dl-file-progress-fill"
                        style={{
                          width: `${Math.max(0, Math.min(100, (file.progress ?? 0) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="dl-file-percentage">
                      {file.progress != null ? `${Math.round(file.progress * 100)}%` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  },
);

DownloadRow.displayName = "DownloadRow";

export default DownloadRow;
