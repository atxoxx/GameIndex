import React, { useState, useMemo } from "react";
import { useSizeUnit } from "../../hooks/useSizeUnit";
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

const DownloadRow = React.memo(({
  download,
  compact = false,
  selected = false,
  onToggleSelect,
  onPause,
  onResume,
  onRemove,
  onDeleteFiles,
}: DownloadRowProps) => {
  const { unit } = useSizeUnit();
  const { games, launchGame } = useGames();
  const {
    updateSelectedFiles,
    updateDirectDownloadUrl,
    openDownloadFolder,
    reorderQueue,
    setSeeding,
    downloads,
  } = useDownloads();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  // Match corresponding game in library for artwork & launch
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

  const handleReorder = async (direction: "up" | "down") => {
    const queued = downloads.filter((d) => d.status.kind === "queued");
    const idx = queued.findIndex((d) => d.id === download.id);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= queued.length) return;
    const reordered = [...queued];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    try {
      await reorderQueue(reordered.map((d) => d.id));
    } catch (err) {
      showToast(t("downloadRow.reorderFailed", { error: String(err) }), "error");
    }
  };

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
  const errorMessage = getStatusError(status);
  const isDirect = download.kind === "direct" || download.kind === "debrid";
  const activity = getActivityMessage(download);
  const isQueued = status.kind === "queued";
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

        {/* Status Pill */}
        <span
          className={`dl-row-status dl-row-status--${getStatusClassSuffix(status)}`}
          title={getStatusLabel(status)}
          aria-label={t("downloadRow.statusLabel", { status: getStatusLabel(status) })}
        >
          {getStatusLabel(status)}
        </span>

        {/* Thumbnail artwork (if available) */}
        {!compact && artworkUrl && (
          <div className="dl-row-thumb" title={matchedGame?.name || download.name}>
            <img src={artworkUrl} alt={download.name} className="dl-row-thumb-img" />
          </div>
        )}

        {/* Main Info & Progress */}
        <div className="dl-row-main">
          <div className="dl-row-name-row">
            <span className="dl-row-name" title={download.name}>
              {download.name}
              {download.kind === "direct" && (
                <span className="dl-row-badge dl-row-badge--direct">{t("downloadRow.badgeDirect")}</span>
              )}
              {download.kind === "debrid" && (
                <span className="dl-row-badge dl-row-badge--debrid">{t("downloadRow.badgeDebrid")}</span>
              )}
              {isSeeding && (
                <span className="dl-row-badge dl-row-badge--seeding">{t("downloadRow.badgeSeeding")}</span>
              )}
            </span>
            <span className="dl-row-source" title={t("downloadRow.sourceTitle", { source: download.sourceName })}>
              {download.sourceName}
            </span>
            {isQueued && (
              <span className="dl-row-queue">
                {t("downloadRow.queuePosition", { pos: (download.queuePosition ?? 0) + 1 })}
              </span>
            )}
          </div>

          <div className="dl-row-progress-row">
            <div className="dl-row-bar">
              <div
                className="dl-row-bar-fill"
                style={{
                  width: indeterminate
                    ? "30%"
                    : `${(download.progress ?? 0) * 100}%`,
                }}
              />
            </div>
            <span className="dl-row-progress">
              {formatProgress(download.progress)}
              {download.totalSize != null ? (
                <span className="dl-row-size">
                  {" · "}
                  {formatBytesShort(download.downloaded, unit)} / {formatBytesShort(download.totalSize, unit)}
                </span>
              ) : (
                download.downloaded > 0 && (
                  <span className="dl-row-size">
                    {" · "}
                    {formatBytesShort(download.downloaded, unit)}
                  </span>
                )
              )}
              {isActiveStatus(status) && download.downloadSpeed > 0 && download.totalSize != null && (
                <span className="dl-row-eta">
                  {" · "}
                  ⏱ {formatEta(download.downloaded, download.totalSize, download.downloadSpeed)}
                </span>
              )}
            </span>
          </div>

          {activity && (
            <div
              className={`dl-row-activity dl-row-activity--${status.kind}${
                isStalledActivity ? " dl-row-activity--stalled" : ""
              }`}
            >
              <span className="dl-row-activity-dot" aria-hidden />
              <span className="dl-row-activity-text">{activity}</span>
            </div>
          )}

          {isError && errorMessage && (
            <div className="dl-row-error" role="alert">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Speed Column */}
        <div className="dl-row-speed">
          {isSeeding && download.uploadSpeed > 0 ? (
            <span className="dl-row-speed-ul" title={t("downloadRow.uploadSpeed")}>
              <span aria-hidden>↑</span>
              {formatBytesPerSecond(download.uploadSpeed, unit)}
            </span>
          ) : isActiveStatus(status) && download.downloadSpeed > 0 ? (
            <>
              <span className="dl-row-speed-dl" title={t("downloadRow.downloadSpeed")}>
                <span aria-hidden>↓</span>
                {formatBytesPerSecond(download.downloadSpeed, unit)}
              </span>
              {download.uploadSpeed > 0 && (
                <span className="dl-row-speed-ul" title={t("downloadRow.uploadSpeed")}>
                  <span aria-hidden>↑</span>
                  {formatBytesPerSecond(download.uploadSpeed, unit)}
                </span>
              )}
            </>
          ) : isPaused ? (
            <span className="dl-row-speed-muted">{t("download.status.paused")}</span>
          ) : isCompleted ? (
            <span className="dl-row-speed-muted">{t("downloadRow.done")}</span>
          ) : (
            <span className="dl-row-speed-muted">—</span>
          )}
        </div>

        {/* Swarm & Health Column */}
        <div className="dl-row-swarm" aria-label={t("downloadRow.swarm")}>
          {download.peers > 0 || download.seeds > 0 ? (
            <>
              <div className="dl-row-swarm-counts">
                <span title={t("downloadRow.peersInSwarm")}>
                  <PeersIcon style={{ width: 11, height: 11 }} />
                  {download.peers}
                </span>
                <span title={t("downloadRow.seeds")} className="dl-row-swarm-seeds">
                  <SeedsIcon style={{ width: 11, height: 11 }} />
                  {download.seeds}
                </span>
              </div>
              <div className={`dl-swarm-health dl-swarm-health--${swarmHealth}`} title={`Swarm health: ${swarmHealth}/4`}>
                <span className="dl-swarm-bar" />
                <span className="dl-swarm-bar" />
                <span className="dl-swarm-bar" />
                <span className="dl-swarm-bar" />
              </div>
            </>
          ) : (
            <span className="dl-row-swarm-muted">—</span>
          )}
        </div>

        {/* Actions Column */}
        <div className="dl-row-actions">
          {isCompleted && matchedGame && matchedGame.installed && (
            <button
              className="dl-row-btn play-btn"
              onClick={handleLaunch}
              title={t("game.play")}
              aria-label={t("game.play")}
            >
              <PlayIcon style={{ width: 12, height: 12 }} />
            </button>
          )}

          {download.kind === "direct" && download.uris && download.uris.length > 1 && (
            <div className="dl-row-mirror-select-wrapper">
              <select
                className="dl-row-mirror-select"
                value={download.sourceUri}
                onChange={async (e) => {
                  try {
                    await updateDirectDownloadUrl(download.id, e.target.value);
                    showToast(t("downloadRow.mirrorUpdated"), "success");
                  } catch (err) {
                    showToast(t("downloadRow.mirrorFailed", { error: String(err) }), "error");
                  }
                }}
                title={t("downloadRow.switchMirror")}
                aria-label={t("downloadRow.switchMirror")}
              >
                {download.uris.map((uri, idx) => {
                  let hoster = t("downloadRow.mirrorLabel", { idx: idx + 1 });
                  try {
                    const parsed = new URL(uri);
                    hoster = parsed.hostname.replace("www.", "");
                  } catch {}
                  return (
                    <option key={idx} value={uri}>
                      {hoster}
                    </option>
                  );
                })}
              </select>
              <span className="dl-row-mirror-select-caret" aria-hidden>▼</span>
            </div>
          )}

          <button
            className="dl-row-btn"
            onClick={async () => {
              try {
                await openDownloadFolder(download.id);
              } catch (err) {
                showToast(t("downloadRow.openFolderFailed", { error: String(err) }), "error");
              }
            }}
            title={t("downloadRow.openFolder")}
            aria-label={t("downloadRow.openFolderLabel")}
          >
            <FolderIcon />
          </button>

          {download.files && download.files.length > 0 && (
            <button
              className={`dl-row-btn ${expanded ? "active" : ""}`}
              onClick={() => setExpanded(!expanded)}
              title={expanded ? t("downloadRow.hideFiles") : t("downloadRow.showFiles")}
              aria-label={expanded ? t("downloadRow.hideFiles") : t("downloadRow.showFiles")}
            >
              <ChevronIcon
                style={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease-out",
                  width: 14,
                  height: 14,
                }}
              />
            </button>
          )}

          {isQueued && (
            <>
              <button
                className="dl-row-btn"
                onClick={() => handleReorder("up")}
                title={t("downloadRow.moveUp")}
                aria-label={t("downloadRow.moveUp")}
              >
                <ChevronIcon style={{ width: 14, height: 14, transform: "rotate(180deg)" }} />
              </button>
              <button
                className="dl-row-btn"
                onClick={() => handleReorder("down")}
                title={t("downloadRow.moveDown")}
                aria-label={t("downloadRow.moveDown")}
              >
                <ChevronIcon style={{ width: 14, height: 14 }} />
              </button>
            </>
          )}

          {(status.kind === "downloading" || status.kind === "fetchingMetadata") && (
            <button
              className="dl-row-btn"
              onClick={() => onPause(download.id)}
              title={t("downloadRow.pause")}
              aria-label={t("downloadRow.pauseDownload")}
            >
              <PauseIcon />
            </button>
          )}

          {isPaused && (
            <button
              className="dl-row-btn"
              onClick={() => onResume(download.id)}
              title={t("downloadRow.resume")}
              aria-label={t("downloadRow.resumeDownload")}
            >
              <PlayIcon />
            </button>
          )}

          {isSeeding && (
            <button
              className="dl-row-btn"
              onClick={async () => {
                try {
                  await setSeeding(download.id, false);
                } catch (err) {
                  showToast(t("downloadRow.reorderFailed", { error: String(err) }), "error");
                }
              }}
              title={t("downloadRow.stopSeeding")}
              aria-label={t("downloadRow.stopSeeding")}
            >
              <PauseIcon />
            </button>
          )}

          <button
            className="dl-row-btn danger"
            onClick={() => onRemove(download.id)}
            title={isCompleted ? t("downloadRow.removeLabel") : t("common.remove")}
            aria-label={t("downloadRow.removeDownload")}
          >
            <RemoveIcon />
          </button>

          <button
            className="dl-row-btn danger-fill"
            onClick={() => onDeleteFiles(download)}
            title={t("downloadRow.deleteFromDisk")}
            aria-label={t("downloadRow.deleteLabel")}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Collapsible Files Drawer */}
      {expanded && download.files && download.files.length > 0 && (
        <div className="dl-row-details">
          <div className="dl-files-list">
            {download.files.map((file, idx) => (
              <div key={idx} className={`dl-file-item${file.selected ? "" : " dl-file-item--skipped"}`}>
                <input
                  type="checkbox"
                  className="dl-file-checkbox"
                  checked={file.selected}
                  disabled={isCompleted}
                  onChange={() => handleToggleFile(idx)}
                  aria-label={
                    file.selected
                      ? t("downloadRow.deselectFile", { name: file.name })
                      : t("downloadRow.selectFile", { name: file.name })
                  }
                  title={file.selected ? t("downloadRow.fileSelected") : t("downloadRow.fileSkipped")}
                />
                <span
                  className={`dl-file-name${file.selected ? "" : " dl-file-name--skipped"}`}
                  title={file.name}
                >
                  {file.name}
                </span>
                <span className="dl-file-size">
                  {formatBytesShort(file.size, unit)}
                </span>
                <div className="dl-file-progress-bar">
                  <div
                    className="dl-file-progress-fill"
                    style={{ width: `${file.progress * 100}%` }}
                  />
                </div>
                <span className="dl-file-percentage">
                  {Math.round(file.progress * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  const a = prevProps.download;
  const b = nextProps.download;

  if (
    prevProps.compact !== nextProps.compact ||
    prevProps.selected !== nextProps.selected ||
    a.id !== b.id ||
    a.name !== b.name ||
    a.downloaded !== b.downloaded ||
    a.totalSize !== b.totalSize ||
    a.progress !== b.progress ||
    a.downloadSpeed !== b.downloadSpeed ||
    a.uploadSpeed !== b.uploadSpeed ||
    a.peers !== b.peers ||
    a.seeds !== b.seeds ||
    a.status.kind !== b.status.kind ||
    a.sourceUri !== b.sourceUri
  ) {
    return false;
  }

  if ((a.queuePosition ?? -1) !== (b.queuePosition ?? -1)) return false;

  if (a.status.kind === "error" && b.status.kind === "error" && a.status.message !== b.status.message) {
    return false;
  }

  if ((a.uris?.length ?? 0) !== (b.uris?.length ?? 0)) return false;
  if (a.uris && b.uris) {
    for (let j = 0; j < a.uris.length; j++) {
      if (a.uris[j] !== b.uris[j]) return false;
    }
  }

  if ((a.files?.length ?? 0) !== (b.files?.length ?? 0)) return false;
  if (a.files && b.files) {
    for (let j = 0; j < a.files.length; j++) {
      const fa = a.files[j];
      const fb = b.files[j];
      if (
        fa.name !== fb.name ||
        fa.selected !== fb.selected ||
        fa.progress !== fb.progress ||
        fa.downloaded !== fb.downloaded
      ) {
        return false;
      }
    }
  }

  return true;
});

DownloadRow.displayName = "DownloadRow";
export default DownloadRow;
