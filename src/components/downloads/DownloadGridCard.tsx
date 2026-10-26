import React from "react";
import type { TorrentDownload } from "../../types/download";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useDownloadCoverArt } from "../../hooks/useDownloadCoverArt";
import { useGames } from "../../context/GameContext";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import ContextMenu from "../ui/ContextMenu";
import { useDownloadMenuItems } from "./downloadMenu";
import {
  formatBytesPerSecond,
  formatBytesShort,
  formatProgress,
  getStatusError,
  getStatusLabel,
  getStatusClassSuffix,
  getActivityMessage,
  getDownloadDisplayName,
  isActiveStatus,
  formatEta,
} from "../../types/download";
import {
  PlayIcon,
  PauseIcon,
  PeersIcon,
  SeedsIcon,
  GameFallbackIcon,
} from "./DownloadIcons";
import { MoreHorizontal, RotateCcw } from "lucide-react";

interface DownloadGridCardProps {
  download: TorrentDownload;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteFiles: (download: TorrentDownload) => void;
}

export const DownloadGridCard = React.memo(
  ({
    download,
    selected = false,
    onToggleSelect,
    onPause,
    onResume,
    onRemove,
    onDeleteFiles,
  }: DownloadGridCardProps) => {
    const { unit: sizeUnit } = useSizeUnit();
    const { unit: speedUnit } = useSpeedUnit();
    const { launchGame } = useGames();
    const { setSeeding, retryDownload } = useDownloads();
    const { showToast } = useToast();
    const { t } = useLanguage();

    // Resolve artwork from library or automated metadata search
    const { matchedGame, coverArtUrl: artworkUrl } = useDownloadCoverArt(download);

    const downloadMenu = useContextMenu();
    const downloadMenuItems = useDownloadMenuItems(download, {
      matchedGame,
      onPause,
      onResume,
      onRemove,
      onDeleteFiles,
    });

    const status = download.status;
    const isCompleted = status.kind === "completed";
    const isPaused = status.kind === "paused";
    const isError = status.kind === "error";
    const isSeeding = status.kind === "seeding";
    const errorMessage = getStatusError(status);
    const activity = getActivityMessage(download, t);
    const displayName = getDownloadDisplayName(download, t);

    const handleLaunch = async () => {
      if (!matchedGame) return;
      try {
        await launchGame(matchedGame);
      } catch (err) {
        showToast(t("gameContext.launchFailed", { error: String(err) }), "error");
      }
    };

    const isPlayable = isCompleted && matchedGame && matchedGame.installed;

    const handleRetry = async () => {
      try {
        await retryDownload(download.id);
      } catch (err) {
        showToast(t("downloadRow.retryFailed", { error: String(err) }), "error");
      }
    };

    const handleStopSeeding = async () => {
      try {
        await setSeeding(download.id, false);
      } catch (err) {
        showToast(t("downloadRow.stopSeedingFailed", { error: String(err) }), "error");
      }
    };

    let primary: { tone: string; label: string; icon: React.ReactNode; onSelect: () => void } | null =
      null;
    if (isPlayable) {
      primary = {
        tone: "play",
        label: t("game.play"),
        icon: <PlayIcon style={{ width: 12, height: 12 }} />,
        onSelect: handleLaunch,
      };
    } else if (isPaused) {
      primary = {
        tone: "resume",
        label: t("downloadRow.resume"),
        icon: <PlayIcon style={{ width: 12, height: 12 }} />,
        onSelect: () => onResume(download.id),
      };
    } else if (isSeeding) {
      primary = {
        tone: "stop",
        label: t("downloadRow.stopSeeding"),
        icon: <PauseIcon style={{ width: 12, height: 12 }} />,
        onSelect: handleStopSeeding,
      };
    } else if (isError) {
      primary = {
        tone: "retry",
        label: t("downloadRow.retry"),
        icon: <RotateCcw size={13} />,
        onSelect: handleRetry,
      };
    } else if (isActiveStatus(status)) {
      primary = {
        tone: "pause",
        label: t("downloadRow.pause"),
        icon: <PauseIcon style={{ width: 12, height: 12 }} />,
        onSelect: () => onPause(download.id),
      };
    }

    const openMenuFromButton = (e: React.MouseEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      downloadMenu.openAt(rect.right - 6, rect.bottom + 4);
    };

    return (
      <div
        className={`dl-card dlc-card${selected ? " dl-card--selected" : ""}${
          isError ? " dl-card--error" : ""
        }${isCompleted ? " dl-card--completed" : ""}`}
        onContextMenu={(e) => downloadMenu.open(e)}
      >
        {/* Artwork Media Header */}
        <div className="dl-card-media">
          {artworkUrl ? (
            <img src={artworkUrl} alt={displayName} className="dl-card-img" loading="lazy" decoding="async" />
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
                aria-label={`Select ${displayName}`}
              />
            </div>
          )}

          {/* Status Tag */}
          <span
            className={`dl-card-status dl-row-status--${getStatusClassSuffix(status)}`}
          >
            {getStatusLabel(status, t)}
          </span>

          {/* Source Tag */}
          <span className="dl-card-source-tag">{download.sourceName}</span>

          {/* Debrid Cached Tag */}
          {download.kind === "debrid" && download.debridCached && (
            <span className="dl-card-cached-tag">{t("downloadRow.badgeCached")}</span>
          )}
        </div>

        {/* Card Body */}
        <div className="dl-card-body">
          <h4 className="dl-card-title" title={displayName}>
            {displayName}
          </h4>

          {/* Progress Bar & Percentage */}
          <div className="dl-card-progress-section">
            <div className="dl-card-bar">
              <div
                className="dl-card-bar-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, (download.progress ?? 0) * 100))}%`,
                }}
              />
            </div>
            <div className="dl-card-progress-meta">
              <span className="dl-card-pct">{formatProgress(download.progress)}</span>
              <span className="dl-card-size">
                {formatBytesShort(download.downloaded, sizeUnit)}
                {download.totalSize != null && ` / ${formatBytesShort(download.totalSize, sizeUnit)}`}
              </span>
            </div>
          </div>

          {/* Live Telemetry / Swarm Stats */}
          <div className="dl-card-telemetry">
            {isActiveStatus(status) && download.downloadSpeed > 0 ? (
              <div className="dl-card-speed dl-card-speed--dl">
                ↓ {formatBytesPerSecond(download.downloadSpeed, speedUnit)}
              </div>
            ) : isSeeding && download.uploadSpeed > 0 ? (
              <div className="dl-card-speed dl-card-speed--ul">
                ↑ {formatBytesPerSecond(download.uploadSpeed, speedUnit)}
              </div>
            ) : (
              <div className="dl-card-speed dl-card-speed--muted">
                {isPaused ? t("download.status.paused") : isCompleted ? t("downloadRow.done") : "—"}
              </div>
            )}

            {isActiveStatus(status) && download.downloadSpeed > 0 && download.totalSize != null && (
              <div className="dl-card-eta">
                ⏱ {formatEta(download.downloaded, download.totalSize, download.downloadSpeed, t)}
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
              <span className="dl-row-activity-dot" aria-hidden="true" />
              <span>{activity}</span>
            </div>
          )}

          {isError && errorMessage && (
            <div className="dl-card-error" role="alert">
              {errorMessage}
            </div>
          )}

          {/* Card Action Controls */}
          <div className="dlc-actions">
            {primary && (
              <button
                type="button"
                className={`dlc-primary dlc-primary--${primary.tone}`}
                onClick={primary.onSelect}
                title={primary.label}
              >
                {primary.icon}
                <span>{primary.label}</span>
              </button>
            )}

            <button
              type="button"
              className="dlc-more"
              onClick={openMenuFromButton}
              title={t("downloads.rowActions")}
              aria-label={t("downloads.rowActions")}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
        </div>

        {downloadMenu.state && (
          <ContextMenu
            x={downloadMenu.state.x}
            y={downloadMenu.state.y}
            items={downloadMenuItems}
            onClose={downloadMenu.close}
            ariaLabel={displayName}
            header={
              <>
                <span className="context-menu-title" title={displayName}>
                  {displayName}
                </span>
                <span className="ctx-badge">{getStatusLabel(download.status, t)}</span>
              </>
            }
          />
        )}
      </div>
    );
  },
);

DownloadGridCard.displayName = "DownloadGridCard";
