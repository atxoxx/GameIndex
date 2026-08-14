import { useMemo, useState, type ComponentProps } from "react";
import LineChart from "../../components/charts/LineChart";
import { ActivitySparkline } from "./ActivitySparkline";
import { GameThumbnail } from "./GameThumbnail";
import PlayerCountBadge from "../../components/PlayerCountBadge";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useSettings } from "../../context/SettingsContext";
import { useActivity } from "../../context/ActivityContext";
import { buildSingleSessionSeries } from "../../utils/perfSamples";
import { formatTemp, toDisplayTemp, toDisplayTemps, tempUnitLabel, tempThreshold, tempMinY, tempMaxY } from "../../utils/temp";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime, type Game, type GameSession } from "../../types/game";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { generateEstimatedTimeline } from "./performance/perfData";
import * as Icons from "./Icons";

export interface ActivitySessionsProps {
  sessions: GameSession[];
  games: Game[];
  onDeleteSession: (id: string) => void;
}

interface SessionItemProps {
  session: GameSession;
  game: Game | undefined;
  onRequestDelete: (session: GameSession) => void;
}

function ActivitySessionItem({ session, game, onRequestDelete }: SessionItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeChartTab, setActiveChartTab] = useState<"usage" | "temps" | "ram" | "fps">("usage");
  const { tempUnit } = useSettings();
  const { totalRamGb } = useActivity();
  const { t, language } = useLanguage();

  // Resolve the Steam appid for this session's game.
  const { appId: resolvedSteamAppId } = useSteamAppId(game ?? null);
  const steamAppId =
    typeof resolvedSteamAppId === "number"
      ? resolvedSteamAppId
      : game?.steamAppId ?? null;

  const durationMs = session.durationMin * 60 * 1000;

  const formattedDate = useMemo(() => {
    const d = new Date(session.date);
    return d.toLocaleDateString(language, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [session.date, language]);

  const formattedTime = useMemo(() => {
    const d = new Date(session.date);
    const start = new Date(d.getTime() - durationMs);
    const fmt = (date: Date) => date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
    return `${fmt(start)} - ${fmt(d)}`;
  }, [session.date, durationMs, language]);

  const formattedDuration = useMemo(() => {
    return formatPlayTime(session.durationMin);
  }, [session.durationMin]);

  // Build real hardware sample logs for chart overlays.
  const chartProps = useMemo(() => {
    if (!session.metrics) return null;
    const m = session.metrics;
    const pts = 45;

    const real = buildSingleSessionSeries(m, pts);
    let fps: number[], cpu: number[], gpu: number[], cpuTemp: number[], gpuTemp: number[], ram: number[];

    if (real) {
      fps = real.fps;
      cpu = real.cpu;
      gpu = real.gpu;
      cpuTemp = real.cpuTemp;
      gpuTemp = real.gpuTemp;
      ram = real.ram;
    } else {
      const seedKey = `session-${session.id}`;
      fps = generateEstimatedTimeline(m.avgFps, m.minFps, m.maxFps, pts, `fps:${seedKey}`);
      cpu = generateEstimatedTimeline(m.avgCpuUsage, Math.round(m.avgCpuUsage * 0.4), Math.round(m.avgCpuUsage * 1.5), pts, `cpu:${seedKey}`).map(v => Math.min(100, Math.max(0, v)));
      gpu = generateEstimatedTimeline(m.avgGpuUsage, Math.round(m.avgGpuUsage * 0.3), Math.round(m.avgGpuUsage * 1.6), pts, `gpu:${seedKey}`).map(v => Math.min(100, Math.max(0, v)));
      cpuTemp = generateEstimatedTimeline(m.avgCpuTemp, m.avgCpuTemp - 7, m.avgCpuTemp + 11, pts, `cputemp:${seedKey}`);
      gpuTemp = generateEstimatedTimeline(m.avgGpuTemp, m.avgGpuTemp - 6, m.avgGpuTemp + 9, pts, `gputemp:${seedKey}`);
      ram = generateEstimatedTimeline(m.avgRamUsage, Math.round(m.avgRamUsage * 0.8), Math.round(m.avgRamUsage * 1.15), pts, `ram:${seedKey}`).map(v => Math.min(100, Math.max(0, v)));
    }

    // Labels represent timeline progress
    const labels = Array.from({ length: pts }).map((_, i) => `${Math.round((i / (pts - 1)) * 100)}%`);

    return { fps, cpu, gpu, cpuTemp, gpuTemp, ram, labels, real: !!real };
  }, [session.metrics, session.id]);

  const chartSeries = useMemo(() => {
    if (!chartProps) return [];
    if (activeChartTab === "usage") {
      return [
        { data: chartProps.cpu, color: "var(--color-brand-blue)", label: t("activity.sessions.cpuLoad") },
        { data: chartProps.gpu, color: "var(--color-accent)", label: t("activity.sessions.gpuLoad") },
      ];
    } else if (activeChartTab === "temps") {
      return [
        { data: toDisplayTemps(chartProps.cpuTemp, tempUnit), color: "var(--color-danger)", label: t("activityPerf.cpuTemp") },
        { data: toDisplayTemps(chartProps.gpuTemp, tempUnit), color: "var(--color-warning)", label: t("activityPerf.gpuTemp") },
      ];
    } else if (activeChartTab === "ram") {
      const totalRam = totalRamGb || 16;
      const ramGb = chartProps.ram.map((v) => Math.round((totalRam * v) / 10) / 10);
      return [{ data: ramGb, color: "var(--color-success)", label: t("activityPerf.ramUsage") }];
    } else {
      return [{ data: chartProps.fps, color: "var(--color-brand-teal)", label: t("activityPerf.fps") }];
    }
  }, [chartProps, activeChartTab, tempUnit, totalRamGb, t]);

  const yValFormatter = (val: number) => {
    if (activeChartTab === "usage") return `${Math.round(val)}%`;
    if (activeChartTab === "temps") return formatTemp(val, tempUnit);
    if (activeChartTab === "ram") return `${val.toFixed(1)} GB`;
    return `${Math.round(val)} FPS`;
  };

  const chartExtra = useMemo<Partial<ComponentProps<typeof LineChart>>>(() => {
    if (activeChartTab === "usage") {
      return {
        smooth: true,
        minY: 0,
        maxY: 100,
        thresholds: [{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }],
      };
    }
    if (activeChartTab === "temps") {
      return {
        smooth: true,
        minY: tempMinY(tempUnit),
        maxY: tempMaxY(tempUnit),
        bands: [
          { from: tempThreshold(85, tempUnit), to: tempMaxY(tempUnit), color: "var(--color-danger)", opacity: 0.1 },
        ],
        thresholds: [
          { value: tempThreshold(75, tempUnit), label: t("activityPerf.warmThreshold"), color: "var(--color-warning)" },
          { value: tempThreshold(85, tempUnit), label: t("activityPerf.hotThreshold"), color: "var(--color-danger)" },
        ],
      };
    }
    if (activeChartTab === "ram") {
      return { smooth: true, niceMax: true };
    }
    return {
      smooth: true,
      minY: 0,
      niceMax: true,
      thresholds: [{ value: 60, label: t("activityPerf.threshold60fps"), color: "var(--color-success)" }],
    };
  }, [activeChartTab, tempUnit, t]);

  // Build sparkline structures
  const sparklineData = useMemo(() => {
    if (!chartProps) return null;
    const formatSpark = (arr: number[]) => arr.map((y, x) => ({ x, y }));
    return {
      cpu: formatSpark(chartProps.cpu),
      gpu: formatSpark(chartProps.gpu),
      cpuTemp: formatSpark(chartProps.cpuTemp),
      gpuTemp: formatSpark(chartProps.gpuTemp),
      ram: formatSpark(chartProps.ram),
      fps: formatSpark(chartProps.fps),
    };
  }, [chartProps]);

  return (
    <div className={`activity-session-item ${isExpanded ? "activity-session-item--expanded" : ""}`}>
      {/* Header Row */}
      <div
        className="activity-session-item__row"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div className="activity-session-item__header-left">
          <span className="activity-session-item__chevron" aria-hidden="true">
            {isExpanded ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}
          </span>
          <div className="activity-session-item__game-icon-container">
            <GameThumbnail
              iconUrl={game?.iconUrl}
              coverArtUrl={game?.coverArtUrl}
              steamAppId={steamAppId}
              name={session.gameName}
              className="activity-session-item__game-icon"
            />
            {steamAppId != null ? (
              <div
                className="activity-session-item__player-chip"
                aria-hidden={false}
              >
                <PlayerCountBadge
                  appId={steamAppId}
                  className="activity-session-item__player-chip-badge"
                />
              </div>
            ) : null}
          </div>
          <div className="activity-session-item__info">
            <span className="activity-session-item__date">{session.gameName}</span>
            <span className="activity-session-item__time">
              {formattedDate} · {formattedTime}
            </span>
          </div>
        </div>

        <div className="activity-session-item__header-right">
          <span className="activity-session-item__duration">{formattedDuration}</span>
          <button
            type="button"
            className="activity-session-item__delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(session);
            }}
            title={t("activitySessions.delete")}
            aria-label={t("activitySessions.delete")}
          >
            <Icons.Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Expanded Accordion Body */}
      {isExpanded && (
        <div className="activity-session-item__collapsible">
          {session.metrics && sparklineData ? (
            <div className="activity-hardware-card">
              <h4 className="activity-hardware-card__title">{t("activitySessions.hardwareSummary")}</h4>
              <div className="activity-hardware-card__metrics">
                <ActivitySparkline
                  data={sparklineData.cpu}
                  label={t("activityPerf.cpuUsage")}
                  unit="%"
                  value={session.metrics.avgCpuUsage}
                  max={Math.round(session.metrics.avgCpuUsage * 1.5)}
                  thresholds={{ warn: 70, danger: 90 }}
                />

                <ActivitySparkline
                  data={sparklineData.gpu}
                  label={t("activityPerf.gpuUsage")}
                  unit="%"
                  value={session.metrics.avgGpuUsage}
                  max={Math.round(session.metrics.avgGpuUsage * 1.4)}
                  thresholds={{ warn: 70, danger: 90 }}
                />

                <ActivitySparkline
                  data={sparklineData.cpuTemp.map((p) => ({ ...p, y: toDisplayTemp(p.y, tempUnit) }))}
                  label={t("activitySessions.cpuTemperature")}
                  unit={tempUnitLabel(tempUnit)}
                  value={toDisplayTemp(session.metrics.avgCpuTemp, tempUnit)}
                  max={toDisplayTemp(session.metrics.avgCpuTemp + 10, tempUnit)}
                  thresholds={{ warn: tempThreshold(75, tempUnit), danger: tempThreshold(85, tempUnit) }}
                />

                <ActivitySparkline
                  data={sparklineData.gpuTemp.map((p) => ({ ...p, y: toDisplayTemp(p.y, tempUnit) }))}
                  label={t("activitySessions.gpuTemperature")}
                  unit={tempUnitLabel(tempUnit)}
                  value={toDisplayTemp(session.metrics.avgGpuTemp, tempUnit)}
                  max={toDisplayTemp(session.metrics.avgGpuTemp + 8, tempUnit)}
                  thresholds={{ warn: tempThreshold(75, tempUnit), danger: tempThreshold(85, tempUnit) }}
                />

                <ActivitySparkline
                  data={sparklineData.ram}
                  label={t("activitySessions.ramLoad")}
                  unit="%"
                  value={session.metrics.avgRamUsage}
                  max={Math.round(session.metrics.avgRamUsage * 1.15)}
                />

                <ActivitySparkline
                  data={sparklineData.fps}
                  label={t("activityPerf.fps")}
                  unit=""
                  value={session.metrics.avgFps}
                  max={session.metrics.maxFps}
                  min={session.metrics.minFps}
                  thresholds={{ warn: 60, danger: 30 }}
                  inverted
                />
              </div>

              {/* Performance Timeline Charts */}
              {chartProps && (
                <div className="activity-session-item__chart-section">
                  <div className="activity-session-item__chart-header">
                    <div className="activity-session-item__chart-title">
                      <Icons.BarChart3 size={12} />
                      {t("activitySessions.perfTimeline")}
                      {!chartProps.real && (
                        <span
                          className="activity-session-item__chart-estimated"
                          title={t("activitySessions.telemetryCurve")}
                        >
                          {t("activityPerf.estimated")}
                        </span>
                      )}
                    </div>
                    <div className="activity-session-item__chart-tabs">
                      {(["usage", "temps", "ram", "fps"] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          className={`activity-session-item__chart-tab-btn ${
                            activeChartTab === tab ? "activity-session-item__chart-tab-btn--active" : ""
                          }`}
                          onClick={() => setActiveChartTab(tab)}
                        >
                          {t(`activitySessions.tab${tab.charAt(0).toUpperCase()}${tab.slice(1)}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="activity-session-item__chart-container">
                    <LineChart
                      series={chartSeries}
                      labels={chartProps.labels}
                      formatValue={yValFormatter}
                      height={180}
                      legend={true}
                      {...chartExtra}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="activity-session-item__no-hardware">
              <Icons.Info size={16} />
              <div>{t("activitySessions.noHardwareLogs")}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ActivitySessions({
  sessions,
  games,
  onDeleteSession,
}: ActivitySessionsProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(15);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<GameSession | null>(null);

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sortedSessions;
    const q = searchQuery.toLowerCase();
    return sortedSessions.filter((s) => s.gameName.toLowerCase().includes(q));
  }, [sortedSessions, searchQuery]);

  const visibleSessions = useMemo(() => {
    return filteredSessions.slice(0, visibleCount);
  }, [filteredSessions, visibleCount]);

  return (
    <div className="section-panel">
      <div className="global-session-list__header">
        <h3 className="section-panel__title">
          {t("activitySessions.recentSessions")}
          <span className="activity-session-count">{filteredSessions.length}</span>
        </h3>
        <div className="global-session-list__actions">
          <div className="global-session-list__search">
            <Icons.Search size={12} className="global-session-list__search-icon" />
            <input
              type="text"
              className="global-session-list__search-input"
              placeholder={t("activitySessions.search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="global-session-list__refresh-btn"
            onClick={() => setVisibleCount(15)}
            title={t("activitySessions.resetView")}
            aria-label={t("activitySessions.resetView")}
          >
            <Icons.RotateCcw size={12} />
          </button>
        </div>
      </div>

      <div className="global-session-list__items">
        {visibleSessions.map((session) => {
          const game = games.find((g) => g.id === session.gameId);
          return (
            <ActivitySessionItem
              key={session.id}
              session={session}
              game={game}
              onRequestDelete={setPendingDeleteSession}
            />
          );
        })}

        {filteredSessions.length === 0 && (
          sessions.length === 0 ? (
            <div className="activity-empty">
              <div className="activity-empty__icon">
                <Icons.History size={24} />
              </div>
              <div className="activity-empty__title">{t("activitySessions.noSessions")}</div>
              <div className="activity-empty__hint">{t("activitySessions.noSessionsHint")}</div>
            </div>
          ) : (
            <div className="activity-empty activity-empty--compact">
              <div className="activity-empty__icon">
                <Icons.Search size={18} />
              </div>
              <div className="activity-empty__title">{t("activitySessions.noMatchQuery")}</div>
            </div>
          )
        )}

        {filteredSessions.length > visibleCount && (
          <button
            type="button"
            className="global-session-list__load-more"
            onClick={() => setVisibleCount((prev) => prev + 15)}
          >
            {t("activitySessions.loadMore")}
          </button>
        )}
      </div>

      {/* Confirmation modal for deleting session */}
      <ConfirmModal
        open={pendingDeleteSession !== null}
        title={t("gameActivity.deleteTitle")}
        message={t("gameActivity.deleteBody")}
        confirmLabel={t("gameActivity.deleteSession")}
        onCancel={() => setPendingDeleteSession(null)}
        onConfirm={() => {
          if (pendingDeleteSession) {
            onDeleteSession(pendingDeleteSession.id);
          }
          setPendingDeleteSession(null);
        }}
      />
    </div>
  );
}
