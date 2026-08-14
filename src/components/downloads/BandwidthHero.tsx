import { useState, useEffect } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { formatBytesPerSecond, formatBytesShort } from "../../types/download";
import { SlidersIcon } from "./DownloadIcons";
import DriveSpaceWidget from "./DriveSpaceWidget";
import SpeedLimiterModal from "./SpeedLimiterModal";

export default function BandwidthHero() {
  const { activeDownloads } = useDownloads();
  const { unit } = useSizeUnit();
  const { t } = useLanguage();

  const totalDownloadSpeed = activeDownloads.reduce((acc, d) => acc + (d.downloadSpeed || 0), 0);
  const totalUploadSpeed = activeDownloads.reduce((acc, d) => acc + (d.uploadSpeed || 0), 0);

  const [peakDown, setPeakDown] = useState(0);
  const [peakUp, setPeakUp] = useState(0);
  const [sessionDown, setSessionDown] = useState(0);
  const [speedModalOpen, setSpeedModalOpen] = useState(false);

  // Update session accumulators & peaks
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

  const isThrottled = Boolean(
    localStorage.getItem("gamelib-speed-limit-down") ||
    localStorage.getItem("gamelib-speed-limit-up") ||
    localStorage.getItem("gamelib-disable-upload") === "true"
  );

  return (
    <div className="dl-dashboard-card" role="region" aria-label="Bandwidth Dashboard">
      <div className="dl-hero-grid">
        {/* Download Rate Metric */}
        <div className="dl-hero-metric dl-hero-metric--down">
          <div className="dl-hero-metric-header">
            <span className="dl-hero-label">
              <span className={`dl-hero-dot dl-hero-dot--down${isDownloading ? " pulse" : ""}`} />
              {t("downloads.downloadSpeed")}
            </span>
            {peakDown > 0 && (
              <span className="dl-hero-peak" title={t("downloads.peakSpeed")}>
                ▲ {formatBytesPerSecond(peakDown, unit)}
              </span>
            )}
          </div>
          <div className="dl-hero-value dl-hero-value-down">
            {formatBytesPerSecond(totalDownloadSpeed, unit)}
          </div>
          {sessionDown > 0 && (
            <span className="dl-hero-sub">
              {t("downloads.sessionDownloaded")}: {formatBytesShort(sessionDown, unit)}
            </span>
          )}
        </div>

        <div className="dl-hero-divider" aria-hidden />

        {/* Upload Rate Metric */}
        <div className="dl-hero-metric dl-hero-metric--up">
          <div className="dl-hero-metric-header">
            <span className="dl-hero-label">
              <span className={`dl-hero-dot dl-hero-dot--up${isUploading ? " pulse" : ""}`} />
              {t("downloads.uploadSpeed")}
            </span>
            {peakUp > 0 && (
              <span className="dl-hero-peak" title={t("downloads.peakSpeed")}>
                ▲ {formatBytesPerSecond(peakUp, unit)}
              </span>
            )}
          </div>
          <div className="dl-hero-value dl-hero-value-up">
            {formatBytesPerSecond(totalUploadSpeed, unit)}
          </div>
          <span className="dl-hero-sub">
            {isUploading ? "Live swarm distribution" : t("downloads.unlimited")}
          </span>
        </div>

        <div className="dl-hero-divider" aria-hidden />

        {/* Drive Storage Monitor & Speed Limiter Action */}
        <div className="dl-hero-extra">
          <DriveSpaceWidget />
          <div className="dl-hero-quick-actions">
            <button
              type="button"
              className={`dl-hero-speed-btn${isThrottled ? " limited" : ""}`}
              onClick={() => setSpeedModalOpen(true)}
              title={t("downloads.speedLimiterTitle")}
            >
              <SlidersIcon style={{ width: 14, height: 14 }} />
              <span>{t("downloads.speedLimiterTitle")}</span>
              {isThrottled && <span className="dl-hero-speed-badge">Limits On</span>}
            </button>
          </div>
        </div>
      </div>

      <SpeedLimiterModal open={speedModalOpen} onClose={() => setSpeedModalOpen(false)} />
    </div>
  );
}
