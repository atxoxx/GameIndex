import React, { useMemo } from "react";
import type { TorrentDownload } from "../../types/download";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useGames } from "../../context/GameContext";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
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
} from "../../types/download";
import {
  PlayIcon,
  PauseIcon,
  FolderIcon,
  TrashIcon,
  PeersIcon,
  SeedsIcon,
  GameFallbackIcon,
  RemoveIcon,
} from "./DownloadIcons";

interface DownloadGridCardProps {
  download: TorrentDownload;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteFiles: (download: TorrentDownload) => void;
}

export const DownloadGridCard = React.memo(({
  download,
  selected = false,
  onToggleSelect,
  onPause,
  onResume,
  onRemove,
  onDeleteFiles,
}: DownloadGridCardProps) => {
  const { unit } = useSizeUnit();
  const { games, launchGame } = useGames();
  const { openDownloadFolder } = useDownloads();
  const { showToast } = useToast();
  const { t } = useLanguage();

  // Match corresponding game in library for cover artwork & direct play
  const matchedGame = useMemo(() => {
    if (download.gameId) {
      const g = games.find((item) => item.id === download.gameId);
      if (g) return g;
    }
    const dlNameLower = download.name.toLowerCase();
    return games.find((item) => {
      const gNameLower = item.name.toLowerCase();
      return dlNameLower.includes(gNameLower) || gNameLower.includes(dlNameLower);
    });
  }, [games, download.gameId, download.name]);

  const status = download.status;
  const isCompleted = status.kind === "completed";
  const isPaused = status.kind === "paused";
  const isError = status.kind === "error";
  const isSeeding = status.kind === "seeding";
  const errorMessage = getStatusError(status);
  const activity = getActivityMessage(download);

  const artworkUrl = matchedGame?.coverArtUrl || matchedGame?.iconUrl;

  const handleLaunch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!matchedGame) return;
    try {
      await launchGame(matchedGame);
    } catch (err) {
      showToast(t("game.launchFailed", { error: String(err) }), "error");
    }
  };

  const isPlayable = isCompleted && matchedGame && matchedGame.installed;

  return (
    <div
      className={`dl-card${selected ? " dl-card--selected" : ""}${isError ? " dl-card--error" : ""}${
        isCompleted ? " dl-card--completed" : ""
      }`}
    >
      {/* Artwork Header */}
      <div className="dl-card-media">
        {artworkUrl ? (
          <img src={artworkUrl} alt={download.name} className="dl-card-img" />
        ) : (
          <div className="dl-card-placeholder">
            <GameFallbackIcon style={{ width: 44, height: 44, opacity: 0.4 }} />
          </div>
        )}

        <div className="dl-card-media-overlay" />

        {/* Selection Checkbox */}
        {onToggleSelect && (
          <div className="dl-card-checkbox-wrapper" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="dl-card-checkbox"
              checked={selected}
              onChange={() => onToggleSelect(download.id)}
              aria-label={`Select ${download.name}`}
            />
          </div>
        )}

        {/* Status Tag */}
        <span
          className={`dl-card-status dl-row-status--${getStatusClassSuffix(status)}`}
        >
          {getStatusLabel(status)}
        </span>

        {/* Source Badge */}
        <span className="dl-card-source-tag">{download.sourceName}</span>
      </div>

      {/* Card Body */}
      <div className="dl-card-body">
        <h4 className="dl-card-title" title={download.name}>
          {download.name}
        </h4>

        {/* Progress Bar & Percentage */}
        <div className="dl-card-progress-section">
          <div className="dl-card-bar">
            <div
              className="dl-card-bar-fill"
              style={{ width: `${(download.progress ?? 0) * 100}%` }}
            />
          </div>
          <div className="dl-card-progress-meta">
            <span className="dl-card-pct">{formatProgress(download.progress)}</span>
            <span className="dl-card-size">
              {formatBytesShort(download.downloaded, unit)}
              {download.totalSize != null && ` / ${formatBytesShort(download.totalSize, unit)}`}
            </span>
          </div>
        </div>

        {/* Live Telemetry / Swarm Stats */}
        <div className="dl-card-telemetry">
          {isActiveStatus(status) && download.downloadSpeed > 0 ? (
            <div className="dl-card-speed dl-card-speed--dl">
              ↓ {formatBytesPerSecond(download.downloadSpeed, unit)}
            </div>
          ) : isSeeding && download.uploadSpeed > 0 ? (
            <div className="dl-card-speed dl-card-speed--ul">
              ↑ {formatBytesPerSecond(download.uploadSpeed, unit)}
            </div>
          ) : (
            <div className="dl-card-speed dl-card-speed--muted">
              {isPaused ? t("download.status.paused") : isCompleted ? t("downloadRow.done") : "—"}
            </div>
          )}

          {isActiveStatus(status) && download.downloadSpeed > 0 && download.totalSize != null && (
            <div className="dl-card-eta">
              ⏱ {formatEta(download.downloaded, download.totalSize, download.downloadSpeed)}
            </div>
          )}

          {(download.peers > 0 || download.seeds > 0) && (
            <div className="dl-card-swarm">
              <span title={t("downloadRow.peersInSwarm")}>
                <PeersIcon style={{ width: 11, height: 11 }} />
                {download.peers}
              </span>
              <span title={t("downloadRow.seeds")} className="dl-card-seeds">
                <SeedsIcon style={{ width: 11, height: 11 }} />
                {download.seeds}
              </span>
            </div>
          )}
        </div>

        {/* Status Activity / Error */}
        {activity && !isError && (
          <div className="dl-card-activity">
            <span className="dl-row-activity-dot" />
            <span>{activity}</span>
          </div>
        )}

        {isError && errorMessage && (
          <div className="dl-card-error" role="alert">
            {errorMessage}
          </div>
        )}

        {/* Card Action Controls */}
        <div className="dl-card-actions">
          {isPlayable && (
            <button
              type="button"
              className="dl-card-action-btn primary"
              onClick={handleLaunch}
              title={t("game.play")}
            >
              <PlayIcon style={{ width: 12, height: 12 }} />
              <span>{t("game.play")}</span>
            </button>
          )}

          {(status.kind === "downloading" || status.kind === "fetchingMetadata") && (
            <button
              type="button"
              className="dl-card-icon-btn"
              onClick={() => onPause(download.id)}
              title={t("downloadRow.pause")}
            >
              <PauseIcon />
            </button>
          )}

          {isPaused && (
            <button
              type="button"
              className="dl-card-icon-btn"
              onClick={() => onResume(download.id)}
              title={t("downloadRow.resume")}
            >
              <PlayIcon />
            </button>
          )}

          <button
            type="button"
            className="dl-card-icon-btn"
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

          <button
            type="button"
            className="dl-card-icon-btn danger"
            onClick={() => onRemove(download.id)}
            title={t("common.remove")}
          >
            <RemoveIcon />
          </button>

          <button
            type="button"
            className="dl-card-icon-btn danger-fill"
            onClick={() => onDeleteFiles(download)}
            title={t("downloadRow.deleteFromDisk")}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
});

DownloadGridCard.displayName = "DownloadGridCard";
