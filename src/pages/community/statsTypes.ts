export type { Game, GameSession, GameAchievementData, Achievement } from "../../types/game";

export type StatsSubtab = "overview" | "trends" | "achievements" | "captures" | "milestones";

export type TimeframePreset = "all" | "year" | "90d" | "30d";

export interface DayCell {
  date: Date;
  minutes: number;
  key: string; // ISO yyyy-mm-dd
}

export interface StreakInfo {
  current: number;
  longest: number;
  playedToday: boolean;
}

export type TimeOfDayKey = "night" | "morning" | "afternoon" | "evening";

export interface TimeOfDaySlice {
  key: TimeOfDayKey;
  minutes: number;
  color: string;
}

export interface PeriodCompare {
  thisMonthMin: number;
  lastMonthMin: number;
  deltaMin: number;
  pct: number | null;
}

export interface WeekdaySplit {
  minutes: number[]; // Index 0 = Mon ... 6 = Sun
  totalMinutes: number;
  maxMinutes: number;
  favoriteIndex: number;
}

export interface MonthlyTrendItem {
  label: string;
  minutes: number;
  sessions: number;
}

export interface GoalPace {
  expectedMin: number;
  diffMin: number;
}

export interface GamerLevelInfo {
  level: number;
  title: string;
  currentXp: number;
  xpForNextLevel: number;
  progressPct: number;
  totalXp: number;
}

export interface GamerPersona {
  id: string;
  titleKey: string;
  subtitleKey: string;
  badgeEmoji: string;
  traits: {
    nameKey: string;
    score: number; // 0 - 100
    descriptionKey: string;
  }[];
}

export interface HabitCell {
  dayIndex: number; // 0 (Mon) - 6 (Sun)
  hour: number; // 0 - 23
  minutes: number;
  intensity: number; // 0 - 4
}

export interface SessionLengthBucket {
  key: "quick" | "casual" | "deep" | "marathon";
  labelKey: string;
  rangeKey: string;
  count: number;
  minutes: number;
  percentage: number;
  color: string;
}

export interface LibraryHealthStats {
  unplayed: number;
  inProgress: number;
  completed: number;
  mastered: number;
  total: number;
  completionRate: number;
  unplayedRate: number;
}

export interface PerformanceStats {
  avgFpsOverall: number;
  smoothestGames: { gameName: string; avgFps: number; coverArtUrl?: string }[];
  avgCpuUsage: number;
  avgGpuUsage: number;
  avgRamUsage: number;
  avgCpuTemp: number;
  avgGpuTemp: number;
  metricsSessionCount: number;
}

export interface PersonalRecords {
  longestSession: { minutes: number; gameName: string; date: string } | null;
  bestDay: { date: Date; minutes: number; key: string } | null;
  longestStreak: number;
  mostActiveMonth: { label: string; minutes: number } | null;
  totalGamesConquered: number;
  mostPlayedGenre: { genre: string; minutes: number } | null;
}

export interface MilestoneItem {
  id: string;
  category: "playtime" | "library" | "streak" | "achievements";
  icon: string;
  titleKey: string;
  descKey: string;
  targetValue: number;
  currentValue: number;
  unlocked: boolean;
  unlockedAt?: number;
}

export interface PerfectGameInfo {
  gameId: string;
  gameName: string;
  coverArtUrl?: string;
  platform?: string;
  totalAchievements: number;
  lastUnlockedTime: number;
}
export type PerfectGame = PerfectGameInfo;

export interface NearCompletionGameInfo {
  gameId: string;
  gameName: string;
  coverArtUrl?: string;
  platform?: string;
  unlocked: number;
  total: number;
  percentage: number;
  remaining: number;
}
export type NearCompletionGame = NearCompletionGameInfo;

export interface RarestAchievement {
  gameName: string;
  gameId?: string;
  coverArtUrl?: string;
  achievementId: string;
  displayName: string;
  description: string;
  iconUrl?: string;
  rarityPct: number;
  unlockTime?: number;
}

export interface ScreenshotGroup {
  key: string;
  appId?: number;
  gameName: string;
  gameId?: string;
  coverArtUrl?: string;
  platform?: string;
  folderPath: string;
  screenshots: string[];
  source?: string;
}

export interface UnlockedAchievementItem {
  gameName: string;
  name: string;
  description: string;
  unlockTime: number;
  coverArtUrl?: string;
  iconUrl?: string;
}
