import { useState, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { useDownloads } from "../../context/DownloadContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useSpeedUnit } from "../../hooks/useSpeedUnit";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatBytesPerSecond, formatBytesShort } from "../../types/download";
import { PlayIcon, PauseIcon, SlidersIcon, StatsBarIcon } from "./DownloadIcons";
import DriveSpaceWidget from "./DriveSpaceWidget";
import SpeedLimiterModal from "./SpeedLimiterModal";

interface BandwidthHeroProps {
  onOpenStats?: () => void;
}

type BandBusy = "pause" | "resume" | "retry" | null;

/**
 * The downloads control band: the live transfer rates, the destination disk
 * and the transfer-wide controls in one slim strip. It replaces the tall
 * metric dashboard — the numbers are the same, but the band reads as a
 * status bar for the queue rather than a second page header.
 */
export default function BandwidthHero({ onOpenStats }: BandwidthHeroProps) {
  const { activeDownloads, downloads, speedLimits, pauseAll, resumeAll, retryAllFailed } =
    useDownloads();
  const { unit: sizeUnit } = useSizeUnit();
  const { unit: speedUnit } = useSpeedUnit();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const totalDownloadSpeed = activeDownloads.reduce((acc, d) => acc + (d.downloadSpeed || 0), 0);
  const totalUploadSpeed = activeDownloads.reduce((acc, d) => acc + (d.uploadSpeed || 0), 0);
  const errorCount = downloads.filter((d) => d.status.kind === "error").length;

  const [peakDown, setPeakDown] = useState(0);
  const [peakUp, setPeakUp] = useState(0);
  const [sessionDown, setSessionDown] = useState(0);
  const [speedModalOpen, setSpeedModalOpen] = useState(false);
  const [busy, setBusy] = useState<BandBusy>(null);

  useEffect(() => {
    if (totalDownloadSpeed > peakDown) {
      setPeakDown(totalDownloadSpeed);
    }
    if (totalUploadSpeed > peakUp) {
      setPeakUp(totalUploadSpeed);
    }

    if (totalDownloadSpeed > 0) {
      setSessionDown((prev) => prev + totalDownloadSpeed);
    }
  }, [totalDownloadSpeed, totalUploadSpeed, peakDown, peakUp]);

  const isDownloading = totalDownloadSpeed > 0;
  const isUploading = totalUploadSpeed > 0;

  const isThrottled =
    (speedLimits.downloadEnabled && speedLimits.downloadValue > 0) ||
    (speedLimits.uploadEnabled && speedLimits.uploadValue > 0) ||
    speedLimits.disableUpload;

  async function handlePauseAll() {
    if (busy) return;
    setBusy("pause");
    try {
      const n = await pauseAll();
      showToast(
        n > 0
          ? t("downloadsToolbar.paused", { count: n, s: n !== 1 ? "s" : "" })
          : t("downloadsToolbar.nothingToPause"),
        "info",
      );
    } catch (err) {
      showToast(t("downloadsToolbar.pauseAllFailed", { error: String(err) }), "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleResumeAll() {
    if (busy) return;
    setBusy("resume");
    try {
      const n = await resumeAll();
      showToast(
        n > 0
          ? t("downloadsToolbar.resumed", { count: n, s: n !== 1 ? "s" : "" })
          : t("downloadsToolbar.nothingToResume"),
        "info",
      );
    } catch (err) {
      showToast(t("downloadsToolbar.resumeAllFailed", { error: String(err) }), "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleRetryAll() {
    if (busy) return;
    setBusy("retry");
    try {
      const n = await retryAllFailed();
      showToast(
        n > 0 ? t("downloadsToolbar.retrying", { count: n }) : t("downloadsToolbar.nothingToRetry"),
        "info",
      );
    } catch (err) {
      showToast(t("downloadsToolbar.retryFailed", { error: String(err) }), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="dlh" role="region" aria-label={t("downloads.bandwidthDashboard")}>
      <div className="dlh-rates">
        <div className="dlh-rate dlh-rate--down">
          <span className="dlh-rate-label">
            <span className={`dlh-dot dlh-dot--down${isDownloading ? " is-live" : ""}`} />
            {t("downloads.downloadSpeed")}
          </span>
          <span className="dlh-rate-value">{formatBytesPerSecond(totalDownloadSpeed, speedUnit)}</span>
          <span className="dlh-rate-sub">
            {peakDown > 0 && (
              <span title={t("downloads.peakSpeed")}>▲ {formatBytesPerSecond(peakDown, speedUnit)}</span>
            )}
            {sessionDown > 0 && (
              <span title={t("downloads.sessionDownloaded")}>
                {formatBytesShort(sessionDown, sizeUnit)}
              </span>
            )}
          </span>
        </div>

        <span className="dlh-divider" aria-hidden="true" />

        <div className="dlh-rate dlh-rate--up">
          <span className="dlh-rate-label">
            <span className={`dlh-dot dlh-dot--up${isUploading ? " is-live" : ""}`} />
            {t("downloads.uploadSpeed")}
          </span>
          <span className="dlh-rate-value">{formatBytesPerSecond(totalUploadSpeed, speedUnit)}</span>
          <span className="dlh-rate-sub">
            {peakUp > 0 && (
              <span title={t("downloads.peakSpeed")}>▲ {formatBytesPerSecond(peakUp, speedUnit)}</span>
            )}
            <span>{isUploading ? t("downloads.liveSwarm") : t("downloads.unlimited")}</span>
          </span>
        </div>
      </div>

      <div className="dlh-drive">
        <DriveSpaceWidget />
      </div>

      <div className="dlh-actions">
        <button
          type="button"
          className="dlh-btn"
          onClick={handlePauseAll}
          disabled={busy !== null || activeDownloads.length === 0}
          title={t("downloadsToolbar.pauseAll")}
          aria-label={t("downloadsToolbar.pauseAll")}
        >
          <PauseIcon style={{ width: 13, height: 13 }} />
        </button>
        <button
          type="button"
          className="dlh-btn"
          onClick={handleResumeAll}
          disabled={busy !== null || activeDownloads.length === 0}
          title={t("downloadsToolbar.resumeAll")}
          aria-label={t("downloadsToolbar.resumeAll")}
        >
          <PlayIcon style={{ width: 13, height: 13 }} />
        </button>
        <button
          type="button"
          className="dlh-btn"
          onClick={handleRetryAll}
          disabled={busy !== null || errorCount === 0}
          title={t("downloadsToolbar.retryAllHint")}
          aria-label={t("downloadsToolbar.retryAll")}
        >
          <RotateCcw size={13} />
          {errorCount > 0 && <span className="dlh-btn-count">{errorCount}</span>}
        </button>

        <span className="dlh-actions-divider" aria-hidden="true" />

        {onOpenStats && (
          <button
            type="button"
            className="dlh-btn dlh-btn--labeled"
            onClick={onOpenStats}
            title={t("downloadStats.title")}
          >
            <StatsBarIcon style={{ width: 13, height: 13 }} />
            <span>{t("downloadStats.buttonLabel")}</span>
          </button>
        )}

        <button
          type="button"
          className={`dlh-btn dlh-btn--labeled${isThrottled ? " is-limited" : ""}`}
          onClick={() => setSpeedModalOpen(true)}
          title={t("downloads.speedLimiterTitle")}
        >
          <SlidersIcon style={{ width: 13, height: 13 }} />
          <span>{t("downloads.speedLimiterTitle")}</span>
          {isThrottled && <span className="dlh-btn-dot" aria-hidden="true" />}
        </button>
      </div>

      <SpeedLimiterModal open={speedModalOpen} onClose={() => setSpeedModalOpen(false)} />
    </div>
  );
}
