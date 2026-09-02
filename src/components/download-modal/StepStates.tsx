import type { MatchedDownload } from "../../types/source";
import { resolveSourceUri } from "./helpers";
import { Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";

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
  const percent =
    searchProgress && searchProgress.total > 0
      ? Math.round((searchProgress.completed / searchProgress.total) * 100)
      : 0;

  return (
    <div className="dl-state-screen dl-state-screen--checking">
      <div className="dl-scanner-graphic">
        <div className="dl-scanner-orbit" />
        <div className="dl-scanner-pulse" />
        <div className="dl-scanner-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
      </div>

      <div className="dl-state-screen-body">
        <h3 className="dl-state-title">
          {searchProgress && searchProgress.total > 1 && searchProgress.activeSource
            ? t("downloadModal.searchingSourceActive", {
                source: searchProgress.activeSource,
                completed: searchProgress.completed,
                total: searchProgress.total,
              })
            : t("downloadModal.checkingState")}
        </h3>

        {searchProgress && searchProgress.total > 1 && (
          <div className="dl-state-progress-bar">
            <div className="dl-state-progress-track">
              <div
                className="dl-state-progress-fill"
                style={{ width: `${Math.max(6, percent)}%` }}
              />
            </div>
            <div className="dl-state-progress-meta">
              <span>{searchProgress.completed} / {searchProgress.total} sources</span>
              <span>{percent}%</span>
            </div>
          </div>
        )}

        <p className="dl-state-desc">{t("downloadModal.checkingHint")}</p>
      </div>
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
    <div className="dl-state-screen dl-state-screen--error">
      <div className="dl-state-error-icon">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h3 className="dl-state-title">{t("downloadModal.errorTitle")}</h3>
      <p className="dl-state-desc dl-state-desc--error">{error ?? t("downloadModal.unknownError")}</p>
      <Button variant="primary" size="sm" onClick={onRetry}>
        {t("downloadModal.retry")}
      </Button>
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
  const hasSwarm = peers > 0;
  const fast = variant === "fast";

  return (
    <div className="dl-state-screen dl-state-screen--metadata">
      {fast ? (
        <div className="dl-fast-list-indicator" aria-hidden>
          <span className="dl-fast-list-spinner" />
        </div>
      ) : (
        <div className="dl-swarm-radar">
          <div className="dl-swarm-ripple" />
          <div className="dl-swarm-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
        </div>
      )}

      <div className="dl-state-screen-body">
        <h3 className="dl-state-title">{t("downloadModal.fetchingFileList")}</h3>
        {!fast && hasSwarm && (
          <div className="dl-swarm-badge" role="status" aria-live="polite">
            <span className="dl-swarm-pulse-dot" aria-hidden />
            {t("downloadModal.connectedPeers", {
              peers,
              s: peers !== 1 ? "s" : "",
              seeds,
              seedPlural: seeds !== 1 ? "s" : "",
            })}
          </div>
        )}
        <p className="dl-state-desc">
          {fast
            ? t("downloadModal.fetchingFileListFast")
            : t("downloadModal.fetchingPeersHint")}
        </p>
      </div>
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
    <div className="dl-starting-bar" role="status" aria-live="polite">
      <span className="dl-starting-spinner" aria-hidden />
      <span className="dl-starting-label">{label}</span>
      {elapsedSec > 0 && <span className="dl-starting-timer">({elapsedSec}s)</span>}
      {hasSwarm && (
        <span className="dl-starting-swarm-info">
          {" · "}
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
