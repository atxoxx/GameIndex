import { useMemo, useState } from "react";
import type { Game, GameSession } from "../../types/game";
import { useActivity } from "../../context/ActivityContext";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import * as Icons from "./Icons";
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
  /** Shared toolbar date window (ISO "YYYY-MM-DD" strings). */
  startDate: string;
  endDate: string;
  /** Shared toolbar platform/source filter ("all" disables it). */
  sourceFilter: string;
}

/**
 * Activity → Performance tab.
 *
 * Layout (top → bottom):
 *   1. Overview KPI strip   — avg FPS, tracked sessions, best performer,
 *                             hottest temp, avg RAM.
 *   2. Game comparisons     — top-8 horizontal bars switchable between
 *                             FPS / temperatures / RAM.
 *   3. Detailed board       — sortable per-game table with FPS range.
 *   4. Session timeline     — per-metric sparkline cards + the four trend
 *                             charts, drillable to a game or a single session.
 *
 * The tab honours the shared Activity toolbar filters (date window + platform),
 * so a "Last 7 days" selection here reflects the same sessions as Dashboard
 * and Timeline. Every aggregation lives in `./performance/perfData.ts`.
 */
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

  // Apply the shared toolbar filters first, so every panel below reasons
  // about the same, scoped session set.
  const filteredSessions = useMemo(() => {
    let out = filterSessionsByWindow(sessions, startDate, endDate);
    out = filterSessionsBySource(out, games, sourceFilter);
    return out;
  }, [sessions, startDate, endDate, games, sourceFilter]);

  const gameAverages = useMemo(
    () => buildGameAverages(filteredSessions, games),
    [filteredSessions, games]
  );

  const overview = useMemo(
    () => buildOverview(filteredSessions, gameAverages),
    [filteredSessions, gameAverages]
  );

  const hasTelemetry = useMemo(
    () => filteredSessions.some(hasAnyMetrics),
    [filteredSessions]
  );

  if (!hasTelemetry || gameAverages.length === 0) {
    return (
      <div className="section-panel">
        <h3 className="section-panel__title">{t("activityPerf.performanceInsights")}</h3>
        <div className="activity-empty">
          <div className="activity-empty__icon">
            <Icons.Cpu size={24} />
          </div>
          <div className="activity-empty__title">{t("activityPerf.noTelemetry")}</div>
          <div className="activity-empty__hint">
            {t("activityPerf.enableMonitoringHint")}
            {sessions.length > 0 && filteredSessions.length === 0 && (
              <>
                {" "}
                <br />
                {t("activityPerf.noTelemetryInRange")}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="performance-insights">
      <PerformanceOverview overview={overview} totalRamGb={totalRamGb} tempUnit={tempUnit} />

      <PerformanceComparison
        games={gameAverages}
        metricTab={metricTab}
        tempUnit={tempUnit}
        totalRamGb={totalRamGb}
        onMetricTabChange={setMetricTab}
      />

      <PerformanceBoard games={gameAverages} tempUnit={tempUnit} totalRamGb={totalRamGb} />

      <PerformanceTimeline
        sessions={filteredSessions}
        gameAverages={gameAverages}
        tempUnit={tempUnit}
        totalRamGb={totalRamGb}
      />
    </div>
  );
}
