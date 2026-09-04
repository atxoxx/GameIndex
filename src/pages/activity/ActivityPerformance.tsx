import { useMemo, useState } from "react";
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
} from "../../components/activity";
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

export interface ActivityPerformanceProps {
  sessions: GameSession[];
  games: Game[];
  startDate: string;
  endDate: string;
  sourceFilter: string;
}

export function ActivityPerformance({
  sessions,
  games,
  startDate,
  endDate,
  sourceFilter,
}: ActivityPerformanceProps) {
  const { t } = useLanguage();
  const { totalRamGb, selectedGpu } = useActivity();
  const { tempUnit } = useSettings();
  const [metricTab, setMetricTab] = useState<ComparisonMetric>("fps");
  const [selectedGameFilter, setSelectedGameFilter] = useState<string>("all");
  const [compareModalOpen, setCompareModalOpen] = useState(false);

  const filteredSessions = useMemo(() => {
    let out = filterSessionsByWindow(sessions, startDate, endDate);
    out = filterSessionsBySource(out, games, sourceFilter);
    return out;
  }, [sessions, startDate, endDate, games, sourceFilter]);

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
              <strong>{selectedGpu.name}</strong> ({selectedGpu.vendor}) · {selectedGpu.vramMb} MB VRAM
              {totalRamGb > 0 ? ` · ${totalRamGb} GB System RAM` : ""}
            </span>
          </div>
          <div className="act-gpu-context-actions">
            {sessionsWithTelemetry.length >= 2 && (
              <button
                type="button"
                className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
                onClick={() => setCompareModalOpen(true)}
              >
                <Icons.ArrowRightLeft size={12} /> {t("activityCompare.compareBtn")}
              </button>
            )}
          </div>
        </div>
      )}

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

      <PerformanceComparison
        games={gameAverages}
        metricTab={metricTab}
        tempUnit={tempUnit}
        totalRamGb={totalRamGb}
        onMetricTabChange={setMetricTab}
      />

      <PerformanceBoard
        games={gameAverages}
        tempUnit={tempUnit}
        totalRamGb={totalRamGb}
        onSelectGame={(gameId) => setSelectedGameFilter(gameId)}
      />

      <PerformanceTimeline
        sessions={filteredSessions}
        gameAverages={gameAverages}
        tempUnit={tempUnit}
        totalRamGb={totalRamGb}
        initialSelectedGameId={selectedGameFilter}
      />

      <SessionComparisonModal
        isOpen={compareModalOpen}
        onClose={() => setCompareModalOpen(false)}
        sessions={filteredSessions}
      />
    </div>
  );
}
