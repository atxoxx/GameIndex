import { useLanguage } from "../../context/LanguageContext";
import type { GameMod } from "../../types/mods";

export type FilterTab = "all" | "enabled" | "disabled" | "updates" | "conflicts";

function formatModSize(bytes?: number): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

interface ModsHeroStatsProps {
  mods: GameMod[];
  activeFilter: FilterTab;
  onFilterChange: (filter: FilterTab) => void;
  conflictCount: number;
}

export default function ModsHeroStats({
  mods,
  activeFilter,
  onFilterChange,
  conflictCount,
}: ModsHeroStatsProps) {
  const { t } = useLanguage();

  if (mods.length === 0) return null;

  const enabledCount = mods.filter((m) => m.enabled).length;
  const updateCount = mods.filter((m) => m.updateAvailable).length;
  const totalBytes = mods.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0);
  const activePercentage = mods.length > 0 ? Math.round((enabledCount / mods.length) * 100) : 0;

  return (
    <div className="mods-stats-bar" role="region" aria-label={t("mods.eyebrow")}>
      {/* Total Mods */}
      <button
        type="button"
        className={`mods-stat-card ${activeFilter === "all" ? "is-active" : ""}`}
        onClick={() => onFilterChange("all")}
        title={t("mods.filter.all")}
      >
        <span className="mods-stat-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        </span>
        <span className="mods-stat-body">
          <span className="mods-stat-card-label">{t("mods.stats.total")}</span>
          <span className="mods-stat-card-value">{mods.length}</span>
        </span>
      </button>

      {/* Active Mods */}
      <button
        type="button"
        className={`mods-stat-card accent-active ${activeFilter === "enabled" ? "is-active" : ""}`}
        onClick={() => onFilterChange("enabled")}
        title={t("mods.filter.enabled")}
      >
        <span className="mods-stat-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <span className="mods-stat-body">
          <span className="mods-stat-card-label">{t("mods.stats.active")}</span>
          <span className="mods-stat-card-value">
            {enabledCount}
            <span className="mods-stat-card-sub">/ {mods.length}</span>
          </span>
          <span className="mods-stat-progress-track">
            <span
              className="mods-stat-progress-fill"
              style={{ width: `${activePercentage}%` }}
            />
          </span>
        </span>
      </button>

      {/* Updates Available */}
      <button
        type="button"
        className={`mods-stat-card ${updateCount > 0 ? "accent-update has-updates" : ""} ${activeFilter === "updates" ? "is-active" : ""}`}
        onClick={() => onFilterChange("updates")}
        title={t("mods.filter.updates")}
      >
        <span className="mods-stat-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
            <path d="M12 9v12" />
          </svg>
        </span>
        <span className="mods-stat-body">
          <span className="mods-stat-card-label">{t("mods.stats.updates")}</span>
          <span className="mods-stat-card-value">
            {updateCount}
            {updateCount > 0 && <span className="mods-stat-pulse-dot" />}
          </span>
        </span>
      </button>

      {/* Total Storage Footprint */}
      <div className="mods-stat-card mods-stat-card--static">
        <span className="mods-stat-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </span>
        <span className="mods-stat-body">
          <span className="mods-stat-card-label">{t("mods.stats.storage")}</span>
          <span className="mods-stat-card-value mods-stat-card-value--compact">
            {formatModSize(totalBytes)}
          </span>
        </span>
      </div>

      {/* Conflicts Count */}
      {conflictCount > 0 && (
        <button
          type="button"
          className={`mods-stat-card accent-conflict ${activeFilter === "conflicts" ? "is-active" : ""}`}
          onClick={() => onFilterChange("conflicts")}
          title={t("mods.filter.conflicts")}
        >
          <span className="mods-stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <span className="mods-stat-body">
            <span className="mods-stat-card-label">{t("mods.stats.conflicts")}</span>
            <span className="mods-stat-card-value">{conflictCount}</span>
          </span>
        </button>
      )}
    </div>
  );
}
