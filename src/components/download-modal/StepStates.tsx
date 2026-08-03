import type { MatchedDownload } from "../../types/source";
import type { DownloadStep } from "./types";
import { resolveSourceUri } from "./helpers";
import { Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";

export function CheckingState() {
  const { t } = useLanguage();
  return (
    <div className="dl-search-loading dl-search-loading--column">
      <div className="spinner-small" />
      <span>{t('downloadModal.checkingState')}</span>
      <p className="dl-fetching-hint">{t('downloadModal.checkingHint')}</p>
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
      <p>{t('downloadModal.errorTitle')}</p>
      <p className="dl-results-empty-hint">{error ?? t('downloadModal.unknownError')}</p>
      <Button variant="primary" size="sm" onClick={onRetry}>
        {t('downloadModal.retry')}
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
  // The temp (list-only) torrent is live in `activeDownloads` while we
  // wait for the file list, so its 2s-polled swarm stats are genuine —
  // show them once any peer has been contacted, as a live status line.
  const hasSwarm = peers > 0;
  return (
    <div className="dl-search-loading dl-search-loading--column">
      <div className="spinner-small" style={{ width: 24, height: 24 }} />
      <span>{t('downloadModal.fetchingFileList')}</span>
      {hasSwarm && (
        <p className="dl-fetching-swarm" role="status" aria-live="polite">
          {t('downloadModal.connectedPeers', {
            peers,
            s: peers !== 1 ? "s" : "",
            seeds,
            seedPlural: seeds !== 1 ? "s" : "",
          })}
        </p>
      )}
      <p className="dl-fetching-hint">
        {t('downloadModal.fetchingPeersHint')}
      </p>
    </div>
  );
}

/**
 * Status line shown while the engine is accepting the new torrent.
 * Distinguishes between a magnet link (resolves essentially instantly
 * in librqbit) and an `http(s)://.torrent` URL (librqbit has to
 * download the torrent file before it can return, which can take
 * several seconds on a slow source server). After 10s we nudge the
 * user with a slightly more concerned label so they know the engine is
 * still waiting on the network — not on us.
 */
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
      ? t('downloadModal.slowSource')
      : t('downloadModal.fetchingTorrentFile')
    : t('downloadModal.startingDownload');
  // Best-effort live swarm: only rendered when the caller found the
  // download in `activeDownloads` with peers > 0.
  const hasSwarm = peers > 0;
  return (
    <p className="dl-starting-status" role="status" aria-live="polite">
      {label}
      {elapsedSec > 0 && <> ({elapsedSec}s)</>}
      {hasSwarm && (
        <span className="dl-starting-swarm">
          {" · "}
          {t('downloadModal.connectedPeers', {
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
