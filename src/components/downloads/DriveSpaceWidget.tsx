import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDownloads } from "../../context/DownloadContext";
import { formatBytesShort, isActiveStatus } from "../../types/download";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";

interface DiskUsageResult {
  total: number;
  free: number;
  available: number;
}

export default function DriveSpaceWidget() {
  const { downloads, defaultDownloadPath } = useDownloads();
  const { unit } = useSizeUnit();
  const { t } = useLanguage();
  const [diskStats, setDiskStats] = useState<DiskUsageResult | null>(null);
  const [targetPath, setTargetPath] = useState<string>("C:/");

  useEffect(() => {
    // Resolve current default download folder or first active download save path
    const configured = defaultDownloadPath;
    const activeWithSave = downloads.find((d) => d.savePath)?.savePath;
    const path = configured || activeWithSave || "C:/";
    setTargetPath(path);

    let cancelled = false;
    invoke<DiskUsageResult>("disk_usage", { path })
      .then((res) => {
        if (!cancelled && res && res.total > 0) {
          setDiskStats(res);
        }
      })
      .catch(() => {
        // Fallback drive query
        invoke<DiskUsageResult>("disk_usage", { path: "C:/" })
          .then((res) => {
            if (!cancelled && res && res.total > 0) {
              setDiskStats(res);
            }
          })
          .catch(() => {});
      });

    return () => {
      cancelled = true;
    };
  }, [downloads, defaultDownloadPath]);

  // Compute total size required by active/queued downloads that are not finished
  const queueRequiredBytes = downloads.reduce((acc, d) => {
    if (isActiveStatus(d.status) && d.totalSize && d.totalSize > d.downloaded) {
      return acc + (d.totalSize - d.downloaded);
    }
    return acc;
  }, 0);

  if (!diskStats) return null;

  const usedBytes = diskStats.total - diskStats.free;
  const usedPercent = Math.min(100, Math.max(0, (usedBytes / diskStats.total) * 100));
  const isLowSpace = diskStats.free < 10 * 1024 * 1024 * 1024; // < 10GB
  const isQueueExceeding = queueRequiredBytes > diskStats.free;

  // Extract drive letter / label
  let driveLabel = targetPath;
  try {
    const match = targetPath.match(/^([A-Za-z]:)/);
    if (match) driveLabel = match[1];
    else if (targetPath.startsWith("/")) {
      const parts = targetPath.split("/").filter(Boolean);
      driveLabel = parts.length > 0 ? `/${parts[0]}` : "/";
    }
  } catch {}

  return (
    <div className={`dl-drive-widget${isLowSpace || isQueueExceeding ? " dl-drive-widget--warning" : ""}`}>
      <div className="dl-drive-header">
        <div className="dl-drive-info">
          <span className="dl-drive-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
              <line x1="22" y1="12" x2="2" y2="12" />
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              <line x1="6" y1="16" x2="6.01" y2="16" />
              <line x1="10" y1="16" x2="10.01" y2="16" />
            </svg>
          </span>
          <span className="dl-drive-name">{driveLabel}</span>
          <span className="dl-drive-free">
            {formatBytesShort(diskStats.free, unit)} {t("downloads.driveFree")}
          </span>
        </div>
        <div className="dl-drive-meta">
          {queueRequiredBytes > 0 && (
            <span className={`dl-drive-queue-tag${isQueueExceeding ? " exceed" : ""}`} title={t("downloads.driveRequired")}>
              {t("downloads.driveRequired")}: {formatBytesShort(queueRequiredBytes, unit)}
            </span>
          )}
          <span className="dl-drive-total">
            / {formatBytesShort(diskStats.total, unit)}
          </span>
        </div>
      </div>

      <div className="dl-drive-bar">
        <div
          className={`dl-drive-bar-fill${usedPercent > 90 || isQueueExceeding ? " danger" : usedPercent > 75 ? " warning" : ""}`}
          style={{ width: `${usedPercent}%` }}
        />
        {queueRequiredBytes > 0 && !isQueueExceeding && (
          <div
            className="dl-drive-bar-queue"
            style={{
              left: `${usedPercent}%`,
              width: `${Math.min(100 - usedPercent, (queueRequiredBytes / diskStats.total) * 100)}%`,
            }}
            title={`${t("downloads.driveRequired")}: ${formatBytesShort(queueRequiredBytes, unit)}`}
          />
        )}
      </div>

      {isQueueExceeding && (
        <div className="dl-drive-alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{t("downloads.driveLowWarning")}</span>
        </div>
      )}
    </div>
  );
}
