import { useMemo, useState } from "react";
import type { Game, GameSession } from "../../types/game";
import { useActivity } from "../../context/ActivityContext";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import * as Icons from "./Icons";
import { SectionPanel, EmptyState } from "../../components/activity";
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
  const { totalRamGb } = useActivity();
  const { tempUnit } = useSettings();
  const [metricTab, setMetricTab] = useState<ComparisonMetric>("fps");
  const [selectedGameFilter, setSelectedGameFilter] = useState<string>("all");

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

  return (
    <div className="performance-insights">
      <PerformanceOverview
        overview={overview}
        gameAverages={gameAverages}
        totalRamGb={totalRamGb}
        tempUnit={tempUnit}
      />

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
    </div>
  );
}
