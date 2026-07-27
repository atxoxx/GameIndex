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
   *  disk. Surfaced in the totals card meta line so the user can see
   *  the staleness coverage at a glance. */
  staleCount?: number;
  /** The drive label currently filtering the list, if any. The matching
   *  "By drive" row is highlighted so the active filter reads clearly. */
  activeDrive?: string | null;
  /** Click a "By drive" row to filter the Storage list to that volume. */
  onDriveClick?: (label: string) => void;
}

/** Phase-5 Storage header — totals card + per-platform + per-drive
 *  breakdown bars. Pure presentational: receives the unsorted games
 *  array (the orchestrator handles sorting) and aggregates internally.
 *
 *  Note: the page title/subtitle are rendered by StoragePage itself
 *  so this component just produces the three breakdown cards. */
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

  return (
    <div className="storage__header-grid">
        {/* Totals card */}
        <section className="storage__card storage__card--totals">
          <span className="storage__card-label">{t("storagePage.trackedSize")}</span>
          <span className="storage__card-value">{formatSize(total, unit)}</span>
          <span className="storage__card-meta">
            {t("storageHeader.sizedGames", { count: coverage.sized, plural: coverage.sized === 1 ? "" : "s" })}
            {uncategorized > 0 &&
              `  ${"·"}  ${t("storageHeader.missingCount", { count: uncategorized, plural: uncategorized === 1 ? "" : "s" })}`}
            {staleCount > 0 && (
              <>
                {`  ${"·"}  `}
                <span className="storage__card-meta-stale">
                  {t("storageHeader.staleCount", { count: staleCount })}
                </span>
              </>
            )}
          </span>
        </section>

        <BreakdownCard title={t("storageHeader.byPlatform")} buckets={platforms} total={total} unit={unit} />
        <BreakdownCard
          title={t("storageHeader.byDrive")}
          buckets={drives}
          total={total}
          unit={unit}
          usage={driveUsage}
          activeKey={activeDrive}
          onRowClick={onDriveClick}
        />
    </div>
  );
}

/** One breakdown card. Renders an empty-state row when no sized
 *  games are bucketed into this dimension.
 *
 *  For the "By drive" card (when `usage` is supplied) each row also
 *  shows a volume-utilization mini-bar beneath the game-bytes bar: how
 *  much of the drive's total capacity the tracked games consume, plus a
 *  "free" label. Drives whose capacity query failed simply omit that
 *  sub-row. */
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
  /** Optional per-drive capacity map (only the "By drive" card passes
   *  this). Keyed by the same label `driveBuckets` produces. */
  usage?: Map<string, { total: number; free: number; available: number }>;
  /** Highlighted row label (drive filter is active). */
  activeKey?: string | null;
  /** Click handler for a row (drive filter). Only the "By drive" card
   *  passes one. */
  onRowClick?: (label: string) => void;
}) {
  const { t } = useLanguage();
  const interactive = !!onRowClick;
  return (
    <section className="storage__card storage__card--breakdown">
      <span className="storage__card-label">{title}</span>
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
                <div className="storage__breakdown-track">
                  <div
                    className="storage__breakdown-fill"
                    style={{ width: `${pct.toFixed(1)}%` }}
                  />
                </div>
                <span className="storage__breakdown-value">
                  {formatSize(b.bytes, unit)}
                </span>
                {u && u.total > 0 && (
                  <span className="storage__drive-usage">
                    <span className="storage__drive-usage-track">
                      <span
                        className="storage__drive-usage-fill"
                        style={{ width: `${usedPct.toFixed(1)}%` }}
                      />
                    </span>
                    <span className="storage__drive-usage-label">
                      {t("storageHeader.usedOf", { used: formatSize(u.total - u.available, unit), total: formatSize(u.total, unit) })}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
