import { useMemo } from "react";
import type { Game } from "../../types/game";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import {
  driveBuckets,
  platformBuckets,
  sizeCoverage,
  totalBytesWithMods,
  getLargestGame,
  getStorageHealth,
} from "./utils";
import { useDriveUsage } from "./useDriveUsage";

interface Props {
  games: Game[];
  staleCount?: number;
  activeDrive?: string | null;
  onDriveClick?: (label: string) => void;
  onNavigateToCleanup?: () => void;
  onSelectGame?: (game: Game) => void;
}

export function StorageHeroDashboard({
  games,
  staleCount = 0,
  activeDrive = null,
  onDriveClick,
  onNavigateToCleanup,
  onSelectGame,
}: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();

  const total = useMemo(() => totalBytesWithMods(games), [games]);
  const coverage = useMemo(() => sizeCoverage(games), [games]);
  const platforms = useMemo(() => platformBuckets(games), [games]);
  const drives = useMemo(() => driveBuckets(games), [games]);
  const driveUsage = useDriveUsage(games);
  const largestGame = useMemo(() => getLargestGame(games), [games]);

  // Aggregate stats across all detected drives
  const aggregateDriveStats = useMemo(() => {
    let totalCap = 0;
    let totalAvail = 0;
    for (const [, usage] of driveUsage) {
      totalCap += usage.total;
      totalAvail += usage.available;
    }
    const used = totalCap > 0 ? totalCap - totalAvail : 0;
    const freePct = totalCap > 0 ? (totalAvail / totalCap) * 100 : 0;
    return { totalCap, totalAvail, used, freePct };
  }, [driveUsage]);

  // Total mods footprint across all games
  const totalModsBytes = useMemo(() => {
    return games.reduce((acc, g) => acc + (g.modsSizeBytes ?? 0), 0);
  }, [games]);

  const sizedPct = games.length > 0 ? (coverage.sized / games.length) * 100 : 0;
  const avgGameSize = coverage.sized > 0 ? Math.round(total / coverage.sized) : 0;

  const staleMap = useMemo(() => {
    const m = new Map<string, boolean>();
    return m;
  }, []);

  const health = useMemo(() => {
    return getStorageHealth(games, staleMap);
  }, [games, staleMap]);

  return (
    <section className="storage-dashboard" aria-label={t("storageHeader.overview")}>
      {/* ── Top KPI Stat Grid ─────────────────────────────────────────── */}
      <div className="storage-kpi-grid">
        {/* KPI 1: Total Library Footprint */}
        <div className="storage-kpi-card storage-kpi-card--primary">
          <div className="storage-kpi-head">
            <span className="storage-kpi-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
            </span>
            <span className="storage-kpi-label">{t("storage.kpi.totalTracked")}</span>
          </div>
          <div className="storage-kpi-value">{formatSize(total, unit)}</div>
          <div className="storage-kpi-meta">
            <span>
              {t("storageHeader.sizedGames", { count: coverage.sized, plural: coverage.sized === 1 ? "" : "s" })}
            </span>
            {coverage.unsized > 0 && (
              <span className="storage-kpi-badge storage-kpi-badge--warning">
                {t("storageHeader.missingCount", { count: coverage.unsized, plural: coverage.unsized === 1 ? "" : "s" })}
              </span>
            )}
          </div>
          {/* Library coverage mini bar */}
          <div className="storage-coverage-bar" title={`${sizedPct.toFixed(0)}% sized`}>
            <div className="storage-coverage-track">
              <div className="storage-coverage-fill" style={{ width: `${sizedPct}%` }} />
            </div>
            <span className="storage-coverage-label">
              {t("storage.kpi.avgSize", { size: formatSize(avgGameSize, unit) })}
            </span>
          </div>
        </div>

        {/* KPI 2: Total Drive Space & Free Capacity */}
        <div className="storage-kpi-card">
          <div className="storage-kpi-head">
            <span className="storage-kpi-icon storage-kpi-icon--drive" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            </span>
            <span className="storage-kpi-label">{t("storage.kpi.freeSpace")}</span>
          </div>
          <div className="storage-kpi-value">
            {aggregateDriveStats.totalCap > 0
              ? formatSize(aggregateDriveStats.totalAvail, unit)
              : "—"}
          </div>
          <div className="storage-kpi-meta">
            {aggregateDriveStats.totalCap > 0 ? (
              <>
                <span>
                  {t("storageHeader.usedOf", {
                    used: formatSize(aggregateDriveStats.used, unit),
                    total: formatSize(aggregateDriveStats.totalCap, unit),
                  })}
                </span>
                {aggregateDriveStats.freePct < 15 && (
                  <span className="storage-kpi-badge storage-kpi-badge--danger">
                    {t("storage.drive.lowSpaceWarning")}
                  </span>
                )}
              </>
            ) : (
              <span>{t("storage.drive.allDrives")}</span>
            )}
          </div>
          {/* Drive capacity mini bar */}
          {aggregateDriveStats.totalCap > 0 && (
            <div className="storage-coverage-bar">
              <div className="storage-coverage-track">
                <div
                  className={`storage-coverage-fill ${aggregateDriveStats.freePct < 15 ? "storage-coverage-fill--danger" : "storage-coverage-fill--info"}`}
                  style={{
                    width: `${Math.min(100, Math.max(0, 100 - aggregateDriveStats.freePct))}%`,
                  }}
                />
              </div>
              <span className="storage-coverage-label">
                {`${(100 - aggregateDriveStats.freePct).toFixed(0)}% used overall`}
              </span>
            </div>
          )}
        </div>

        {/* KPI 3: Largest Game Space Hog */}
        {largestGame ? (
          <div
            className="storage-kpi-card storage-kpi-card--interactive"
            onClick={() => onSelectGame?.(largestGame)}
            role="button"
            tabIndex={0}
            title={largestGame.name}
          >
            <div className="storage-kpi-head">
              <span className="storage-kpi-icon storage-kpi-icon--game" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01" />
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                </svg>
              </span>
              <span className="storage-kpi-label">{t("storage.kpi.largestGame")}</span>
            </div>
            <div className="storage-kpi-game-preview">
              {largestGame.coverArtUrl || largestGame.iconUrl ? (
                <img
                  src={largestGame.coverArtUrl || largestGame.iconUrl}
                  alt=""
                  className="storage-kpi-game-thumb"
                  loading="lazy"
                />
              ) : (
                <div className="storage-kpi-game-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
              )}
              <div className="storage-kpi-game-info">
                <span className="storage-kpi-game-title">{largestGame.name}</span>
                <span className="storage-kpi-game-size">
                  {formatSize(totalBytesWithMods([largestGame]), unit)}
                </span>
              </div>
            </div>
            <div className="storage-kpi-meta">
              <span>{largestGame.platform || "PC"}</span>
              {total > 0 && (
                <span className="storage-kpi-badge">
                  {t("storage.cleanup.shareOfLibrary", {
                    pct: Math.round((totalBytesWithMods([largestGame]) / total) * 100),
                  })}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="storage-kpi-card">
            <div className="storage-kpi-head">
              <span className="storage-kpi-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </span>
              <span className="storage-kpi-label">{t("storage.kpi.modsTotal")}</span>
            </div>
            <div className="storage-kpi-value">{formatSize(totalModsBytes, unit)}</div>
            <div className="storage-kpi-meta">
              <span>{t("storageRow.mods.label")}</span>
            </div>
          </div>
        )}

        {/* KPI 4: Storage Health / Cleanup Opportunity */}
        <div
          className={`storage-kpi-card storage-kpi-card--interactive ${
            staleCount > 0 ? "storage-kpi-card--alert" : ""
          }`}
          onClick={() => onNavigateToCleanup?.()}
          role="button"
          tabIndex={0}
        >
          <div className="storage-kpi-head">
            <span
              className={`storage-kpi-icon ${
                staleCount > 0 ? "storage-kpi-icon--stale" : "storage-kpi-icon--health"
              }`}
              aria-hidden="true"
            >
              {staleCount > 0 ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              )}
            </span>
            <span className="storage-kpi-label">{t("storage.kpi.healthScore")}</span>
          </div>
          <div className="storage-kpi-value">
            {staleCount > 0
              ? t("storage.kpi.staleAlert")
              : `${health.score}%`}
          </div>
          <div className="storage-kpi-meta">
            {staleCount > 0 ? (
              <span className="storage-kpi-badge storage-kpi-badge--danger">
                {t("storageHeader.staleCount", { count: staleCount })}
              </span>
            ) : coverage.unsized > 0 ? (
              <span className="storage-kpi-badge storage-kpi-badge--warning">
                {t("storageHeader.missingCount", { count: coverage.unsized, plural: coverage.unsized === 1 ? "" : "s" })}
              </span>
            ) : (
              <span className="storage-kpi-badge storage-kpi-badge--success">
                {t("storage.cleanup.allHealthy")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Multi-Drive Partition Cards & Visualizer ──────────────────── */}
      {drives.length > 0 && (
        <div className="storage-drives-section">
          <div className="storage-drives-header">
            <div className="storage-drives-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
              <span>{t("storageHeader.byDrive")}</span>
            </div>
            <span className="storage-drives-hint">{t("storageHeader.filterHint")}</span>
          </div>

          <div className="storage-drives-grid">
            {drives.map((d) => {
              const u = driveUsage.get(d.label);
              const isActive = activeDrive === d.label;
              const hasUsage = u && u.total > 0;

              // Calculate partition breakdown percentages
              const libraryBytes = d.bytes;
              const libraryPct = hasUsage ? (libraryBytes / u.total) * 100 : 0;
              const freeBytes = hasUsage ? u.available : 0;
              const freePct = hasUsage ? (freeBytes / u.total) * 100 : 0;
              const otherBytes = hasUsage ? Math.max(0, u.total - u.available - libraryBytes) : 0;
              const otherPct = hasUsage ? Math.max(0, 100 - freePct - libraryPct) : 0;
              const isLowSpace = hasUsage && freePct < 15;

              return (
                <div
                  key={d.label}
                  className={`storage-drive-card ${isActive ? "storage-drive-card--active" : ""} ${
                    isLowSpace ? "storage-drive-card--low-space" : ""
                  }`}
                  onClick={() => onDriveClick?.(d.label)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onDriveClick?.(d.label);
                    }
                  }}
                  title={t("storageHeader.filterBy", { label: d.label })}
                >
                  <div className="storage-drive-top">
                    <div className="storage-drive-identity">
                      <span className="storage-drive-letter">{d.label}</span>
                      <span className="storage-drive-count">
                        {t("storageHeader.gameCount", { count: d.count, plural: d.count === 1 ? "" : "s" })}
                      </span>
                    </div>
                    <div className="storage-drive-stats">
                      <span className="storage-drive-lib-size">{formatSize(d.bytes, unit)}</span>
                      {hasUsage && (
                        <span className="storage-drive-free-size">
                          {formatSize(u.available, unit)} free
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Multi-segment capacity progress bar */}
                  {hasUsage ? (
                    <div className="storage-drive-progress-container">
                      <div className="storage-drive-multibar">
                        {/* Segment 1: Library Games */}
                        <div
                          className="storage-drive-seg storage-drive-seg--library"
                          style={{ width: `${libraryPct.toFixed(1)}%` }}
                          title={`Library: ${formatSize(libraryBytes, unit)} (${libraryPct.toFixed(1)}%)`}
                        />
                        {/* Segment 2: Other Files & System */}
                        <div
                          className="storage-drive-seg storage-drive-seg--other"
                          style={{ width: `${otherPct.toFixed(1)}%` }}
                          title={`Other: ${formatSize(otherBytes, unit)} (${otherPct.toFixed(1)}%)`}
                        />
                        {/* Segment 3: Free space (remaining track) */}
                      </div>
                      <div className="storage-drive-legend">
                        <span className="storage-drive-legend-item">
                          <i className="storage-drive-dot storage-drive-dot--library" aria-hidden="true" />
                          {t("storage.drive.libraryShare", { pct: Math.round(libraryPct) })}
                        </span>
                        {isLowSpace && (
                          <span className="storage-drive-legend-warning">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            {t("storage.drive.lowSpaceWarning")}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="storage-drive-progress-container">
                      <div className="storage-drive-simplebar">
                        <div
                          className="storage-drive-simplefill"
                          style={{ width: `${total > 0 ? (d.bytes / total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {isActive && (
                    <div className="storage-drive-active-indicator" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Platform Distribution Strip ──────────────────────────────── */}
      {platforms.length > 1 && (
        <div className="storage-platform-strip">
          <div className="storage-platform-title">{t("storageHeader.byPlatform")}</div>
          <div className="storage-platform-chips">
            {platforms.map((p) => {
              const pct = total > 0 ? Math.round((p.bytes / total) * 100) : 0;
              return (
                <div key={p.label} className="storage-platform-chip">
                  <span className="storage-platform-chip-name">{p.label}</span>
                  <span className="storage-platform-chip-size">{formatSize(p.bytes, unit)}</span>
                  <span className="storage-platform-chip-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
