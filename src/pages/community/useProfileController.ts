import { useCallback, useMemo, useState } from "react";
import { useActivity } from "../../context/ActivityContext";
import { useAchievements } from "../../context/AchievementContext";
import { useGames } from "../../context/GameContext";
import { useSettings, useWidgetVisible } from "../../context/SettingsContext";
import {
  computeGamerLevel,
  computeStreaks,
  computeTimeOfDay,
  classifyGamerPersona,
  filterSessionsByTimeframe,
} from "./statsCalculations";
import {
  loadActiveSubtab,
  loadCustomFolders,
  loadScreenshotCache,
  loadTimeframePreset,
  saveActiveSubtab,
  saveTimeframePreset,
} from "./statsStorage";
import type { GameSession, StatsSubtab, TimeframePreset } from "./statsTypes";

export interface ProfileTotals {
  playtimeMin: number;
  sessionCount: number;
  libraryCount: number;
  playedGames: number;
  achievementUnlocked: number;
  achievementTotal: number;
  achievementPct: number | null;
  captureCount: number;
}

/** Captures known from the last scan — enough for the tab count without
 *  re-walking the filesystem on every visit to the profile. */
function countCachedCaptures(): number {
  let total = 0;
  for (const group of loadScreenshotCache()) total += group.screenshots.length;
  for (const folder of loadCustomFolders()) total += folder.media.length;
  return total;
}

function countPlayedGames(sessions: GameSession[]): number {
  const ids = new Set<string>();
  for (const session of sessions) ids.add(session.gameId);
  return ids.size;
}

/**
 * One state owner for the profile page: the selected tab, the date range
 * every tab shares, and the derived figures the header and Overview read.
 *
 * Keeping this out of the page component means the tabs stay presentational
 * and the range is applied exactly once — a filter can no longer disagree
 * with the header's own totals.
 */
export function useProfileController() {
  const { sessions } = useActivity();
  const { summaries, rarestUnlocks, recentUnlocks } = useAchievements();
  const { games } = useGames();
  const { hideAchievementProgress, isSimpleUi } = useSettings();
  const subtabsVisible = useWidgetVisible("community", "subtabs");

  const [activeTab, setActiveTab] = useState<StatsSubtab>(() => loadActiveSubtab());
  const [range, setRange] = useState<TimeframePreset>(() => loadTimeframePreset());
  const [captureCount, setCaptureCount] = useState<number>(() => countCachedCaptures());

  const changeTab = useCallback((tab: StatsSubtab) => {
    setActiveTab(tab);
    saveActiveSubtab(tab);
  }, []);

  const changeRange = useCallback((next: TimeframePreset) => {
    setRange(next);
    saveTimeframePreset(next);
  }, []);

  // Simple UI keeps the profile to its two core views rather than exposing
  // the analysis and gallery surfaces. Turning the subtab widget off hides
  // the same two tabs.
  const showSecondaryTabs = subtabsVisible && !isSimpleUi;
  const effectiveTab: StatsSubtab =
    !showSecondaryTabs && (activeTab === "insights" || activeTab === "gallery")
      ? "overview"
      : activeTab;

  const filteredSessions = useMemo(
    () => filterSessionsByTimeframe(sessions, range),
    [sessions, range]
  );

  const achievementCounts = useMemo(() => {
    let unlocked = 0;
    let total = 0;
    for (const gameId of Object.keys(summaries)) {
      unlocked += summaries[gameId].unlocked;
      total += summaries[gameId].total;
    }
    return { unlocked, total };
  }, [summaries]);

  const achievementPct =
    achievementCounts.total > 0
      ? Math.round((achievementCounts.unlocked / achievementCounts.total) * 100)
      : null;

  const playtimeMin = useMemo(
    () => filteredSessions.reduce((sum, session) => sum + session.durationMin, 0),
    [filteredSessions]
  );

  const totals: ProfileTotals = useMemo(
    () => ({
      playtimeMin,
      sessionCount: filteredSessions.length,
      libraryCount: games.length,
      playedGames: countPlayedGames(filteredSessions),
      achievementUnlocked: achievementCounts.unlocked,
      achievementTotal: achievementCounts.total,
      achievementPct,
      captureCount,
    }),
    [
      playtimeMin,
      filteredSessions.length,
      games.length,
      achievementCounts,
      achievementPct,
      captureCount,
    ]
  );

  // The streak and level are lifetime figures: a "current streak" or a
  // demoted level whenever the user picks a 30-day range would read as a bug.
  const streak = useMemo(() => computeStreaks(sessions), [sessions]);

  const lifetimePlaytime = useMemo(
    () => sessions.reduce((sum, session) => sum + session.durationMin, 0),
    [sessions]
  );

  const levelInfo = useMemo(
    () =>
      computeGamerLevel(
        lifetimePlaytime,
        sessions.length,
        achievementCounts.unlocked,
        games.length
      ),
    [lifetimePlaytime, sessions.length, achievementCounts.unlocked, games.length]
  );

  const genreBreakdown = useMemo(() => {
    const gameById = new Map(games.map((game) => [game.id, game]));
    const byGenre = new Map<string, number>();
    for (const session of filteredSessions) {
      const game = gameById.get(session.gameId);
      const genre = game?.genres?.[0] || "Uncategorized";
      byGenre.set(genre, (byGenre.get(genre) || 0) + session.durationMin);
    }
    return Array.from(byGenre.entries())
      .map(([genre, minutes]) => ({ genre, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [filteredSessions, games]);

  const timeOfDay = useMemo(() => computeTimeOfDay(filteredSessions), [filteredSessions]);

  const persona = useMemo(
    () => classifyGamerPersona(filteredSessions, games, genreBreakdown, timeOfDay),
    [filteredSessions, games, genreBreakdown, timeOfDay]
  );

  return {
    // state
    activeTab: effectiveTab,
    range,
    changeTab,
    changeRange,
    // context
    games,
    sessions,
    summaries,
    rarestUnlocks,
    recentUnlocks,
    hideAchievementProgress,
    subtabsVisible,
    showSecondaryTabs,
    // derived
    filteredSessions,
    totals,
    streak,
    levelInfo,
    persona,
    genreBreakdown,
    timeOfDay,
    setCaptureCount,
  };
}

export type ProfileController = ReturnType<typeof useProfileController>;
