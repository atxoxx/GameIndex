import type { MatchedDownload } from "../../types/source";
import type { DownloadStep } from "./types";
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
  return (
    <div className="dl-search-loading dl-search-loading--column">
      <div className="dl-spinner" />
      <span className="dl-loading-title">
        {searchProgress && searchProgress.total > 1 && searchProgress.activeSource
          ? t("downloadModal.searchingSourceActive", {
              source: searchProgress.activeSource,
              completed: searchProgress.completed,
              total: searchProgress.total,
            })
          : t("downloadModal.checkingState")}
      </span>
      {searchProgress && searchProgress.total > 1 && (
        <div className="dl-search-progress-bar dl-search-progress-bar--standalone">
          <div className="dl-search-progress-track">
            <div
              className="dl-search-progress-fill"
              style={{
                width: `${Math.max(6, (searchProgress.completed / searchProgress.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
      <p className="dl-fetching-hint">{t("downloadModal.checkingHint")}</p>
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
    <div className="dl-results-empty dl-results-empty--error">
      <div className="dl-results-empty-icon dl-results-empty-icon--error">
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
      <h4 className="dl-results-empty-title">{t("downloadModal.errorTitle")}</h4>
      <p className="dl-results-empty-hint">{error ?? t("downloadModal.unknownError")}</p>
      <Button variant="primary" size="sm" onClick={onRetry}>
        {t("downloadModal.retry")}
      </Button>
    </div>
  );
}

export function FetchingMetadataState({
  peers = 0,
  seeds = 0,
}: {
  peers?: number;
  seeds?: number;
}) {
  const { t } = useLanguage();
  const hasSwarm = peers > 0;
  return (
    <div className="dl-search-loading dl-search-loading--column">
      <div className="dl-spinner" />
      <span className="dl-loading-title">{t("downloadModal.fetchingFileList")}</span>
      {hasSwarm && (
        <p className="dl-fetching-swarm" role="status" aria-live="polite">
          {t("downloadModal.connectedPeers", {
            peers,
            s: peers !== 1 ? "s" : "",
            seeds,
            seedPlural: seeds !== 1 ? "s" : "",
          })}
        </p>
      )}
      <p className="dl-fetching-hint">{t("downloadModal.fetchingPeersHint")}</p>
    </div>
  );
}

export function StartingStatus({
  match,
  selectedMirrorIdx,
  elapsedSec,
  peers = 0,
  seeds = 0,
}: {
  match: MatchedDownload | null;
  selectedMirrorIdx: number;
  elapsedSec: number;
  peers?: number;
  seeds?: number;
}) {
  const { t } = useLanguage();
  const uri = resolveSourceUri(match ?? undefined, selectedMirrorIdx);
  const isHttpFetch = !!uri && /^https?:/i.test(uri);
  const slow = elapsedSec >= 10;
  const label = isHttpFetch
    ? slow
      ? t("downloadModal.slowSource")
      : t("downloadModal.fetchingTorrentFile")
    : t("downloadModal.startingDownload");
  const hasSwarm = peers > 0;

  return (
    <p className="dl-starting-status" role="status" aria-live="polite">
      <span className="dl-spinner-mini" aria-hidden />
      <span>{label}</span>
      {elapsedSec > 0 && <span className="dl-starting-elapsed">({elapsedSec}s)</span>}
      {hasSwarm && (
        <span className="dl-starting-swarm">
          {" · "}
          {t("downloadModal.connectedPeers", {
            peers,
            s: peers !== 1 ? "s" : "",
            seeds,
            seedPlural: seeds !== 1 ? "s" : "",
          })}
        </span>
      )}
    </p>
  );
}

export type { DownloadStep };

