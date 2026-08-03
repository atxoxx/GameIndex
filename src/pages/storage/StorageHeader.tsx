import { useMemo } from "react";
import type { Game, SizeUnit } from "../../types/game";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import {
  driveBuckets,
  platformBuckets,
  sizeCoverage,
  totalBytesWithMods,
  type StorageBucket,
} from "./utils";
import { useDriveUsage } from "./useDriveUsage";

interface Props {
  games: Game[];
  /** Number of sized games whose `sizeRootPath` no longer resolves on
   *  disk. Surfaced in the totals zone meta line so the user can see
   *  the staleness coverage at a glance. */
  staleCount?: number;
  /** The drive label currently filtering the list, if any. The matching
   *  "By drive" row is highlighted so the active filter reads clearly. */
  activeDrive?: string | null;
  /** Click a "By drive" row to filter the Storage list to that volume. */
  onDriveClick?: (label: string) => void;
}

/** Storage dashboard — one unified panel made of three zones:
 *  [ tracked-size totals ] [ by platform ] [ by drive ].
 *
 *  Pure presentational: receives the unsorted games array (the
 *  orchestrator handles sorting) and aggregates internally. The page
 *  title/subtitle are rendered by StoragePage itself.
 *
 *  The drive zone doubles as a filter: each row is a button that
 *  narrows the game list to that volume (`onDriveClick`), so the
 *  active-drive row gets a stronger accent treatment. */
export function StorageHeader({
  games,
  staleCount = 0,
  activeDrive = null,
  onDriveClick,
}: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const total = useMemo(() => totalBytesWithMods(games), [games]);
  const coverage = useMemo(() => sizeCoverage(games), [games]);
  const platforms = useMemo(() => platformBuckets(games), [games]);
  const drives = useMemo(() => driveBuckets(games), [games]);
  const driveUsage = useDriveUsage(games);
  const uncategorized = coverage.unsized;
  const sizedPct = games.length > 0 ? (coverage.sized / games.length) * 100 : 0;

  return (
    <section className="storage__dashboard" aria-label={t("storageHeader.overview")}>
      {/* ── Totals zone ─────────────────────────────────────────── */}
      <div className="storage__dash-zone storage__dash-zone--totals">
        <div className="storage__dash-head">
          <span className="storage__dash-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14a9 3 0 0 0 18 0V5" />
              <path d="M3 12a9 3 0 0 0 18 0" />
            </svg>
          </span>
          <span className="storage__dash-label">{t("storageHeader.trackedSize")}</span>
        </div>
        <div className="storage__dash-value">{formatSize(total, unit)}</div>
        <p className="storage__dash-meta">
          {t("storageHeader.sizedGames", { count: coverage.sized, plural: coverage.sized === 1 ? "" : "s" })}
          {uncategorized > 0 &&
            `  ${"·"}  ${t("storageHeader.missingCount", { count: uncategorized, plural: uncategorized === 1 ? "" : "s" })}`}
        </p>
        {staleCount > 0 && (
          <p className="storage__dash-meta storage__dash-meta--stale">
            <span className="storage__dash-dot" aria-hidden="true" />
            {t("storageHeader.staleCount", { count: staleCount })}
          </p>
        )}

        {/* Coverage bar: sized vs missing share of the tracked library */}
        <div className="storage__coverage">
          <div
            className="storage__coverage-track"
            role="img"
            aria-label={t("storageHeader.sizedGames", { count: coverage.sized, plural: coverage.sized === 1 ? "" : "s" })}
          >
            <span
              className="storage__coverage-fill storage__coverage-fill--sized"
              style={{ width: `${sizedPct.toFixed(1)}%` }}
            />
            <span
              className="storage__coverage-fill storage__coverage-fill--missing"
              style={{ width: `${(100 - sizedPct).toFixed(1)}%` }}
            />
          </div>
          <div className="storage__coverage-legend">
            <span className="storage__coverage-legend-item">
              <i className="storage__coverage-dot storage__coverage-dot--sized" aria-hidden="true" />
              {t("storage.sized")}
            </span>
            <span className="storage__coverage-legend-item">
              <i className="storage__coverage-dot storage__coverage-dot--missing" aria-hidden="true" />
              {t("storage.missing")}
            </span>
          </div>
        </div>
      </div>

      <BreakdownCard
        title={t("storageHeader.byPlatform")}
        buckets={platforms}
        total={total}
        unit={unit}
      />
      <BreakdownCard
        title={t("storageHeader.byDrive")}
        buckets={drives}
        total={total}
        unit={unit}
        usage={driveUsage}
        activeKey={activeDrive}
        onRowClick={onDriveClick}
      />
    </section>
  );
}

/** One breakdown zone. Renders an empty-state row when no sized
 *  games are bucketed into this dimension.
 *
 *  For the "By drive" zone (when `usage` is supplied) each row also
 *  shows a volume-utilization mini-bar beneath the game-bytes bar: how
 *  much of the drive's total capacity the tracked games consume, plus a
 *  "used of total" tooltip. Drives whose capacity query failed simply
 *  omit that sub-row. */
function BreakdownCard({
  title,
  buckets,
  total,
  unit,
  usage,
  activeKey,
  onRowClick,
}: {
  title: string;
  buckets: StorageBucket[];
  total: number;
  unit: SizeUnit;
  /** Optional per-drive capacity map (only the "By drive" zone passes
   *  this). Keyed by the same label `driveBuckets` produces. */
  usage?: Map<string, { total: number; free: number; available: number }>;
  /** Highlighted row label (drive filter is active). */
  activeKey?: string | null;
  /** Click handler for a row (drive filter). Only the "By drive" zone
   *  passes one. */
  onRowClick?: (label: string) => void;
}) {
  const { t } = useLanguage();
  const interactive = !!onRowClick;
  return (
    <div className="storage__dash-zone storage__dash-zone--breakdown">
      <div className="storage__dash-head">
        <span className="storage__dash-label">{title}</span>
        {interactive && (
          <span className="storage__dash-hint">{t("storageHeader.filterHint")}</span>
        )}
      </div>
      {buckets.length === 0 ? (
        <span className="storage__breakdown-empty">{t("storageHeader.noMeasurements")}</span>
      ) : (
        <ul className="storage__breakdown-list">
          {buckets.map((b) => {
            const pct = total > 0 ? (b.bytes / total) * 100 : 0;
            const u = usage?.get(b.label);
            const usedPct =
              u && u.total > 0 ? (b.bytes / u.total) * 100 : 0;
            const isActive = interactive && activeKey === b.label;
            const classes = [
              "storage__breakdown-row",
              interactive ? "storage__breakdown-row--clickable" : "",
              isActive ? "storage__breakdown-row--active" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={b.label}
                className={classes}
                role={interactive ? "button" : "meter"}
                aria-valuenow={interactive ? undefined : Math.round(pct)}
                aria-valuemin={interactive ? undefined : 0}
                aria-valuemax={interactive ? undefined : 100}
                aria-pressed={interactive ? isActive : undefined}
                aria-label={t("storageHeader.bucketLabel", { label: b.label, size: formatSize(b.bytes, unit), count: b.count, plural: b.count === 1 ? "" : "s" })}
                title={
                  interactive
                    ? t("storageHeader.filterBy", { label: b.label })
                    : t("storageHeader.bucketLabel", { label: b.label, size: formatSize(b.bytes, unit), count: b.count, plural: b.count === 1 ? "" : "s" })
                }
                onClick={interactive ? () => onRowClick?.(b.label) : undefined}
                tabIndex={interactive ? 0 : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick?.(b.label);
                        }
                      }
                    : undefined
                }
              >
                <span className="storage__breakdown-label">{b.label}</span>
                <div className="storage__breakdown-bars">
                  <div className="storage__breakdown-track">
                    <div
                      className="storage__breakdown-fill"
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </div>
                  {u && u.total > 0 && (
                    <div
                      className="storage__breakdown-track storage__breakdown-track--usage"
                      title={t("storageHeader.usedOf", { used: formatSize(u.total - u.available, unit), total: formatSize(u.total, unit) })}
                    >
                      <div
                        className="storage__breakdown-fill storage__breakdown-fill--usage"
                        style={{ width: `${usedPct.toFixed(1)}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="storage__breakdown-value">
                  <span className="storage__breakdown-value-size">
                    {formatSize(b.bytes, unit)}
                  </span>
                  <span className="storage__breakdown-value-count">
                    {t("storageHeader.gameCount", { count: b.count, plural: b.count === 1 ? "" : "s" })}
                  </span>
                </div>
                {interactive && (
                  <span className="storage__breakdown-filter" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
