import { useMemo } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  FolderSearch,
  HardDrive,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { formatSize, gameDisplayName, type Game } from "../../types/game";
import { Button, Panel } from "../../components/ui";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import type { DriveUsage } from "./useDriveUsage";
import { StorageEmpty } from "./StorageEmpty";
import {
  gameTotalBytes,
  platformBuckets,
  totalBytesWithMods,
  type StorageBucket,
  type StorageTab,
} from "./utils";
import { LOW_SPACE_PCT, type Recommendation } from "./recommendations";
import { libraryTrend, monthlyReclaim, reclaimedThisMonth, type StorageHistory } from "./reclaim";
import type { LeftoverFolder } from "./useLeftoverScan";

interface Props {
  games: Game[];
  drives: StorageBucket[];
  driveUsage: Map<string, DriveUsage>;
  recommendations: Recommendation[];
  history: StorageHistory;
  leftover: { count: number; bytes: number } | null;
  leftoverFolders: LeftoverFolder[] | null;
  scanningLeftovers: boolean;
  onScanLeftovers: () => void;
  onOpenDrive: (drive: string) => void;
  onActOnRecommendation: (recommendation: Recommendation) => void;
  onSelectGame: (game: Game) => void;
  onOpenTab: (tab: StorageTab) => void;
  onOpenLeftover: (path: string) => void;
}

/**
 * StorageOverview — the summary page.
 *
 * Answers three questions in order: how full is everything, what is biggest,
 * and what changed. Nothing here is a KPI tile; panels carry the tone and the
 * figures sit directly on it.
 */
export function StorageOverview({
  games,
  drives,
  driveUsage,
  recommendations,
  history,
  leftover,
  leftoverFolders,
  scanningLeftovers,
  onScanLeftovers,
  onOpenDrive,
  onActOnRecommendation,
  onSelectGame,
  onOpenTab,
  onOpenLeftover,
}: Props) {
  const { t, language } = useLanguage();
  const { unit } = useSizeUnit();

  const total = useMemo(() => totalBytesWithMods(games), [games]);
  const platforms = useMemo(() => platformBuckets(games), [games]);
  const biggest = useMemo(
    () =>
      [...games]
        .filter((game) => gameTotalBytes(game) > 0)
        .sort((a, b) => gameTotalBytes(b) - gameTotalBytes(a))
        .slice(0, 8),
    [games],
  );

  const capacity = useMemo(() => {
    let totalCap = 0;
    let available = 0;
    for (const usage of driveUsage.values()) {
      totalCap += usage.total;
      available += usage.available;
    }
    return { totalCap, available, used: Math.max(0, totalCap - available) };
  }, [driveUsage]);

  const trend = useMemo(() => libraryTrend(history), [history]);
  const months = useMemo(() => monthlyReclaim(history, 6, Date.now(), language), [history, language]);
  const thisMonth = useMemo(() => reclaimedThisMonth(history), [history]);
  const maxMonth = useMemo(
    () => months.reduce((max, month) => Math.max(max, month.bytes), 0),
    [months],
  );

  const largestShare = biggest.length > 0 ? gameTotalBytes(biggest[0]) : 0;

  return (
    <div className="overview">
      <Panel
        tone="raised"
        icon={<HardDrive />}
        eyebrow={t("storage.overview.capacityEyebrow")}
        heading={t("storage.overview.capacity")}
        actions={
          capacity.totalCap > 0 ? (
            <span className="overview__headline">
              {t("storage.overview.freeOf", { free: formatSize(capacity.available, unit) })}
            </span>
          ) : undefined
        }
      >
        {drives.length === 0 ? (
          <StorageEmpty
            compact
            icon={<HardDrive />}
            title={t("storage.overview.noDrives")}
            description={t("storage.overview.noDrivesHint")}
          />
        ) : (
          <ul className="overview__drives">
            {drives.map((drive) => {
              const usage = driveUsage.get(drive.label);
              const hasUsage = usage != null && usage.total > 0;
              const freePct = hasUsage ? (usage.available / usage.total) * 100 : 0;
              const libraryPct = hasUsage ? Math.min(100, (drive.bytes / usage.total) * 100) : 0;
              const otherPct = hasUsage ? Math.max(0, 100 - freePct - libraryPct) : 0;
              const lowSpace = hasUsage && freePct < LOW_SPACE_PCT;

              return (
                <li key={drive.label} className="overview__drive">
                  <button
                    type="button"
                    className="overview__drive-head"
                    onClick={() => onOpenDrive(drive.label)}
                  >
                    <span className="overview__drive-letter">{drive.label}</span>
                    <span className="overview__drive-count">
                      {t("storage.gamesCount", {
                        count: drive.count,
                        plural: drive.count === 1 ? "" : "s",
                      })}
                    </span>
                    <span className="overview__drive-size">{formatSize(drive.bytes, unit)}</span>
                  </button>
                  <div className="overview__drive-bar">
                    <span
                      className="overview__seg overview__seg--library"
                      style={{ width: `${libraryPct.toFixed(1)}%` }}
                    />
                    <span
                      className="overview__seg overview__seg--other"
                      style={{ width: `${otherPct.toFixed(1)}%` }}
                    />
                  </div>
                  <div className="overview__drive-legend">
                    <span>
                      {hasUsage
                        ? t("storage.overview.legend", {
                            used: formatSize(usage.total - usage.available, unit),
                            total: formatSize(usage.total, unit),
                          })
                        : t("storage.overview.libraryOnly", { size: formatSize(total, unit) })}
                    </span>
                    {lowSpace && (
                      <span className="overview__drive-warn">{t("storage.drive.lowSpaceWarning")}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="overview__split">
        <Panel
          icon={<BarChart3 />}
          eyebrow={t("storage.overview.biggestEyebrow")}
          heading={t("storage.overview.biggest")}
          actions={
            <Button variant="ghost" size="sm" onClick={() => onOpenTab("games")}>
              {t("storage.overview.allGames")}
            </Button>
          }
        >
          {biggest.length === 0 ? (
            <StorageEmpty compact icon={<BarChart3 />} title={t("storage.overview.nothingSized")} />
          ) : (
            <ul className="overview__ranking">
              {biggest.map((game, index) => {
                const bytes = gameTotalBytes(game);
                const width = largestShare > 0 ? (bytes / largestShare) * 100 : 0;
                return (
                  <li key={game.id}>
                    <button
                      type="button"
                      className="overview__rank-row"
                      onClick={() => onSelectGame(game)}
                    >
                      <span className="overview__rank-index">{index + 1}</span>
                      <span className="overview__rank-main">
                        <span className="overview__rank-name">{gameDisplayName(game)}</span>
                        <span className="overview__rank-bar">
                          <span style={{ width: `${width.toFixed(1)}%` }} />
                        </span>
                      </span>
                      <span className="overview__rank-size">{formatSize(bytes, unit)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="overview__stack">
          <Panel
            icon={<TrendingUp />}
            eyebrow={t("storage.overview.historyEyebrow")}
            heading={t("storage.overview.history")}
          >
            <div className="overview__history-figures">
              <div>
                <span className="overview__history-value">{formatSize(thisMonth, unit)}</span>
                <span className="overview__history-label">{t("storage.overview.thisMonth")}</span>
              </div>
              <div>
                <span
                  className={`overview__history-value${trend.delta > 0 ? " is-up" : trend.delta < 0 ? " is-down" : ""}`}
                >
                  {trend.delta === 0
                    ? "—"
                    : `${trend.delta > 0 ? "+" : "−"}${formatSize(Math.abs(trend.delta), unit)}`}
                </span>
                <span className="overview__history-label">
                  {t("storage.overview.trend", {
                    pct: `${trend.deltaPct > 0 ? "+" : ""}${trend.deltaPct.toFixed(1)}`,
                  })}
                  {trend.delta > 0 ? (
                    <ArrowUpRight aria-hidden="true" />
                  ) : trend.delta < 0 ? (
                    <ArrowDownRight aria-hidden="true" />
                  ) : null}
                </span>
              </div>
            </div>

            <div className="overview__chart" role="img" aria-label={t("storage.overview.chartAria")}>
              {months.map((month) => {
                const height = maxMonth > 0 ? Math.round((month.bytes / maxMonth) * 100) : 0;
                return (
                  <span key={month.key} className="overview__chart-col">
                    <span className="overview__chart-track">
                      <span
                        className={`overview__chart-fill${month.bytes > 0 ? " is-filled" : ""}`}
                        style={{ height: `${height}%` }}
                      />
                    </span>
                    <span className="overview__chart-label">{month.label}</span>
                  </span>
                );
              })}
            </div>

            {history.events.length === 0 && (
              <p className="overview__hint">{t("storage.overview.historyEmpty")}</p>
            )}
          </Panel>

          <Panel
            icon={<Sparkles />}
            eyebrow={t("storage.overview.cleanupEyebrow")}
            heading={t("storage.overview.cleanup")}
            actions={
              <Button variant="ghost" size="sm" onClick={() => onOpenTab("health")}>
                {t("storage.view.health")}
              </Button>
            }
          >
            {recommendations.length === 0 ? (
              <p className="overview__clean">{t("storage.overview.clean")}</p>
            ) : (
              <ul className="overview__recs">
                {recommendations.map((rec) => (
                  <li key={rec.id} className={`overview__rec overview__rec--${rec.tone}`}>
                    <span className="overview__rec-text">
                      {t(`storageRec.${rec.id}`, {
                        count: rec.count,
                        plural: rec.count === 1 ? "" : "s",
                        size: rec.bytes > 0 ? formatSize(rec.bytes, unit) : "",
                      })}
                    </span>
                    <button
                      type="button"
                      className="overview__rec-action"
                      onClick={() => onActOnRecommendation(rec)}
                    >
                      {t(`storageRec.${rec.id}.action`)}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="overview__scan">
              <div className="overview__scan-text">
                <span className="overview__scan-title">
                  <FolderSearch aria-hidden="true" />
                  {t("storage.overview.leftovers")}
                </span>
                <span className="overview__scan-hint">
                  {leftover
                    ? t("storage.overview.leftoversFound", {
                        count: leftover.count,
                        plural: leftover.count === 1 ? "" : "s",
                        size: formatSize(leftover.bytes, unit),
                      })
                    : t("storage.overview.leftoversHint")}
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={onScanLeftovers}
                isLoading={scanningLeftovers}
              >
                {t("storage.overview.scan")}
              </Button>
            </div>

            {leftoverFolders && leftoverFolders.length > 0 && (
              <ul className="overview__leftovers">
                {leftoverFolders.slice(0, 8).map((folder) => (
                  <li key={folder.path}>
                    <button
                      type="button"
                      className="overview__leftover"
                      onClick={() => onOpenLeftover(folder.path)}
                      title={folder.path}
                    >
                      <span className="overview__leftover-name">{folder.name}</span>
                      <span className="overview__leftover-size">
                        {folder.bytes > 0 ? formatSize(folder.bytes, unit) : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {leftoverFolders && leftoverFolders.length === 0 && (
              <p className="overview__clean">{t("storage.overview.noLeftovers")}</p>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        icon={<HardDrive />}
        eyebrow={t("storage.overview.platformEyebrow")}
        heading={t("storage.overview.platform")}
      >
        {platforms.length === 0 ? (
          <p className="overview__hint">{t("storage.overview.nothingSized")}</p>
        ) : (
          <ul className="overview__platforms">
            {platforms.map((platform) => {
              const pct = total > 0 ? (platform.bytes / total) * 100 : 0;
              return (
                <li key={platform.label}>
                  <span className="overview__platform-head">
                    <span className="overview__platform-name">{platform.label}</span>
                    <span className="overview__platform-meta">
                      {formatSize(platform.bytes, unit)} · {t("storage.gamesCount", {
                        count: platform.count,
                        plural: platform.count === 1 ? "" : "s",
                      })}
                    </span>
                  </span>
                  <span className="overview__platform-bar">
                    <span style={{ width: `${pct.toFixed(1)}%` }} />
                  </span>
                  <span className="overview__platform-pct">{pct.toFixed(0)}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="overview__footnote">
        {t("storage.overview.footnote", { total: formatSize(total, unit) })}
      </p>
    </div>
  );
}
