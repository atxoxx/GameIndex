import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Copy,
  RefreshCw,
  X,
} from "lucide-react";
import { SubTabs, type SubTabItem } from "./ui/SubTabs";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { StatBand, type StatBandItem } from "./ui/StatBand";
import { Skeleton } from "./ui/Skeleton";
import LineChart from "./charts/LineChart";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import {
  useSteamPlayerHistory,
  type PlayerHistoryRange,
} from "../hooks/useSteamPlayerHistory";
import {
  refreshSteamPlayerCount,
  useSteamPlayerCountInfo,
} from "../hooks/useSteamPlayerCount";
import {
  formatCompactPlayerCount,
  formatPlayerAxisLabel,
  formatPlayerSampleTime,
  nicePlayerCeil,
  playerCountChangePercent,
} from "../utils/playerCount";
import { copyTextToClipboard } from "../utils/clipboard";
import "./player-count-modal.css";

/**
 * PlayerCountModal
 *
 * The single Steam "current players" surface. Opens from any
 * `<PlayerCountBadge>` as a centered floating modal — game name, live
 * count, trend and player history. Static metadata (reviews, developer,
 * publisher, release date, price) is deliberately absent: the Game page
 * overview already owns those facts, and repeating them here only made
 * the surface longer without adding information.
 *
 * Layout
 * ──────
 *  - Header: Steam icon, game name, app id + freshness, refresh, close.
 *  - Tabs: Overview (live count, peaks, 7-day sparkline) and Activity
 *    (long-range chart, range toggle, current/average/peak band).
 *  - Footer: copy summary plus Steam / Community / SteamDB links.
 *
 * Data
 * ────
 *  - `useSteamPlayerCountInfo` for the live count + freshness (shared
 *    module store with the badge, so both always agree).
 *  - Two history hooks: a fixed 7d sparkline on Overview and a lazy
 *    Activity series (`enabled` only while that tab is open). Both hit the
 *    same Rust cache, so only the first one reaches Steam.
 *  - No review/metadata fetch at all — opening the modal costs one IPC
 *    for the history series (and none for stats).
 *
 * Interaction
 * ───────────
 *  - Portaled into `document.body` over a dimmed backdrop.
 *  - Focus moves to the close button on open, Tab is trapped, Escape and
 *    backdrop clicks dismiss, page scroll is locked, and focus returns to
 *    the badge on close.
 *  - Refresh awaits every live request so the header spinner reflects real
 *    work instead of a timer.
 */

type TabId = "overview" | "activity";

const ACTIVITY_RANGES: PlayerHistoryRange[] = [7, 30, 90, 180, 0];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const STEAM_GLYPH =
  "M12 2a10 10 0 0 0-10 10c0 4.7 3.25 8.65 7.66 9.7l2.84-4.14a2.98 2.98 0 0 1-.5-.06l-3.23-1.32a3.02 3.02 0 0 1-1.77-2.78c0-1.66 1.34-3 3-3 .76 0 1.45.28 1.99.75l3.24-1.32c.1-.8.5-1.5 1.12-2.02A4.5 4.5 0 0 1 21 12.5a4.5 4.5 0 0 1-4.5 4.5c-.75 0-1.46-.19-2.08-.52l-2.42 3.52c4.4-.38 7.84-4.08 7.84-8.6A10 10 0 0 0 12 2zm4.5 8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z";

export interface PlayerCountModalProps {
  appId: number;
  /** Local game title, so the header never flashes a placeholder. */
  gameName?: string;
  /** Count captured by the badge at click time, so the header never
   *  renders an empty frame before the shared store settles. */
  currentCount: number;
  onClose: () => void;
}

/** The "Updated 12s ago" line. Owns its own tick so only this span
 *  re-renders every second, not the chart. */
function FreshnessLabel({ updatedAt }: { updatedAt: number | null }) {
  const { t } = useLanguage();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (updatedAt === null) return;
    const timer = window.setInterval(() => {
      // The relative label can coast while the window is hidden.
      if (document.hidden) return;
      setTick((tick) => tick + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [updatedAt]);

  if (updatedAt === null) return <>{t("steamPlayer.awaitingData")}</>;
  return (
    <>
      {t("steamPlayer.updatedAgo", {
        seconds: Math.max(0, Math.floor((Date.now() - updatedAt) / 1000)),
      })}
    </>
  );
}

function ActivitySection({
  range,
  onRangeChange,
  data,
  isLoading,
  isRefreshing,
  error,
  refresh,
}: {
  range: PlayerHistoryRange;
  onRangeChange: (range: PlayerHistoryRange) => void;
  data: ReturnType<typeof useSteamPlayerHistory>["data"];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}) {
  const { t, language } = useLanguage();
  const allTime = range === 0;
  const rangeLabel = allTime
    ? t("steamPlayer.rangeAll")
    : t("steamPlayer.rangeDays", { days: range });

  const chart = useMemo(() => {
    if (!data || data.points.length === 0) {
      return { series: [], labels: [] };
    }
    return {
      series: [
        {
          data: data.points.map((point) => point.count),
          color: "var(--color-accent)",
          label: t("steamPlayer.currentPlayers"),
        },
      ],
      labels: data.points.map((point) =>
        formatPlayerAxisLabel(point.timestamp, language, allTime, !allTime && range <= 7)
      ),
    };
  }, [data, allTime, language, t]);

  const showChart = !!data && data.points.length >= 2;
  // Trust the plotted samples as well as the backend aggregate: if the two
  // ever disagree (stale peak field), the line must still fit the axis.
  const chartMax = data
    ? Math.max(data.peakInRange, ...data.points.map((point) => point.count))
    : 0;
  const peakWhen = formatPlayerSampleTime(data?.peakInRangeAt, language, {
    withYear: allTime,
    withTime: true,
  });
  const allTimeWhen = formatPlayerSampleTime(data?.peakAllTimeAt, language, {
    withYear: true,
  });

  const stats: StatBandItem[] = data
    ? [
        {
          id: "current",
          label: t("steamPlayer.statCurrent"),
          value: formatCompactPlayerCount(data.current),
          tone: "success",
          detail: t("steamPlayer.live"),
        },
        {
          id: "average",
          label: t("steamPlayer.statAvg"),
          value: formatCompactPlayerCount(Math.round(data.averageInRange)),
          detail: rangeLabel,
        },
        {
          id: "peak",
          label: t("steamPlayer.statPeak"),
          value: formatCompactPlayerCount(data.peakInRange),
          tone: "warning",
          detail: peakWhen || rangeLabel,
        },
        {
          id: "all-time-peak",
          label: t("steamPlayer.statAllTimePeak"),
          value: formatCompactPlayerCount(data.peakAllTime),
          tone: "accent",
          detail: allTimeWhen || t("steamPlayer.rangeAll"),
        },
      ]
    : [];

  return (
    <section
      className="pc-activity"
      role="tabpanel"
      aria-label={t("steamPlayer.tabActivity")}
    >
      <div className="pc-activity__head">
        <div className="pc-activity__titles">
          <h3 className="pc-section-title">
            <Activity size={13} aria-hidden />
            {t("steamPlayer.concurrentPlayers")}
          </h3>
          {data && (
            <p className="pc-activity__sub">
              {t("steamPlayer.historySummary", { range: rangeLabel })}
            </p>
          )}
        </div>

        <div
          className="pc-ranges"
          role="group"
          aria-label={t("steamPlayer.historyRangeAria")}
        >
          {ACTIVITY_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              className={`pc-range ${range === option ? "is-active" : ""}`}
              aria-pressed={range === option}
              onClick={() => onRangeChange(option)}
            >
              {option === 0
                ? t("steamPlayer.rangeAllShort")
                : t("steamPlayer.rangeDaysShort", { days: option })}
            </button>
          ))}
        </div>
      </div>

      <div className={`pc-panel pc-plot ${isRefreshing || isLoading ? "is-refreshing" : ""}`}>
        {isLoading && !data ? (
          <div className="pc-plot__skeleton" aria-hidden="true">
            <Skeleton shape="rect" height="160px" />
            <div className="pc-plot__skeleton-row">
              <Skeleton shape="text" width="30%" />
              <Skeleton shape="text" width="30%" />
              <Skeleton shape="text" width="30%" />
            </div>
          </div>
        ) : error && !data ? (
          <div className="pc-inline-error" role="alert">
            <span>{t("steamPlayer.historyUnavailable")}</span>
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>
              {t("steamPlayer.retry")}
            </Button>
          </div>
        ) : showChart && data ? (
          <LineChart
            series={chart.series}
            labels={chart.labels}
            height={240}
            smooth
            niceMax
            legend={false}
            showExtremes
            fillOpacity={0.16}
            formatValue={formatCompactPlayerCount}
            maxY={nicePlayerCeil(chartMax)}
            thresholds={[
              { value: data.peakInRange, label: t("steamPlayer.statPeak") },
            ]}
          />
        ) : (
          <div className="pc-empty">
            <span className="pc-empty__dot" aria-hidden="true" />
            <span>{t("steamPlayer.noHistoryYet")}</span>
          </div>
        )}
      </div>

      {error && data && (
        <p className="pc-muted-line" role="status">
          {t("steamPlayer.historyStale")}
        </p>
      )}

      {stats.length > 0 && (
        <StatBand ariaLabel={t("steamPlayer.activityStatsAria")} items={stats} />
      )}

      {data?.downsampled && (
        <p className="pc-footnote">{t("steamPlayer.downsampled")}</p>
      )}
    </section>
  );
}

export default function PlayerCountModal({
  appId,
  gameName,
  currentCount,
  onClose,
}: PlayerCountModalProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const live = useSteamPlayerCountInfo(appId);
  const spark = useSteamPlayerHistory(appId, 7);
  const { refresh: refreshSpark } = spark;
  const [tab, setTab] = useState<TabId>("overview");
  const [activityRange, setActivityRange] = useState<PlayerHistoryRange>(7);
  const activity = useSteamPlayerHistory(
    appId,
    activityRange,
    tab === "activity"
  );
  const { refresh: refreshActivity } = activity;

  const [refreshing, setRefreshing] = useState(false);

  const liveCount = live.count ?? currentCount;
  const title = gameName?.trim() || t("steamPlayer.modalTitle");

  const rangeShort = t("steamPlayer.rangeDaysShort", { days: 7 });
  const trend = spark.data
    ? playerCountChangePercent(
        spark.data.averageInRange,
        spark.data.previousAverageInRange
      )
    : null;

  const sparkSeries = useMemo(() => {
    if (!spark.data || spark.data.points.length === 0) return [];
    return [
      {
        data: spark.data.points.map((point) => point.count),
        color: "var(--color-accent)",
        label: t("steamPlayer.currentPlayers"),
      },
    ];
  }, [spark.data, t]);

  const sparkLabels = useMemo(
    () =>
      spark.data?.points.map((point) =>
        formatPlayerAxisLabel(point.timestamp, language, false, true)
      ) ?? [],
    [spark.data, language]
  );

  const sparkMax = spark.data
    ? Math.max(
        spark.data.peakInRange,
        ...spark.data.points.map((point) => point.count)
      )
    : 0;

  const peakWhen = formatPlayerSampleTime(spark.data?.peakInRangeAt, language, {
    withYear: false,
    withTime: true,
  });
  const allTimeWhen = formatPlayerSampleTime(spark.data?.peakAllTimeAt, language, {
    withYear: true,
  });

  // Focus trap, Escape, scroll lock and focus restoration. Mirrors the
  // DetailDrawer contract so overlays across the app behave the same.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter(
        (node) => node.offsetParent !== null || node === document.activeElement
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refreshSteamPlayerCount(appId),
        refreshSpark(),
        tab === "activity" ? refreshActivity() : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [appId, refreshSpark, refreshActivity, tab]);

  const summary = useMemo(() => {
    const lines = [
      title,
      `${t("steamPlayer.currentPlayers")}: ${liveCount.toLocaleString(language)}`,
    ];
    if (spark.data) {
      lines.push(
        `${t("steamPlayer.peakForRange", { range: rangeShort })}: ${formatCompactPlayerCount(
          spark.data.peakInRange
        )}${peakWhen ? ` · ${peakWhen}` : ""}`
      );
      lines.push(
        `${t("steamPlayer.statAllTimePeak")}: ${formatCompactPlayerCount(
          spark.data.peakAllTime
        )}${allTimeWhen ? ` · ${allTimeWhen}` : ""}`
      );
    }
    lines.push(t("steamPlayer.sourceSummary"));
    return lines.join("\n");
  }, [
    title, liveCount, language, spark.data, rangeShort, peakWhen,
    allTimeWhen, t,
  ]);

  const handleCopy = useCallback(async () => {
    const copied = await copyTextToClipboard(summary);
    showToast(
      copied ? t("steamPlayer.copied") : t("steamPlayer.copyFailed"),
      copied ? "success" : "error"
    );
  }, [summary, showToast, t]);

  const tabs: SubTabItem<TabId>[] = [
    { id: "overview", label: t("steamPlayer.tabOverview") },
    { id: "activity", label: t("steamPlayer.tabActivity") },
  ];

  return createPortal(
    <div
      className="modal-backdrop pc-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        className="modal pc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header pc-modal-header">
          <div className="modal-header-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d={STEAM_GLYPH} />
            </svg>
          </div>

          <div className="modal-header-text">
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            <p className="modal-subtitle">{t("steamPlayer.modalSubtitle")}</p>
            <div className="pc-badges">
              <Badge>{t("steamPlayer.appIdBadge", { appId })}</Badge>
              <span className="pc-freshness">
                <span className="pc-freshness__dot" aria-hidden="true" />
                <FreshnessLabel updatedAt={live.updatedAt} />
              </span>
            </div>
          </div>

          <div className="pc-modal-actions">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              isLoading={refreshing}
              onClick={() => void handleRefresh()}
              aria-label={t("steamPlayer.refreshStats")}
              title={t("steamPlayer.refreshStats")}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </Button>
            <Button
              ref={closeRef}
              variant="ghost"
              size="sm"
              iconOnly
              onClick={() => onCloseRef.current()}
              aria-label={t("steamPlayer.close")}
              title={t("steamPlayer.close")}
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="modal-body pc-modal-body">
          <SubTabs
            items={tabs}
            value={tab}
            onChange={setTab}
            ariaLabel={t("steamPlayer.tabsAria")}
            sticky
            className="pc-tabs"
          />

          <div className="pc-modal-content">
            {tab === "overview" ? (
              <div
                className="pc-overview"
                role="tabpanel"
                aria-label={t("steamPlayer.tabOverview")}
              >
                <section className="pc-hero">
                  <div className="pc-hero__row">
                    <div className="pc-hero__count">
                      <span className="pc-hero__label">
                        <span className="pc-live-dot" aria-hidden="true" />
                        {t("steamPlayer.playingNowLabel")}
                      </span>
                      <span
                        className="pc-hero__value"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {liveCount > 0 ? liveCount.toLocaleString(language) : "—"}
                      </span>
                    </div>

                    {trend !== null && (
                      <span
                        className={`pc-trend ${trend >= 0 ? "is-up" : "is-down"}`}
                        title={t("steamPlayer.trendHint", { range: rangeShort })}
                      >
                        {trend >= 0 ? (
                          <ArrowUpRight size={13} aria-hidden="true" />
                        ) : (
                          <ArrowDownRight size={13} aria-hidden="true" />
                        )}
                        {trend > 0 ? "+" : ""}
                        {trend}%
                        <small>
                          {t("steamPlayer.trendVsPrevious", { range: rangeShort })}
                        </small>
                      </span>
                    )}
                  </div>

                  <p className="pc-hero__live">{t("steamPlayer.liveUpdates")}</p>

                  {spark.data && spark.data.peakInRange > 0 && (
                    <div className="pc-hero__meta">
                      <span>
                        {t("steamPlayer.peakForRange", { range: rangeShort })}{" "}
                        <b>{formatCompactPlayerCount(spark.data.peakInRange)}</b>
                        {peakWhen && <span className="pc-sep">·</span>}
                        {peakWhen}
                      </span>
                      {spark.data.peakAllTime > 0 && (
                        <span>
                          {t("steamPlayer.statAllTimePeak")}{" "}
                          <b>{formatCompactPlayerCount(spark.data.peakAllTime)}</b>
                          {allTimeWhen && <span className="pc-sep">·</span>}
                          {allTimeWhen}
                        </span>
                      )}
                    </div>
                  )}
                </section>

                <section className="pc-panel pc-spark">
                  <header className="pc-section-head">
                    <span className="pc-section-title">
                      <Activity size={13} aria-hidden="true" />
                      {t("steamPlayer.last7Days")}
                    </span>
                    <button
                      type="button"
                      className="pc-link"
                      onClick={() => setTab("activity")}
                    >
                      {t("steamPlayer.viewActivity")}
                      <ChevronRight size={13} aria-hidden="true" />
                    </button>
                  </header>

                  {spark.isLoading && !spark.data ? (
                    <Skeleton shape="rect" height="160px" />
                  ) : spark.data && sparkSeries.length > 0 && spark.data.points.length >= 2 ? (
                    <LineChart
                      series={sparkSeries}
                      labels={sparkLabels}
                      height={180}
                      smooth
                      niceMax
                      legend={false}
                      showDots="never"
                      fillOpacity={0.16}
                      formatValue={formatCompactPlayerCount}
                      maxY={nicePlayerCeil(sparkMax)}
                    />
                  ) : (
                    <p className="pc-muted-line">
                      {spark.error
                        ? t("steamPlayer.historyUnavailable")
                        : t("steamPlayer.noHistoryYet")}
                    </p>
                  )}
                </section>
              </div>
            ) : (
              <ActivitySection
                range={activityRange}
                onRangeChange={setActivityRange}
                data={activity.data}
                isLoading={activity.isLoading}
                isRefreshing={activity.isRefreshing}
                error={activity.error}
                refresh={activity.refresh}
              />
            )}
          </div>
        </div>

        <footer className="modal-footer pc-modal-footer">
          <div className="pc-footer">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Copy size={14} aria-hidden="true" />}
              onClick={() => void handleCopy()}
            >
              {t("steamPlayer.copySummary")}
            </Button>
            <nav className="pc-links" aria-label={t("steamPlayer.externalLinksAria")}>
              <a
                href={`https://store.steampowered.com/app/${appId}`}
                target="_blank"
                rel="noopener noreferrer"
                title={t("steamPlayer.openSteamStore")}
              >
                {t("steamPlayer.steam")}
              </a>
              <a
                href={`https://steamcommunity.com/app/${appId}`}
                target="_blank"
                rel="noopener noreferrer"
                title={t("steamPlayer.openCommunityHub")}
              >
                {t("steamPlayer.communityHub")}
              </a>
              <a
                href={`https://steamdb.info/app/${appId}/charts/`}
                target="_blank"
                rel="noopener noreferrer"
                title={t("steamPlayer.openSteamDbCharts")}
              >
                {t("steamPlayer.steamDb")}
              </a>
            </nav>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
