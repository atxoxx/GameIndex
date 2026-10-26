import React, { useState, useMemo, type ReactNode } from "react";
import { Info, MoreHorizontal, RotateCcw } from "lucide-react";
import TorrentDetailModal from "./TorrentDetailModal";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useDownloadCoverArt } from "../../hooks/useDownloadCoverArt";
import { useDownloads } from "../../context/DownloadContext";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import { useDownloadMenuItems } from "./downloadMenu";
import {
  PlayIcon,
  PauseIcon,
  ChevronIcon,
  PeersIcon,
  SeedsIcon,
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
  getDownloadDisplayName,
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

interface PrimaryAction {
  tone: "play" | "pause" | "resume" | "stop" | "retry";
  label: string;
  icon: ReactNode;
  onSelect: () => void;
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
    const { updateSelectedFiles, setSeeding, retryDownload } = useDownloads();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const [expanded, setExpanded] = useState(false);
    const [showDetail, setShowDetail] = useState(false);

    // Resolve game artwork from library or automated metadata search
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
    const isPaused = status.kind === "paused";
    const isCompleted = status.kind === "completed";
    const isError = status.kind === "error";
    const isSeeding = status.kind === "seeding";
    const isDirect = download.kind === "direct" || download.kind === "debrid";
    const isPlayable = isCompleted && matchedGame && matchedGame.installed;

    const menuItems = useMemo<ContextMenuItem[]>(() => {
      if (download.kind !== "torrent") return downloadMenuItems;
      return [
        {
          id: "torrent-details",
          label: t("torrentDetail.open"),
          icon: <Info size={15} />,
          onSelect: () => setShowDetail(true),
        },
        { id: "sep-details", separator: true },
        ...downloadMenuItems,
      ];
    }, [download.kind, downloadMenuItems, t]);

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

    const indeterminate = download.progress == null && isActiveStatus(status);
    const fileSelectionLocked =
      isCompleted || (download.kind === "debrid" && isActiveStatus(status));
    const errorMessage = getStatusError(status);
    const activity = getActivityMessage(download, t);
    const displayName = getDownloadDisplayName(download, t);

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
      "dlrow",
      !onToggleSelect && "dlrow--no-check",
      compact && "dlrow--compact",
      selected && "dlrow--selected",
      isError && "dlrow--error",
      isCompleted && "dlrow--completed",
      isPaused && "dlrow--paused",
      isSeeding && "dlrow--seeding",
      indeterminate && "dlrow--indeterminate",
    ]
      .filter(Boolean)
      .join(" ");

    const handleLaunch = async () => {
      if (!matchedGame) return;
      try {
        await launchGame(matchedGame);
      } catch (err) {
        showToast(t("gameContext.launchFailed", { error: String(err) }), "error");
      }
    };

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

    // One contextual primary per row; everything else lives in the menu.
    let primary: PrimaryAction | null = null;
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

    const eta =
      isActiveStatus(status) && download.downloadSpeed > 0 && download.totalSize != null
        ? formatEta(download.downloaded, download.totalSize, download.downloadSpeed, t)
        : "";

    const openMenuFromButton = (e: React.MouseEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      downloadMenu.openAt(rect.right - 6, rect.bottom + 4);
    };

    return (
      <div className="dlrow-wrap">
        <div className={rowClass} onContextMenu={(e) => downloadMenu.open(e)}>
          {onToggleSelect && (
            <div className="dlrow-check" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(download.id)}
                aria-label={`Select ${displayName}`}
              />
            </div>
          )}

          <div className="dlrow-thumb" title={displayName}>
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={displayName}
                className="dlrow-thumb-img"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="dlrow-thumb-ph">
                <GameFallbackIcon style={{ width: 18, height: 18 }} />
              </div>
            )}
          </div>

          <div className="dlrow-main">
            <div className="dlrow-head">
              <span className="dlrow-name" title={displayName}>
                {displayName}
              </span>

              <span
                className={`dlrow-status dlrow-status--${getStatusClassSuffix(status)}`}
                title={getStatusLabel(status, t)}
              >
                {getStatusLabel(status, t)}
              </span>

              {download.kind === "direct" && (
                <span className="dlrow-badge dlrow-badge--direct">{t("downloadRow.badgeDirect")}</span>
              )}
              {download.kind === "debrid" && (
                <span className="dlrow-badge dlrow-badge--debrid">{t("downloadRow.badgeDebrid")}</span>
              )}
              {download.kind === "debrid" && download.debridCached && (
                <span className="dlrow-badge dlrow-badge--cached">{t("downloadRow.badgeCached")}</span>
              )}

              <span className="dlrow-source" title={t("downloadRow.sourceTitle", { source: download.sourceName })}>
                {download.sourceName}
              </span>
            </div>

            <div className="dlrow-line">
              <div className="dlrow-bar">
                <div
                  className={`dlrow-bar-fill${status.kind === "downloading" ? " is-active" : ""}`}
                  style={{
                    width: indeterminate
                      ? "30%"
                      : `${Math.max(0, Math.min(100, (download.progress ?? 0) * 100))}%`,
                  }}
                />
              </div>
              <span className="dlrow-pct">{formatProgress(download.progress)}</span>
              <span className="dlrow-size">
                {formatBytesShort(download.downloaded, sizeUnit)}
                {download.totalSize != null && ` / ${formatBytesShort(download.totalSize, sizeUnit)}`}
              </span>
            </div>

            {isError && errorMessage ? (
              <div className="dlrow-error" role="alert">
                {errorMessage}
              </div>
            ) : (
              <div className="dlrow-meta">
                {isStalledActivity && activity && (
                  <span className="dlrow-meta-item dlrow-warn">{activity}</span>
                )}

                <span className="dlrow-meta-item dlrow-speed">
                  {isActiveStatus(status) && download.downloadSpeed > 0 ? (
                    <>↓ {formatBytesPerSecond(download.downloadSpeed, speedUnit)}</>
                  ) : isSeeding && download.uploadSpeed > 0 ? (
                    <>↑ {formatBytesPerSecond(download.uploadSpeed, speedUnit)}</>
                  ) : (
                    <span className="dlrow-speed-muted">
                      {isPaused
                        ? t("download.status.paused")
                        : isCompleted
                          ? t("downloadRow.done")
                          : "—"}
                    </span>
                  )}
                  {isActiveStatus(status) && download.uploadSpeed > 0 && (
                    <span className="dlrow-speed-up">
                      ↑ {formatBytesPerSecond(download.uploadSpeed, speedUnit)}
                    </span>
                  )}
                </span>

                {eta && <span className="dlrow-meta-item dlrow-eta">{eta}</span>}

                {isSeeding && (
                  <span className="dlrow-meta-item">
                    {t("downloadRow.seedingUploaded", {
                      size: formatBytesShort(download.uploaded ?? 0, sizeUnit),
                    })}
                  </span>
                )}

                {!isDirect && (download.peers > 0 || download.seeds > 0) && (
                  <span className="dlrow-meta-item dlrow-swarm">
                    <span title={t("downloadRow.peersInSwarm")}>
                      <PeersIcon style={{ width: 11, height: 11 }} />
                      {download.peers}
                    </span>
                    <span title={t("downloadRow.seeds")}>
                      <SeedsIcon style={{ width: 11, height: 11 }} />
                      {download.seeds}
                    </span>
                    {swarmHealth > 0 && (
                      <span
                        className={`dlrow-health dlrow-health--${swarmHealth}`}
                        title={t("downloadRow.swarmHealthTitle")}
                        aria-hidden="true"
                      >
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="dlrow-actions">
            {download.files && download.files.length > 0 && (
              <button
                type="button"
                className={`dlrow-icon dlrow-disclosure${expanded ? " is-open" : ""}`}
                onClick={() => setExpanded(!expanded)}
                title={expanded ? t("downloadRow.hideFiles") : t("downloadRow.showFiles")}
                aria-expanded={expanded}
              >
                <ChevronIcon style={{ width: 13, height: 13 }} />
              </button>
            )}

            {primary && (
              <button
                type="button"
                className={`dlrow-primary dlrow-primary--${primary.tone}`}
                onClick={primary.onSelect}
                title={primary.label}
              >
                {primary.icon}
                <span className="dlrow-primary-label">{primary.label}</span>
              </button>
            )}

            <button
              type="button"
              className="dlrow-icon dlrow-more"
              onClick={openMenuFromButton}
              title={t("downloads.rowActions")}
              aria-label={t("downloads.rowActions")}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
        </div>

        {/* Collapsible Files Selection Drawer */}
        {expanded && download.files && download.files.length > 0 && (
          <div className="dlrow-files">
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
                    <span className="dl-file-size">{formatBytesShort(file.size, sizeUnit)}</span>
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

        {downloadMenu.state && (
          <ContextMenu
            x={downloadMenu.state.x}
            y={downloadMenu.state.y}
            items={menuItems}
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

        {showDetail && download.kind === "torrent" && (
          <TorrentDetailModal download={download} onClose={() => setShowDetail(false)} />
        )}
      </div>
    );
  },
);

DownloadRow.displayName = "DownloadRow";

export default DownloadRow;
