// Analytical pure functions for the Statistics page and subtabs.

import type { Game, GameSession, GameAchievementData } from "../../types/game";
import type {
  DayCell,
  StreakInfo,
  TimeOfDayKey,
  TimeOfDaySlice,
  PeriodCompare,
  WeekdaySplit,
  MonthlyTrendItem,
  GoalPace,
  GamerLevelInfo,
  GamerPersona,
  HabitCell,
  SessionLengthBucket,
  LibraryHealthStats,
  PerformanceStats,
  PersonalRecords,
  MilestoneItem,
  PerfectGame,
  NearCompletionGame,
  RarestAchievement,
  UnlockedAchievementItem,
} from "./statsTypes";

const TOD_PALETTE = [
  "var(--color-info)",
  "var(--color-accent)",
  "var(--color-warning)",
  "var(--color-success)",
];

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Filter sessions by timeframe preset ───────────────────────────
export function filterSessionsByTimeframe(
  sessions: GameSession[],
  timeframe: "all" | "year" | "90d" | "30d"
): GameSession[] {
  if (timeframe === "all") return sessions;
  const now = new Date();
  let cutoff: Date;

  if (timeframe === "year") {
    cutoff = new Date(now.getFullYear(), 0, 1);
  } else if (timeframe === "90d") {
    cutoff = new Date(now.getTime() - 90 * 86400000);
  } else {
    // 30d
    cutoff = new Date(now.getTime() - 30 * 86400000);
  }

  return sessions.filter((s) => new Date(s.date) >= cutoff);
}

// ── Heatmap generation (52 weeks or 7 weeks aligned to Mon-Sun) ────
export function buildHeatmap(
  sessions: GameSession[],
  weeksCount = 16
): {
  cells: DayCell[];
  maxMinutes: number;
  activeDays: number;
  totalMinutes: number;
  weeksCount: number;
} {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const d = new Date(s.date);
    const k = dayKey(d);
    byDay.set(k, (byDay.get(k) || 0) + s.durationMin);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalDays = weeksCount * 7;
  const cells: DayCell[] = [];
  const cursor = new Date(today);
  const dayOfWeek = (cursor.getDay() + 6) % 7; // Mon = 0 ... Sun = 6
  const backDays = totalDays - 1 - (6 - dayOfWeek);
  cursor.setDate(cursor.getDate() - backDays);

  let maxMinutes = 0;
  let activeDays = 0;
  let totalMinutes = 0;

  for (let i = 0; i < totalDays; i++) {
    const k = dayKey(cursor);
    const minutes = byDay.get(k) || 0;
    if (minutes > 0) {
      activeDays++;
      totalMinutes += minutes;
      if (minutes > maxMinutes) maxMinutes = minutes;
    }
    cells.push({ date: new Date(cursor), minutes, key: k });
    cursor.setDate(cursor.getDate() + 1);
  }

  return { cells, maxMinutes, activeDays, totalMinutes, weeksCount };
}

// ── Daily Streaks ─────────────────────────────────────────────────
export function computeStreaks(sessions: GameSession[]): StreakInfo {
  const playedDays = new Set<string>();
  for (const s of sessions) {
    playedDays.add(dayKey(new Date(s.date)));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dayKey(today);
  const playedToday = playedDays.has(todayKey);

  const sorted = Array.from(playedDays).sort();
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;

  for (const k of sorted) {
    const d = new Date(k + "T00:00:00");
    if (prev) {
      const diff = Math.round((d.getTime() - prev.getTime()) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = d;
  }

  let current = 0;
  const cursor = new Date(today);
  if (!playedDays.has(todayKey)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (playedDays.has(dayKey(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, longest: Math.max(longest, current), playedToday };
}

// ── Time of Day ───────────────────────────────────────────────────
export function computeTimeOfDay(sessions: GameSession[]): TimeOfDaySlice[] {
  const buckets = [0, 0, 0, 0]; // Night (0-6), Morning (6-12), Afternoon (12-18), Evening (18-24)
  for (const s of sessions) {
    const h = new Date(s.date).getHours();
    const idx = Math.min(3, Math.floor(h / 6));
    buckets[idx] += s.durationMin;
  }
  const keys: TimeOfDayKey[] = ["night", "morning", "afternoon", "evening"];
  return keys.map((key, i) => ({
    key,
    minutes: buckets[i],
    color: TOD_PALETTE[i],
  }));
}

// ── Period Comparison (This month vs Last month) ──────────────────
export function computePeriodCompare(sessions: GameSession[]): PeriodCompare {
  const now = new Date();
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  let thisMonthMin = 0;
  let lastMonthMin = 0;
  for (const s of sessions) {
    const d = new Date(s.date);
    if (d >= thisStart) thisMonthMin += s.durationMin;
    else if (d >= lastStart && d <= lastEnd) lastMonthMin += s.durationMin;
  }

  const deltaMin = thisMonthMin - lastMonthMin;
  const pct =
    lastMonthMin > 0
      ? Math.round((deltaMin / lastMonthMin) * 100)
      : thisMonthMin > 0
      ? 100
      : 0;

  return { thisMonthMin, lastMonthMin, deltaMin, pct };
}

// ── Weekday Split ─────────────────────────────────────────────────
export function computeWeekdaySplit(sessions: GameSession[]): WeekdaySplit {
  const minutes = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) {
    const day = new Date(s.date).getDay(); // 0 = Sun ... 6 = Sat
    minutes[(day + 6) % 7] += s.durationMin;
  }

  let favoriteIndex = -1;
  let maxMinutes = 0;
  let totalMinutes = 0;
  minutes.forEach((m, i) => {
    totalMinutes += m;
    if (m > maxMinutes) {
      maxMinutes = m;
      favoriteIndex = i;
    }
  });

  return { minutes, totalMinutes, maxMinutes, favoriteIndex };
}

// ── Monthly Trend Progression ─────────────────────────────────────
export function computeMonthlyTrend(
  sessions: GameSession[],
  months = 6
): MonthlyTrendItem[] {
  const now = new Date();
  const out: MonthlyTrendItem[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    let mins = 0;
    let count = 0;

    for (const s of sessions) {
      const d = new Date(s.date);
      if (d >= monthStart && d < monthEnd) {
        mins += s.durationMin;
        count++;
      }
    }

    out.push({
      label: monthStart.toLocaleDateString(undefined, { month: "short" }),
      minutes: mins,
      sessions: count,
    });
  }

  return out;
}

// ── Weekly Trend Progression ──────────────────────────────────────
export function computeWeeklyTrend(
  sessions: GameSession[],
  weeks = 8
): { label: string; minutes: number; sessions: number }[] {
  const now = new Date();
  const out: { label: string; minutes: number; sessions: number }[] = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 86400000);
    const start = new Date(end.getTime() - 7 * 86400000);
    let mins = 0;
    let count = 0;

    for (const s of sessions) {
      const d = new Date(s.date);
      if (d >= start && d < end) {
        mins += s.durationMin;
        count++;
      }
    }

    out.push({
      label: `W-${i === 0 ? "Now" : i}`,
      minutes: mins,
      sessions: count,
    });
  }

  return out;
}

// ── Monthly Goal Pace ─────────────────────────────────────────────
export function computeMonthToDate(sessions: GameSession[]): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return sessions
    .filter((s) => new Date(s.date) >= start)
    .reduce((sum, s) => sum + s.durationMin, 0);
}

export function computeGoalPace(
  currentMin: number,
  goalMin: number
): GoalPace | null {
  if (goalMin <= 0) return null;
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expectedMin = (goalMin * dayOfMonth) / daysInMonth;
  return { expectedMin, diffMin: currentMin - expectedMin };
}

// ── 24/7 Gaming Habit Matrix (7 days x 24 hours) ──────────────────
export function computeHabitMatrix(sessions: GameSession[]): {
  cells: HabitCell[];
  maxMinutes: number;
} {
  // 7 rows (Mon-Sun) x 24 columns (0-23h)
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxMinutes = 0;

  for (const s of sessions) {
    const d = new Date(s.date);
    const day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
    const hour = d.getHours();
    matrix[day][hour] += s.durationMin;
    if (matrix[day][hour] > maxMinutes) {
      maxMinutes = matrix[day][hour];
    }
  }

  const cells: HabitCell[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    for (let hour = 0; hour < 24; hour++) {
      const minutes = matrix[dayIndex][hour];
      let intensity = 0;
      if (minutes > 0 && maxMinutes > 0) {
        const ratio = minutes / maxMinutes;
        if (ratio > 0.75) intensity = 4;
        else if (ratio > 0.5) intensity = 3;
        else if (ratio > 0.25) intensity = 2;
        else intensity = 1;
      }
      cells.push({ dayIndex, hour, minutes, intensity });
    }
  }

  return { cells, maxMinutes };
}

// ── Session Duration Buckets ──────────────────────────────────────
export function computeSessionLengthBuckets(sessions: GameSession[]): SessionLengthBucket[] {
  let quickCount = 0, quickMin = 0;
  let casualCount = 0, casualMin = 0;
  let deepCount = 0, deepMin = 0;
  let marathonCount = 0, marathonMin = 0;
  const total = sessions.length;

  for (const s of sessions) {
    const min = s.durationMin;
    if (min < 30) {
      quickCount++;
      quickMin += min;
    } else if (min < 60) {
      casualCount++;
      casualMin += min;
    } else if (min < 120) {
      deepCount++;
      deepMin += min;
    } else {
      marathonCount++;
      marathonMin += min;
    }
  }

  return [
    {
      key: "quick",
      labelKey: "stats.sessionBucket.quick",
      rangeKey: "< 30m",
      count: quickCount,
      minutes: quickMin,
      percentage: total > 0 ? Math.round((quickCount / total) * 100) : 0,
      color: "var(--color-info)",
    },
    {
      key: "casual",
      labelKey: "stats.sessionBucket.casual",
      rangeKey: "30m – 1h",
      count: casualCount,
      minutes: casualMin,
      percentage: total > 0 ? Math.round((casualCount / total) * 100) : 0,
      color: "var(--color-success)",
    },
    {
      key: "deep",
      labelKey: "stats.sessionBucket.deep",
      rangeKey: "1h – 2h",
      count: deepCount,
      minutes: deepMin,
      percentage: total > 0 ? Math.round((deepCount / total) * 100) : 0,
      color: "var(--color-accent)",
    },
    {
      key: "marathon",
      labelKey: "stats.sessionBucket.marathon",
      rangeKey: "2h+",
      count: marathonCount,
      minutes: marathonMin,
      percentage: total > 0 ? Math.round((marathonCount / total) * 100) : 0,
      color: "var(--color-warning)",
    },
  ];
}

// ── Library Health & Backlog Ratio ────────────────────────────────
export function computeLibraryHealth(games: Game[], sessions: GameSession[]): LibraryHealthStats {
  const playedGameIds = new Set(sessions.map((s) => s.gameId));
  let unplayed = 0;
  let inProgress = 0;
  let completed = 0;
  let mastered = 0;

  for (const g of games) {
    if (g.playStatus === "completed") {
      completed++;
    } else if (g.playStatus === "playing" || playedGameIds.has(g.id)) {
      inProgress++;
    } else {
      unplayed++;
    }
  }

  const total = games.length;
  const finished = completed + mastered;
  const completionRate = total > 0 ? Math.round((finished / total) * 100) : 0;
  const unplayedRate = total > 0 ? Math.round((unplayed / total) * 100) : 0;

  return {
    unplayed,
    inProgress,
    completed,
    mastered,
    total,
    completionRate,
    unplayedRate,
  };
}

// ── Performance & Telemetry Summary ───────────────────────────────
export function computePerformanceStats(sessions: GameSession[], games: Game[]): PerformanceStats {
  let fpsSum = 0;
  let fpsCount = 0;
  let cpuSum = 0;
  let gpuSum = 0;
  let ramSum = 0;
  let cpuTempSum = 0;
  let gpuTempSum = 0;
  let metricSessions = 0;

  const gameFpsMap = new Map<string, { totalFps: number; count: number; name: string }>();

  for (const s of sessions) {
    if (s.metrics) {
      metricSessions++;
      if (typeof s.metrics.avgFps === "number" && s.metrics.avgFps > 0) {
        fpsSum += s.metrics.avgFps;
        fpsCount++;

        const cur = gameFpsMap.get(s.gameId) || { totalFps: 0, count: 0, name: s.gameName };
        cur.totalFps += s.metrics.avgFps;
        cur.count++;
        gameFpsMap.set(s.gameId, cur);
      }
      if (typeof s.metrics.avgCpuUsage === "number") cpuSum += s.metrics.avgCpuUsage;
      if (typeof s.metrics.avgGpuUsage === "number") gpuSum += s.metrics.avgGpuUsage;
      if (typeof s.metrics.avgRamUsage === "number") ramSum += s.metrics.avgRamUsage;
      if (typeof s.metrics.avgCpuTemp === "number" && s.metrics.avgCpuTemp > 0) cpuTempSum += s.metrics.avgCpuTemp;
      if (typeof s.metrics.avgGpuTemp === "number" && s.metrics.avgGpuTemp > 0) gpuTempSum += s.metrics.avgGpuTemp;
    }
  }

  const gameById = new Map(games.map((g) => [g.id, g]));
  const smoothestGames = Array.from(gameFpsMap.entries())
    .map(([gameId, data]) => ({
      gameName: data.name,
      avgFps: Math.round(data.totalFps / data.count),
      coverArtUrl: gameById.get(gameId)?.coverArtUrl,
    }))
    .sort((a, b) => b.avgFps - a.avgFps)
    .slice(0, 5);

  return {
    avgFpsOverall: fpsCount > 0 ? Math.round(fpsSum / fpsCount) : 0,
    smoothestGames,
    avgCpuUsage: metricSessions > 0 ? Math.round(cpuSum / metricSessions) : 0,
    avgGpuUsage: metricSessions > 0 ? Math.round(gpuSum / metricSessions) : 0,
    avgRamUsage: metricSessions > 0 ? Math.round(ramSum / metricSessions) : 0,
    avgCpuTemp: metricSessions > 0 ? Math.round(cpuTempSum / metricSessions) : 0,
    avgGpuTemp: metricSessions > 0 ? Math.round(gpuTempSum / metricSessions) : 0,
    metricsSessionCount: metricSessions,
  };
}

// ── Gamer Level & XP Engine ───────────────────────────────────────
export function computeGamerLevel(
  totalMinutes: number,
  sessionCount: number,
  unlockedAchievements: number,
  gamesOwned: number
): GamerLevelInfo {
  // XP formula: 1 min playtime = 2 XP, 1 session = 15 XP, 1 achievement = 50 XP, 1 game owned = 20 XP
  const totalXp = Math.floor(
    totalMinutes * 2 + sessionCount * 15 + unlockedAchievements * 50 + gamesOwned * 20
  );

  // Level curve: Base level 1 requires 200 XP, scaling quadratically
  let level = 1;
  let xpRemaining = totalXp;
  let xpReqForCurrentLevel = 250;

  while (xpRemaining >= xpReqForCurrentLevel) {
    xpRemaining -= xpReqForCurrentLevel;
    level++;
    xpReqForCurrentLevel = Math.floor(250 * Math.pow(1.15, level - 1));
  }

  const progressPct = Math.min(100, Math.round((xpRemaining / xpReqForCurrentLevel) * 100));

  let title = "Initiate";
  if (level >= 50) title = "Grandmaster Legend";
  else if (level >= 40) title = "Ascendant Titan";
  else if (level >= 30) title = "Master Veteran";
  else if (level >= 20) title = "Elite Specialist";
  else if (level >= 15) title = "Seasoned Voyager";
  else if (level >= 10) title = "Skilled Explorer";
  else if (level >= 5) title = "Apprentice Adept";

  return {
    level,
    title,
    currentXp: xpRemaining,
    xpForNextLevel: xpReqForCurrentLevel,
    progressPct,
    totalXp,
  };
}

// ── Gamer Persona Classifier ──────────────────────────────────────
export function classifyGamerPersona(
  sessions: GameSession[],
  games: Game[],
  genreBreakdown: { genre: string; minutes: number }[],
  timeOfDay: TimeOfDaySlice[]
): GamerPersona {
  const totalMin = sessions.reduce((s, x) => s + x.durationMin, 0);
  const avgSession = sessions.length > 0 ? totalMin / sessions.length : 0;
  const topGenre = genreBreakdown[0]?.genre?.toLowerCase() || "";

  const nightSlice = timeOfDay.find((s) => s.key === "night" || s.key === "evening");
  const nightMin = nightSlice ? nightSlice.minutes : 0;
  const nightPct = totalMin > 0 ? Math.round((nightMin / totalMin) * 100) : 0;

  // Compute persona traits (0-100)
  const enduranceScore = Math.min(100, Math.round((avgSession / 90) * 100));
  const versatilityScore = Math.min(100, Math.round(((genreBreakdown.length + (games.length > 10 ? 2 : 0)) / 8) * 100));
  const consistencyScore = Math.min(100, Math.round((sessions.length / 25) * 100));
  const nightOwlScore = Math.min(100, nightPct);

  if (nightPct >= 65) {
    return {
      id: "night_owl",
      titleKey: "stats.persona.nightOwl.title",
      subtitleKey: "stats.persona.nightOwl.subtitle",
      badgeEmoji: "🌙",
      traits: [
        { nameKey: "stats.persona.trait.nightOwl", score: nightOwlScore, descriptionKey: "stats.persona.trait.nightOwlDesc" },
        { nameKey: "stats.persona.trait.endurance", score: enduranceScore, descriptionKey: "stats.persona.trait.enduranceDesc" },
        { nameKey: "stats.persona.trait.versatility", score: versatilityScore, descriptionKey: "stats.persona.trait.versatilityDesc" },
      ],
    };
  }

  if (topGenre.includes("rpg") || topGenre.includes("role") || topGenre.includes("adventure")) {
    return {
      id: "rpg_voyager",
      titleKey: "stats.persona.rpgVoyager.title",
      subtitleKey: "stats.persona.rpgVoyager.subtitle",
      badgeEmoji: "⚔️",
      traits: [
        { nameKey: "stats.persona.trait.narrative", score: 95, descriptionKey: "stats.persona.trait.narrativeDesc" },
        { nameKey: "stats.persona.trait.endurance", score: enduranceScore, descriptionKey: "stats.persona.trait.enduranceDesc" },
        { nameKey: "stats.persona.trait.consistency", score: consistencyScore, descriptionKey: "stats.persona.trait.consistencyDesc" },
      ],
    };
  }

  if (topGenre.includes("strategy") || topGenre.includes("puzzle") || topGenre.includes("simulation")) {
    return {
      id: "master_tactician",
      titleKey: "stats.persona.tactician.title",
      subtitleKey: "stats.persona.tactician.subtitle",
      badgeEmoji: "♟️",
      traits: [
        { nameKey: "stats.persona.trait.tactics", score: 92, descriptionKey: "stats.persona.trait.tacticsDesc" },
        { nameKey: "stats.persona.trait.focus", score: 88, descriptionKey: "stats.persona.trait.focusDesc" },
        { nameKey: "stats.persona.trait.versatility", score: versatilityScore, descriptionKey: "stats.persona.trait.versatilityDesc" },
      ],
    };
  }

  if (avgSession >= 60) {
    return {
      id: "marathon_runner",
      titleKey: "stats.persona.marathon.title",
      subtitleKey: "stats.persona.marathon.subtitle",
      badgeEmoji: "🏃",
      traits: [
        { nameKey: "stats.persona.trait.endurance", score: enduranceScore, descriptionKey: "stats.persona.trait.enduranceDesc" },
        { nameKey: "stats.persona.trait.focus", score: 90, descriptionKey: "stats.persona.trait.focusDesc" },
        { nameKey: "stats.persona.trait.consistency", score: consistencyScore, descriptionKey: "stats.persona.trait.consistencyDesc" },
      ],
    };
  }

  return {
    id: "versatile_champion",
    titleKey: "stats.persona.versatile.title",
    subtitleKey: "stats.persona.versatile.subtitle",
    badgeEmoji: "🌟",
    traits: [
      { nameKey: "stats.persona.trait.versatility", score: versatilityScore, descriptionKey: "stats.persona.trait.versatilityDesc" },
      { nameKey: "stats.persona.trait.consistency", score: consistencyScore, descriptionKey: "stats.persona.trait.consistencyDesc" },
      { nameKey: "stats.persona.trait.endurance", score: enduranceScore, descriptionKey: "stats.persona.trait.enduranceDesc" },
    ],
  };
}

// ── Personal Records ──────────────────────────────────────────────
export function computePersonalRecords(
  sessions: GameSession[],
  heatmapCells: DayCell[],
  streakInfo: StreakInfo,
  genreBreakdown: { genre: string; minutes: number }[]
): PersonalRecords {
  let longestSession: { minutes: number; gameName: string; date: string } | null = null;
  for (const s of sessions) {
    if (!longestSession || s.durationMin > longestSession.minutes) {
      longestSession = { minutes: s.durationMin, gameName: s.gameName, date: s.date };
    }
  }

  let bestDay: { date: Date; minutes: number; key: string } | null = null;
  const now = new Date();
  for (const c of heatmapCells) {
    if (c.date > now) continue;
    if (c.minutes > 0 && (!bestDay || c.minutes > bestDay.minutes)) {
      bestDay = c;
    }
  }

  const monthly = computeMonthlyTrend(sessions, 12);
  let mostActiveMonth: { label: string; minutes: number } | null = null;
  for (const m of monthly) {
    if (!mostActiveMonth || m.minutes > mostActiveMonth.minutes) {
      mostActiveMonth = m;
    }
  }

  return {
    longestSession,
    bestDay,
    longestStreak: streakInfo.longest,
    mostActiveMonth: mostActiveMonth && mostActiveMonth.minutes > 0 ? mostActiveMonth : null,
    totalGamesConquered: sessions.length > 0 ? new Set(sessions.map((s) => s.gameId)).size : 0,
    mostPlayedGenre: genreBreakdown.length > 0 ? genreBreakdown[0] : null,
  };
}

// ── Milestones Progression ────────────────────────────────────────
export function computeMilestones(
  totalMinutes: number,
  librarySize: number,
  longestStreak: number,
  unlockedAchievements: number
): MilestoneItem[] {
  const hours = totalMinutes / 60;

  return [
    {
      id: "play_10h",
      category: "playtime",
      icon: "⏱️",
      titleKey: "stats.milestone.play10h.title",
      descKey: "stats.milestone.play10h.desc",
      targetValue: 10,
      currentValue: Math.round(hours * 10) / 10,
      unlocked: hours >= 10,
    },
    {
      id: "play_50h",
      category: "playtime",
      icon: "🔥",
      titleKey: "stats.milestone.play50h.title",
      descKey: "stats.milestone.play50h.desc",
      targetValue: 50,
      currentValue: Math.round(hours * 10) / 10,
      unlocked: hours >= 50,
    },
    {
      id: "play_100h",
      category: "playtime",
      icon: "💎",
      titleKey: "stats.milestone.play100h.title",
      descKey: "stats.milestone.play100h.desc",
      targetValue: 100,
      currentValue: Math.round(hours * 10) / 10,
      unlocked: hours >= 100,
    },
    {
      id: "play_500h",
      category: "playtime",
      icon: "👑",
      titleKey: "stats.milestone.play500h.title",
      descKey: "stats.milestone.play500h.desc",
      targetValue: 500,
      currentValue: Math.round(hours * 10) / 10,
      unlocked: hours >= 500,
    },
    {
      id: "lib_10",
      category: "library",
      icon: "📚",
      titleKey: "stats.milestone.lib10.title",
      descKey: "stats.milestone.lib10.desc",
      targetValue: 10,
      currentValue: librarySize,
      unlocked: librarySize >= 10,
    },
    {
      id: "lib_50",
      category: "library",
      icon: "🏛️",
      titleKey: "stats.milestone.lib50.title",
      descKey: "stats.milestone.lib50.desc",
      targetValue: 50,
      currentValue: librarySize,
      unlocked: librarySize >= 50,
    },
    {
      id: "streak_7",
      category: "streak",
      icon: "⚡",
      titleKey: "stats.milestone.streak7.title",
      descKey: "stats.milestone.streak7.desc",
      targetValue: 7,
      currentValue: longestStreak,
      unlocked: longestStreak >= 7,
    },
    {
      id: "streak_30",
      category: "streak",
      icon: "🌟",
      titleKey: "stats.milestone.streak30.title",
      descKey: "stats.milestone.streak30.desc",
      targetValue: 30,
      currentValue: longestStreak,
      unlocked: longestStreak >= 30,
    },
    {
      id: "ach_25",
      category: "achievements",
      icon: "🏆",
      titleKey: "stats.milestone.ach25.title",
      descKey: "stats.milestone.ach25.desc",
      targetValue: 25,
      currentValue: unlockedAchievements,
      unlocked: unlockedAchievements >= 25,
    },
    {
      id: "ach_100",
      category: "achievements",
      icon: "🎖️",
      titleKey: "stats.milestone.ach100.title",
      descKey: "stats.milestone.ach100.desc",
      targetValue: 100,
      currentValue: unlockedAchievements,
      unlocked: unlockedAchievements >= 100,
    },
  ];
}

// ── Perfect Games Detector (100% Unlocked) ────────────────────────
export function computePerfectGames(
  achievementCache: Record<string, GameAchievementData>,
  games: Game[]
): PerfectGame[] {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const list: PerfectGame[] = [];

  for (const gid of Object.keys(achievementCache)) {
    const data = achievementCache[gid];
    if (data.total > 0 && data.unlocked === data.total) {
      const lib = gameById.get(gid);
      const lastUnlock = data.achievements.reduce(
        (max, a) => Math.max(max, a.unlockTime || 0),
        0
      );
      list.push({
        gameId: gid,
        gameName: lib?.name ?? String(data.steamAppId || gid),
        coverArtUrl: lib?.coverArtUrl,
        totalAchievements: data.total,
        platform: lib?.platform,
        lastUnlockedTime: lastUnlock,
      });
    }
  }

  list.sort((a, b) => b.lastUnlockedTime - a.lastUnlockedTime);
  return list;
}

// ── Near-Completion Games (50% - 99%) ──────────────────────────────
export function computeNearCompletionGames(
  achievementCache: Record<string, GameAchievementData>,
  games: Game[]
): NearCompletionGame[] {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const list: NearCompletionGame[] = [];

  for (const gid of Object.keys(achievementCache)) {
    const data = achievementCache[gid];
    if (data.total > 0 && data.unlocked < data.total) {
      const pct = Math.round((data.unlocked / data.total) * 100);
      if (pct >= 50) {
        const lib = gameById.get(gid);
        list.push({
          gameId: gid,
          gameName: lib?.name ?? String(data.steamAppId || gid),
          coverArtUrl: lib?.coverArtUrl,
          platform: lib?.platform,
          unlocked: data.unlocked,
          total: data.total,
          percentage: pct,
          remaining: data.total - data.unlocked,
        });
      }
    }
  }

  list.sort((a, b) => b.percentage - a.percentage);
  return list.slice(0, 8);
}

// ── Rarest Achievements Showcase ──────────────────────────────────
export function computeRarestAchievements(
  achievementCache: Record<string, GameAchievementData>,
  games: Game[]
): RarestAchievement[] {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const list: RarestAchievement[] = [];

  for (const gid of Object.keys(achievementCache)) {
    const data = achievementCache[gid];
    const lib = gameById.get(gid);

    for (const ach of data.achievements) {
      if (ach.achieved) {
        // Global percent from Steam metadata or computed fallback
        const rarity = typeof ach.percent === "number" && ach.percent > 0 ? ach.percent : 100;
        list.push({
          gameName: lib?.name ?? String(data.steamAppId || gid),
          gameId: gid,
          coverArtUrl: lib?.coverArtUrl,
          achievementId: ach.apiName || ach.displayName,
          displayName: ach.displayName,
          description: ach.description,
          iconUrl: ach.icon,
          rarityPct: Math.round(rarity * 10) / 10,
          unlockTime: ach.unlockTime,
        });
      }
    }
  }

  list.sort((a, b) => a.rarityPct - b.rarityPct);
  return list.slice(0, 10);
}

// ── Recently Unlocked Achievements ────────────────────────────────
export function collectUnlockedAchievements(
  cache: Record<string, GameAchievementData>,
  games: Game[]
): UnlockedAchievementItem[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  const out: UnlockedAchievementItem[] = [];

  for (const gid of Object.keys(cache)) {
    const data = cache[gid];
    const lib = byId.get(gid);
    for (const ach of data.achievements) {
      if (ach.unlockTime && ach.unlockTime > 0) {
        out.push({
          gameName: lib?.name ?? String(data.steamAppId),
          name: ach.displayName,
          description: ach.description,
          unlockTime: ach.unlockTime,
          coverArtUrl: lib?.coverArtUrl,
          iconUrl: ach.icon,
        });
      }
    }
  }

  out.sort((a, b) => b.unlockTime - a.unlockTime);
  return out.slice(0, 15);
}
