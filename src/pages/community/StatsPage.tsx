import { useState, useMemo, useCallback } from "react";
import { useActivity } from "../../context/ActivityContext";
import { useAchievements } from "../../context/AchievementContext";
import { useGames } from "../../context/GameContext";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";

import { StatsHeader } from "./StatsHeader";
import { OverviewTab } from "./tabs/OverviewTab";
import { TrendsTab } from "./tabs/TrendsTab";
import { AchievementsTab } from "./tabs/AchievementsTab";
import { CapturesTab } from "./tabs/CapturesTab";
import { MilestonesTab } from "./tabs/MilestonesTab";

import {
  filterSessionsByTimeframe,
  computeGamerLevel,
  classifyGamerPersona,
  computeStreaks,
  computeTimeOfDay,
  buildHeatmap,
} from "./statsCalculations";
import {
  loadActiveSubtab,
  saveActiveSubtab,
  loadTimeframePreset,
  saveTimeframePreset,
  loadMonthlyGoal,
} from "./statsStorage";
import type { StatsSubtab, TimeframePreset } from "./statsTypes";

import "./StatsPage.css";

export default function StatsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { sessions } = useActivity();
  const { cache: achievementCache } = useAchievements();
  const { games } = useGames();
  const { hideAchievementProgress, isSimpleUi } = useSettings();

  // Persistent Active Tab & Timeframe
  const [activeTab, setActiveTab] = useState<StatsSubtab>(() => loadActiveSubtab());
  const [timeframe, setTimeframe] = useState<TimeframePreset>(() => loadTimeframePreset());

  const effectiveTab: StatsSubtab = isSimpleUi && (activeTab === "trends" || activeTab === "captures" || activeTab === "milestones")
    ? "overview"
    : activeTab;

  const handleTabChange = useCallback((tab: StatsSubtab) => {
    setActiveTab(tab);
    saveActiveSubtab(tab);
  }, []);

  const handleTimeframeChange = useCallback((tf: TimeframePreset) => {
    setTimeframe(tf);
    saveTimeframePreset(tf);
  }, []);

  // Filtered sessions based on timeframe
  const filteredSessions = useMemo(() => {
    return filterSessionsByTimeframe(sessions, timeframe);
  }, [sessions, timeframe]);

  // Overall calculations
  const totalPlaytimeMin = useMemo(() => filteredSessions.reduce((s, x) => s + x.durationMin, 0), [filteredSessions]);
  const totalSessionsCount = filteredSessions.length;
  const streakInfo = useMemo(() => computeStreaks(sessions), [sessions]);
  const timeOfDay = useMemo(() => computeTimeOfDay(filteredSessions), [filteredSessions]);
  const heatmap = useMemo(() => buildHeatmap(filteredSessions, 16), [filteredSessions]);

  // Total unlocked achievements count
  const totalAchievementsUnlocked = useMemo(() => {
    let unl = 0;
    for (const gid of Object.keys(achievementCache.games)) {
      unl += achievementCache.games[gid].unlocked;
    }
    return unl;
  }, [achievementCache]);

  // Genre breakdown
  const genreBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    const gameById = new Map(games.map((g) => [g.id, g]));
    for (const s of filteredSessions) {
      const g = gameById.get(s.gameId);
      const genre = g?.genres?.[0] || "Uncategorized";
      map.set(genre, (map.get(genre) || 0) + s.durationMin);
    }
    return Array.from(map.entries())
      .map(([genre, minutes]) => ({ genre, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [filteredSessions, games]);

  // Gamer Level & Persona
  const levelInfo = useMemo(
    () => computeGamerLevel(totalPlaytimeMin, totalSessionsCount, totalAchievementsUnlocked, games.length),
    [totalPlaytimeMin, totalSessionsCount, totalAchievementsUnlocked, games.length]
  );

  const persona = useMemo(
    () => classifyGamerPersona(filteredSessions, games, genreBreakdown, timeOfDay),
    [filteredSessions, games, genreBreakdown, timeOfDay]
  );

  // Initial Monthly Goal
  const initialGoalMin = useMemo(() => loadMonthlyGoal(), []);

  // Export JSON Report
  const handleExportJson = useCallback(() => {
    const report = {
      exportedAt: new Date().toISOString(),
      persona: {
        id: persona.id,
        level: levelInfo.level,
        title: levelInfo.title,
        totalXp: levelInfo.totalXp,
      },
      summary: {
        totalPlaytimeMinutes: totalPlaytimeMin,
        totalSessions: totalSessionsCount,
        gamesInLibrary: games.length,
        currentStreak: streakInfo.current,
        longestStreak: streakInfo.longest,
      },
      genres: genreBreakdown,
      sessions: filteredSessions.map((s) => ({
        gameName: s.gameName,
        date: s.date,
        durationMinutes: s.durationMin,
      })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gameindex_stats_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t("stats.exportSuccess") || "Statistics report exported as JSON", "success");
  }, [persona, levelInfo, totalPlaytimeMin, totalSessionsCount, games.length, streakInfo, genreBreakdown, filteredSessions, showToast, t]);

  return (
    <div className="stats-page-container">
      {/* ── Hero Cockpit Banner ──────────────────────────────────── */}
      <StatsHeader
        levelInfo={levelInfo}
        persona={persona}
        streak={streakInfo}
        totalPlaytimeMin={totalPlaytimeMin}
        totalSessions={totalSessionsCount}
        totalGames={games.length}
        timeframe={timeframe}
        onTimeframeChange={handleTimeframeChange}
        onExportJson={handleExportJson}
      />

      {/* ── Subtab Navigation Bar ────────────────────────────────── */}
      <div className="stats-subtab-bar" role="tablist" aria-label={t("stats.tabsLabel")}>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === "overview"}
          className={`stats-subtab-btn${effectiveTab === "overview" ? " active" : ""}`}
          onClick={() => handleTabChange("overview")}
        >
          <span className="stats-subtab-icon">📊</span>
          <span>{t("stats.tab.overview")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === "trends"}
          className={`stats-subtab-btn ui-complete-only${effectiveTab === "trends" ? " active" : ""}`}
          onClick={() => handleTabChange("trends")}
        >
          <span className="stats-subtab-icon">📈</span>
          <span>{t("stats.tab.trends")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === "achievements"}
          className={`stats-subtab-btn${effectiveTab === "achievements" ? " active" : ""}`}
          onClick={() => handleTabChange("achievements")}
        >
          <span className="stats-subtab-icon">🏆</span>
          <span>{t("stats.tab.achievements")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === "captures"}
          className={`stats-subtab-btn ui-complete-only${effectiveTab === "captures" ? " active" : ""}`}
          onClick={() => handleTabChange("captures")}
        >
          <span className="stats-subtab-icon">📸</span>
          <span>{t("stats.tab.captures")}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === "milestones"}
          className={`stats-subtab-btn ui-complete-only${effectiveTab === "milestones" ? " active" : ""}`}
          onClick={() => handleTabChange("milestones")}
        >
          <span className="stats-subtab-icon">🎖️</span>
          <span>{t("stats.tab.milestones")}</span>
        </button>
      </div>

      {/* ── Subtab Content Panels ────────────────────────────────── */}
      <main className="stats-main-content">
        {effectiveTab === "overview" && (
          <OverviewTab
            sessions={filteredSessions}
            games={games}
            achievementCache={achievementCache.games}
            initialGoalMin={initialGoalMin}
            hideAchievementProgress={hideAchievementProgress}
          />
        )}

        {effectiveTab === "trends" && (
          <TrendsTab
            sessions={filteredSessions}
            games={games}
          />
        )}

        {effectiveTab === "achievements" && (
          <AchievementsTab
            achievementCache={achievementCache.games}
            games={games}
            hideAchievementProgress={hideAchievementProgress}
          />
        )}

        {effectiveTab === "captures" && (
          <CapturesTab
            games={games}
          />
        )}

        {effectiveTab === "milestones" && (
          <MilestonesTab
            sessions={filteredSessions}
            games={games}
            heatmapCells={heatmap.cells}
            genreBreakdown={genreBreakdown}
            totalAchievementsUnlocked={totalAchievementsUnlocked}
          />
        )}
      </main>
    </div>
  );
}
