// StorageView — System hub sub-view showing per-drive game storage
// usage: buckets + a usage bar and free/total figures per drive.

import { useMemo } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useGames } from "../../../context/GameContext";
import { useDriveUsage } from "../../../pages/storage/useDriveUsage";
import { useMountVersion } from "../../../pages/storage/mounts";
import { driveBuckets } from "../../../pages/storage/utils";
import { BigScreenEmptyState } from "../BigScreenState";

export default function StorageView() {
  const { t } = useLanguage();
  const { games } = useGames();
  const driveUsage = useDriveUsage(games);
  const mountVersion = useMountVersion();

  const buckets = useMemo(() => driveBuckets(games), [games, mountVersion]);

  return (
    <div className="bigscreen-system-section-view">
      <h3>{t("bigscreen.system.storageBreakdown")}</h3>
      {buckets.length === 0 ? (
        <BigScreenEmptyState message={t("bigscreen.system.noStorage")} />
      ) : (
        <div className="system-storage-list">
          {buckets.map((b) => {
            const usage = driveUsage.get(b.label);
            const totalGb = usage ? (usage.total / (1024 * 1024 * 1024)).toFixed(0) : "0";
            const freeGb = usage ? (usage.free / (1024 * 1024 * 1024)).toFixed(0) : "0";
            const usedGb = usage ? ((usage.total - usage.free) / (1024 * 1024 * 1024)).toFixed(0) : "0";
            const pct = usage ? Math.round(((usage.total - usage.free) / usage.total) * 100) : 0;

            return (
              <div key={b.label} className="system-storage-row">
                <div className="storage-row-header">
                  <span className="drive-label">{b.label}</span>
                  <span className="drive-counts">
                    {t("bigscreen.system.driveCounts", { count: b.count, used: usedGb })}
                  </span>
                </div>
                <div className="dl-progress-bar">
                  <div className="dl-progress-fill storage-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="drive-space-meta">
                  <span>{t("bigscreen.system.storageUsage", { free: freeGb, total: totalGb })}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
