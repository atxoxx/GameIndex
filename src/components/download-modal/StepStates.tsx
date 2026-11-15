import type { MatchedDownload } from "../../types/source";
import { resolveSourceUri } from "./helpers";
import { Button, Skeleton } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import { StatePanel } from "./StatePanel";
import "../../styles/download-modal-states.css";

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16" y2="16" />
    </svg>
  );
}

function FailedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function FileListIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SourcesIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}

/** Result-row shaped bones: artwork, two text lines, and a small action block. */
function ResultSkeletons({ rows = 3 }: { rows?: number }) {
  return (
    <div className="dlm-skeleton-list" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div className="dlm-skeleton-row" key={index}>
          <Skeleton shape="rect" width="34px" height="46px" />
          <div className="dlm-skeleton-copy">
            <Skeleton shape="text" width={`${74 - index * 6}%`} height="10px" />
            <Skeleton shape="text" width={`${46 - index * 4}%`} height="8px" />
          </div>
          <Skeleton shape="rect" width="52px" height="22px" />
        </div>
      ))}
    </div>
  );
}

/** File-picker shaped bones: checkbox, file glyph, name, and size. */
function FileSkeletons({ rows = 4 }: { rows?: number }) {
  return (
    <div className="dlm-skeleton-list dlm-skeleton-list--files" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div className="dlm-skeleton-row dlm-skeleton-row--file" key={index}>
          <Skeleton shape="rect" width="16px" height="16px" />
          <Skeleton shape="rect" width="20px" height="20px" />
          <div className="dlm-skeleton-copy">
            <Skeleton shape="text" width={`${68 - index * 8}%`} height="9px" />
          </div>
          <Skeleton shape="text" width="42px" height="8px" />
        </div>
      ))}
    </div>
  );
}

export function CheckingState({
  searchProgress,
}: {
  searchProgress?: {
    completed: number;
    total: number;
    activeSource: string;
    isDone: boolean;
  } | null;
} = {}) {
  const { t } = useLanguage();
  const hasProgress = !!searchProgress && searchProgress.total > 0;
  const percent =
    hasProgress && searchProgress
      ? Math.round((searchProgress.completed / searchProgress.total) * 100)
      : 0;
  const multiSource = !!searchProgress && searchProgress.total > 1;
  const progressLabel = multiSource
    ? t("downloadModal.searchingSources", {
        completed: searchProgress.completed,
        total: searchProgress.total,
      })
    : t("downloadModal.checkingState");

  return (
    <div className="dl-state-screen dlm-state-screen">
      <StatePanel
        tone="accent"
        role="status"
        ariaLive="polite"
        busy
        className="dlm-state-card--searching"
        icon={<SearchIcon />}
        eyebrow={t("downloadModal.stepSearching")}
        title={
          multiSource && searchProgress.activeSource
            ? t("downloadModal.searchingSourceActive", {
                source: searchProgress.activeSource,
                completed: searchProgress.completed,
                total: searchProgress.total,
              })
            : t("downloadModal.checkingState")
        }
        description={t("downloadModal.checkingHint")}
      >
        {multiSource && searchProgress && (
          <div
            className="dlm-state-progress"
            role="progressbar"
            aria-label={progressLabel}
            aria-valuenow={searchProgress.completed}
            aria-valuemin={0}
            aria-valuemax={searchProgress.total}
          >
            <div className="dlm-state-progress-track">
              <div
                className="dlm-state-progress-fill"
                style={{ width: `${Math.max(6, percent)}%` }}
              />
            </div>
            <div className="dlm-state-progress-meta">
              <span>
                {searchProgress.completed} / {searchProgress.total}
                <span className="dlm-state-progress-sep" aria-hidden>
                  ·
                </span>
                {t("downloads.sources")}
              </span>
              <span className="dlm-state-progress-percent">{percent}%</span>
            </div>
          </div>
        )}

        <ResultSkeletons rows={3} />
      </StatePanel>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="dl-state-screen dlm-state-screen">
      <StatePanel
        tone="danger"
        role="alert"
        ariaLive="assertive"
        icon={<FailedIcon />}
        eyebrow={t("downloadModal.stepError")}
        title={t("downloadModal.errorTitle")}
        actions={
          <Button variant="primary" size="sm" onClick={onRetry}>
            {t("downloadModal.retry")}
          </Button>
        }
      >
        <div className="dlm-state-error-box">
          <p className="dlm-state-error-message">{error ?? t("downloadModal.unknownError")}</p>
        </div>
        <p className="dlm-state-hint">{t("downloadModal.addMoreSources")}</p>
      </StatePanel>
    </div>
  );
}

export function FetchingMetadataState({
  variant = "swarm",
  peers = 0,
  seeds = 0,
}: {
  /** Swarm = waiting for P2P metadata; fast = parsing the .torrent or
   *  asking the debrid provider (no peers involved). */
  variant?: "swarm" | "fast";
  peers?: number;
  seeds?: number;
}) {
  const { t } = useLanguage();
  const fast = variant === "fast";
  const hasSwarm = peers > 0;

  return (
    <div className="dl-state-screen dlm-state-screen">
      <StatePanel
        tone="accent"
        role="status"
        ariaLive="polite"
        busy
        className="dlm-state-card--metadata"
        icon={<FileListIcon />}
        eyebrow={t("downloadModal.stepPreparing")}
        title={t("downloadModal.fetchingFileList")}
        description={
          fast
            ? t("downloadModal.fetchingFileListFast")
            : t("downloadModal.fetchingPeersHint")
        }
      >
        {!fast && hasSwarm && (
          <div className="dlm-state-peer-badge" role="status" aria-live="polite">
            <span className="dlm-state-live-dot" aria-hidden />
            {t("downloadModal.connectedPeers", {
              peers,
              s: peers !== 1 ? "s" : "",
              seeds,
              seedPlural: seeds !== 1 ? "s" : "",
            })}
          </div>
        )}

        <FileSkeletons rows={fast ? 3 : 4} />
      </StatePanel>
    </div>
  );
}

export function StartingStatus({
  match,
  elapsedSec,
  peers = 0,
  seeds = 0,
}: {
  match: MatchedDownload | null;
  elapsedSec: number;
  peers?: number;
  seeds?: number;
}) {
  const { t } = useLanguage();
  const uri = resolveSourceUri(match ?? undefined, 0);
  const isHttpFetch = !!uri && /^https?:/i.test(uri);
  const slow = elapsedSec >= 10;
  const label = isHttpFetch
    ? slow
      ? t("downloadModal.slowSource")
      : t("downloadModal.fetchingTorrentFile")
    : t("downloadModal.startingDownload");
  const hasSwarm = peers > 0;

  return (
    <div className="dlm-starting-status" role="status" aria-live="polite" aria-busy="true">
      <span className="dlm-starting-icon" aria-hidden>
        <DownloadIcon />
      </span>

      <div className="dlm-starting-body">
        <span className="dlm-starting-label">{label}</span>
        <span className="dlm-starting-track" aria-hidden>
          <span className="dlm-starting-fill" />
        </span>
      </div>

      {elapsedSec > 0 && (
        <span className="dlm-starting-timer">({elapsedSec}s)</span>
      )}

      {hasSwarm && (
        <span className="dlm-starting-swarm">
          {t("downloadModal.connectedPeers", {
            peers,
            s: peers !== 1 ? "s" : "",
            seeds,
            seedPlural: seeds !== 1 ? "s" : "",
          })}
        </span>
      )}
    </div>
  );
}

/**
 * Finished-with-nothing screen. `no-sources` is for a configuration problem;
 * `no-entries` is for a completed search that returned no usable releases.
 */
export function EmptyState({
  kind,
  onRetry,
  onOpenSources,
}: {
  kind: "no-sources" | "no-entries";
  onRetry?: () => void;
  onOpenSources?: () => void;
}) {
  const { t } = useLanguage();
  const noSources = kind === "no-sources";

  const primaryAction = noSources
    ? onOpenSources
      ? {
          label: t("downloads.openDownloadSourcesAria"),
          onClick: onOpenSources,
        }
      : null
    : onRetry
      ? { label: t("downloadModal.retry"), onClick: onRetry }
      : null;

  const secondaryAction = noSources
    ? onRetry
      ? { label: t("downloadModal.retry"), onClick: onRetry }
      : null
    : onOpenSources
      ? { label: t("downloads.openDownloadSourcesAria"), onClick: onOpenSources }
      : null;

  return (
    <div className="dl-state-screen dlm-state-screen">
      <StatePanel
        tone={noSources ? "warning" : "neutral"}
        role="status"
        ariaLive="polite"
        className="dlm-state-card--empty"
        icon={noSources ? <SourcesIcon /> : <SearchIcon />}
        title={
          noSources
            ? t("downloads.findDownloadSource")
            : t("downloads.noMatchesFound")
        }
        description={t("downloadModal.addMoreSources")}
        actions={
          primaryAction || secondaryAction ? (
            <>
              {primaryAction && (
                <Button variant="primary" size="sm" onClick={primaryAction.onClick}>
                  {primaryAction.label}
                </Button>
              )}
              {secondaryAction && (
                <Button variant="secondary" size="sm" onClick={secondaryAction.onClick}>
                  {secondaryAction.label}
                </Button>
              )}
            </>
          ) : undefined
        }
      />
    </div>
  );
}

