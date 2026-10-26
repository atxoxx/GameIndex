import { useEffect, useMemo, useState } from "react";
import { formatPlayTime, type Game, type GameSession } from "../../types/game";
import { useActivity } from "../../context/ActivityContext";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import * as Icons from "./Icons";
import {
  SectionPanel,
  EmptyState,
  SessionComparisonModal,
  buildResolutionBreakdown,
} from ".";
import {
  buildGameAverages,
  buildOverview,
  filterSessionsBySource,
  filterSessionsByWindow,
  hasAnyMetrics,
} from "./performance/perfData";
import { PerformanceOverview } from "./performance/PerformanceOverview";
import { PerformanceComparison, type ComparisonMetric } from "./performance/PerformanceComparison";
import { PerformanceBoard } from "./performance/PerformanceBoard";
import { PerformanceTimeline } from "./performance/PerformanceTimeline";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Button } from "../ui";
import "../../styles/activity-performance.css";

export interface ActivityPerformanceProps {
  sessions: GameSession[];
  games: Game[];
  startDate: string;
  endDate: string;
  sourceFilter: string;
  /** Library shows the cross-game compare/board sections; a game's tab does not. */
  mode?: "library" | "game";
}

type PerfSection = "overview" | "compare" | "board" | "timeline";

export function ActivityPerformance({
  sessions,
  games,
  startDate,
  endDate,
  sourceFilter,
  mode = "library",
}: ActivityPerformanceProps) {
  const { t } = useLanguage();
  const { totalRamGb, selectedGpu, ensureSamplesFor } = useActivity();
  const { tempUnit } = useSettings();
  const [metricTab, setMetricTab] = usePersistedState<ComparisonMetric>("gamelib.activity.performance.metric_tab_v1", "fps", ["fps", "temps", "ram"]);
  const [perfSection, setPerfSection] = usePersistedState<PerfSection>(
    "gamelib.activity.performance.section_v1",
    "overview",
    ["overview", "compare", "board", "timeline"],
  );
  const [selectedGameFilter, setSelectedGameFilter] = useState<string>("all");
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const isGameMode = mode === "game";
  const section: PerfSection =
    isGameMode && (perfSection === "compare" || perfSection === "board")
      ? "overview"
      : perfSection;

  const filteredSessions = useMemo(() => {
    let out = filterSessionsByWindow(sessions, startDate, endDate);
    out = filterSessionsBySource(out, games, sourceFilter);
    return out;
  }, [sessions, startDate, endDate, games, sourceFilter]);

  // The performance views chart measured curves across the filtered window,
  // so hydrate their samples on demand.
  useEffect(() => {
    void ensureSamplesFor(filteredSessions.map((s) => s.id));
  }, [filteredSessions, ensureSamplesFor]);

  const gameAverages = useMemo(
    () => buildGameAverages(filteredSessions, games, t("activityDash.unknownGame")),
    [filteredSessions, games, t],
  );

  const overview = useMemo(
    () => buildOverview(filteredSessions, gameAverages),
    [filteredSessions, gameAverages],
  );

  const hasTelemetry = useMemo(
    () => filteredSessions.some(hasAnyMetrics),
    [filteredSessions],
  );

  if (!hasTelemetry || gameAverages.length === 0) {
    return (
      <SectionPanel
        icon={<Icons.Cpu size={14} />}
        title={t("activityPerf.performanceInsights")}
      >
        <EmptyState
          icon={<Icons.Cpu size={24} />}
          title={t("activityPerf.noTelemetry")}
          hint={
            <>
              {t("activityPerf.enableMonitoringHint")}
              {sessions.length > 0 && filteredSessions.length === 0 && (
                <>
                  {" "}
                  <br />
                  {t("activityPerf.noTelemetryInRange")}
                </>
              )}
            </>
          }
        />
      </SectionPanel>
    );
  }

  const resolutionBreakdown = useMemo(() => {
    return buildResolutionBreakdown(filteredSessions);
  }, [filteredSessions]);

  const sessionsWithTelemetry = useMemo(() => {
    return filteredSessions.filter((s) => s.metrics && s.metrics.avgFps > 0);
  }, [filteredSessions]);

  return (
    <div className="performance-insights">
      {selectedGpu && (
        <div className="act-gpu-context-banner">
          <div className="act-gpu-context-info">
            <Icons.Cpu size={14} className="act-gpu-context-icon" />
            <span className="act-gpu-context-text">
                  <strong>{selectedGpu.name}</strong>
                  <span className="act-gpu-context-vendor">({selectedGpu.vendor})</span>
                  <span className="act-gpu-context-spec">{selectedGpu.vramMb} MB VRAM</span>
                  {totalRamGb > 0 && (
                    <span className="act-gpu-context-spec">{totalRamGb} GB System RAM</span>
                  )}
                </span>
          </div>
          <div className="act-gpu-context-actions">
            {sessionsWithTelemetry.length >= 2 && (
              <Button variant="secondary" size="sm"
                type="button"
                
                onClick={() => setCompareModalOpen(true)}
              > <Icons.ArrowRightLeft size={12} /> {t("activityCompare.compareBtn")} </Button>
            )}
          </div>
        </div>
      )}

      <nav className="actv-subtabs" role="tablist" aria-label={t("activity.tab.performance")}>
        {(
          [
            { id: "overview" as const, label: t("activityPerf.performanceInsights"), Icon: Icons.Gauge },
            ...(isGameMode
              ? []
              : [
                  {
                    id: "compare" as const,
                    label: t("activityPerf.gameComparisons"),
                    Icon: Icons.ArrowRightLeft,
                    count: gameAverages.length,
                  },
                  {
                    id: "board" as const,
                    label: t("activityPerf.detailedBoard"),
                    Icon: Icons.Trophy,
                  },
                ]),
            {
              id: "timeline" as const,
              label: t("activityPerf.sessionTimeline"),
              Icon: Icons.TrendingUp,
              count: filteredSessions.length,
            },
          ] as const
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={section === entry.id}
            className={`actv-subtab${section === entry.id ? " is-active" : ""}`}
            onClick={() => setPerfSection(entry.id)}
          >
            <entry.Icon size={13} />
            <span>{entry.label}</span>
            {"count" in entry && entry.count !== undefined && entry.count > 0 && (
              <span className="actv-tab-count">{entry.count}</span>
            )}
          </button>
        ))}
      </nav>

      {section === "overview" && (
        <>
          <PerformanceOverview
            overview={overview}
            gameAverages={gameAverages}
            totalRamGb={totalRamGb}
            tempUnit={tempUnit}
          />

          {resolutionBreakdown.length > 0 && (
            <SectionPanel
              icon={<Icons.Monitor size={14} />}
              title={t("activityInsights.resolutionBreakdown")}
            >
              <div className="act-resolution-grid">
                {resolutionBreakdown.map((item) => (
                  <div key={item.resolution} className="act-resolution-card">
                    <div className="act-resolution-card__header">
                      <span className="act-resolution-card__tag">{item.resolution}</span>
                      <span className="act-resolution-card__count">
                        {item.sessionsCount} {item.sessionsCount === 1 ? t("activity.sessionOne") : t("activity.sessionsMany")}
                      </span>
                    </div>
                    <div className="act-resolution-card__body">
                      <div className="act-resolution-card__stat">
                        <span className="act-resolution-card__stat-lbl">{t("activityPerf.avgFps")}</span>
                        <span className="act-resolution-card__stat-val">{item.avgFps}</span>
                      </div>
                      <div className="act-resolution-card__stat">
                        <span className="act-resolution-card__stat-lbl">{t("activity.duration")}</span>
                        <span className="act-resolution-card__stat-val">{formatPlayTime(item.minutes)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SectionPanel>
          )}
        </>
      )}

      {section === "compare" && (
        <PerformanceComparison
          games={gameAverages}
          metricTab={metricTab}
          tempUnit={tempUnit}
          totalRamGb={totalRamGb}
          onMetricTabChange={setMetricTab}
        />
      )}

      {section === "board" && (
        <PerformanceBoard
          games={gameAverages}
          tempUnit={tempUnit}
          totalRamGb={totalRamGb}
          onSelectGame={(gameId) => setSelectedGameFilter(gameId)}
        />
      )}

      {section === "timeline" && (
        <PerformanceTimeline
          sessions={filteredSessions}
          gameAverages={gameAverages}
          tempUnit={tempUnit}
          totalRamGb={totalRamGb}
          initialSelectedGameId={selectedGameFilter}
        />
      )}

      <SessionComparisonModal
        isOpen={compareModalOpen}
        onClose={() => setCompareModalOpen(false)}
        sessions={filteredSessions}
      />
    </div>
  );
}
