import { AlertTriangle, ChevronRight, HardDrive, RefreshCw } from "lucide-react";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import type { DriveUsage } from "./useDriveUsage";
import type { StorageBucket } from "./utils";
import { LOW_SPACE_PCT } from "./recommendations";

interface Props {
  drives: StorageBucket[];
  usage: Map<string, DriveUsage>;
  activeDrive: string | null;
  totalBytes: number;
  gameCount: number;
  onSelect: (drive: string | null) => void;
  onOpenDrive: (drive: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

/** Windows `C:` stays as-is; unix mount points read better as their leaf. */
function driveShortLabel(label: string): string {
  if (/^[a-zA-Z]:$/.test(label)) return label;
  const leaf = label.split("/").filter(Boolean).pop();
  return leaf ?? label;
}

/**
 * DriveRail — the drive filter that replaces the old view-mode switcher.
 *
 * Clicking a drive filters the table; the chevron opens the drive's detail
 * sheet. Capacity is split into library bytes and everything else, so the bar
 * answers "how much of this disk is my games" at a glance.
 */
export function DriveRail({
  drives,
  usage,
  activeDrive,
  totalBytes,
  gameCount,
  onSelect,
  onOpenDrive,
  onRefresh,
  refreshing = false,
}: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();

  return (
    <aside className="drive-rail" aria-label={t("storage.rail.aria")}>
      <div className="drive-rail__head">
        <span className="drive-rail__title">
          <HardDrive aria-hidden="true" />
          {t("storage.rail.title")}
        </span>
        <button
          type="button"
          className="drive-rail__refresh"
          onClick={onRefresh}
          title={t("storage.recheckTitle")}
          aria-label={t("storage.recheckTitle")}
        >
          <RefreshCw className={refreshing ? "is-spinning" : undefined} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className={`drive-rail__all${activeDrive === null ? " is-active" : ""}`}
        onClick={() => onSelect(null)}
        aria-pressed={activeDrive === null}
      >
        <span className="drive-rail__all-label">{t("storage.rail.all")}</span>
        <span className="drive-rail__all-meta">
          {formatSize(totalBytes, unit)} · {t("storage.gamesCount", { count: gameCount, plural: gameCount === 1 ? "" : "s" })}
        </span>
      </button>

      <ul className="drive-rail__list">
        {drives.map((drive) => {
          const u = usage.get(drive.label);
          const hasUsage = u != null && u.total > 0;
          const freePct = hasUsage ? (u.available / u.total) * 100 : 0;
          const libraryPct = hasUsage ? Math.min(100, (drive.bytes / u.total) * 100) : 0;
          const otherPct = hasUsage ? Math.max(0, 100 - freePct - libraryPct) : 0;
          const lowSpace = hasUsage && freePct < LOW_SPACE_PCT;
          const active = activeDrive === drive.label;

          return (
            <li
              key={drive.label}
              className={`drive-rail__item${active ? " is-active" : ""}${lowSpace ? " is-low" : ""}`}
            >
              <button
                type="button"
                className="drive-rail__select"
                onClick={() => onSelect(active ? null : drive.label)}
                aria-pressed={active}
                title={active ? t("storage.clearDriveFilter", { drive: drive.label }) : drive.label}
              >
                <span className="drive-rail__letter">{driveShortLabel(drive.label)}</span>
                <span className="drive-rail__meta">
                  <span className="drive-rail__size">{formatSize(drive.bytes, unit)}</span>
                  <span className="drive-rail__count">
                    {t("storage.gamesCount", { count: drive.count, plural: drive.count === 1 ? "" : "s" })}
                  </span>
                </span>
              </button>

              <div
                className="drive-rail__bar"
                role="img"
                aria-label={
                  hasUsage
                    ? t("storage.rail.usageAria", {
                        free: formatSize(u.available, unit),
                        total: formatSize(u.total, unit),
                      })
                    : undefined
                }
              >
                <span
                  className="drive-rail__seg drive-rail__seg--library"
                  style={{ width: `${libraryPct.toFixed(1)}%` }}
                />
                <span
                  className="drive-rail__seg drive-rail__seg--other"
                  style={{ width: `${otherPct.toFixed(1)}%` }}
                />
              </div>

              <div className="drive-rail__foot">
                <span className={`drive-rail__free${lowSpace ? " is-low" : ""}`}>
                  {hasUsage ? (
                    <>
                      {lowSpace && <AlertTriangle aria-hidden="true" />}
                      {t("storage.rail.free", { size: formatSize(u.available, unit) })}
                    </>
                  ) : (
                    t("storage.rail.noCapacity")
                  )}
                </span>
                <button
                  type="button"
                  className="drive-rail__more"
                  onClick={() => onOpenDrive(drive.label)}
                  aria-label={t("storage.rail.open", { drive: drive.label })}
                  title={t("storage.rail.open", { drive: drive.label })}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {drives.length === 0 && (
        <p className="drive-rail__empty">{t("storage.rail.empty")}</p>
      )}
    </aside>
  );
}
