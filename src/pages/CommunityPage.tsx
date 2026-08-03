import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useActivity } from "../context/ActivityContext";
import { useAchievements } from "../context/AchievementContext";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useSettings } from "../context/SettingsContext";
import { useLanguage } from "../context/LanguageContext";

import DonutChart from "../components/charts/DonutChart";
import BarChart from "../components/charts/BarChart";
import { Card, KpiTile, Button, PageHeader } from "../components/ui";
import {
  buildHeatmap,
  computeStreaks,
  computeTimeOfDay,
  computePeriodCompare,
  computeMonthToDate,
  computeWeekdaySplit,
  computeMonthlyTrend,
  findBestDay,
} from "./communityProfileStats";
import {
  ActivityHeatmap,
  StreakCard,
  TimeOfDayCard,
  GoalCard,
  PeriodCompareBadge,
  AchievementsShowcase,
  WeekdaySplitCard,
  collectUnlockedAchievements,
} from "./communityProfileExtras";
import {
  loadFavorites,
  saveFavorites,
  loadMonthlyGoal,
  saveMonthlyGoal,
  loadScreenshotCache,
  saveScreenshotCache,
  loadManualFolder,
  saveManualFolder,
} from "./communityStorage";
import { ScreenshotThumb } from "./communityScreenshotThumb";
import "./community.css";
import "../styles/page-community.css";

// ─── Tab types ─────────────────────────────────────────────────────────────

type CommunityTab = "profile" | "screenshots";

// ─── Icons (inline SVG, theme-friendly) ────────────────────────────────────

const ProfileIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const ImageIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const ClockIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const GamepadIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <line x1="6" y1="11" x2="10" y2="11" />
    <line x1="8" y1="9" x2="8" y2="13" />
    <line x1="15" y1="12" x2="15.01" y2="12" />
    <line x1="18" y1="10" x2="18.01" y2="10" />
    <rect x="2" y="6" width="20" height="12" rx="2" />
  </svg>
);

const TrophyIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const SparkleIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const FolderIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ChevronLeftIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronRightIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const XIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ─── Donut chart color palette (theme tokens) ───────────────────────────────

const DONUT_PALETTE = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "color-mix(in srgb, var(--color-accent) 60%, var(--color-info))",
  "color-mix(in srgb, var(--color-info) 60%, var(--color-success))",
  "color-mix(in srgb, var(--color-success) 60%, var(--color-warning))",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

import { useBigScreen } from "../context/BigScreenContext";
import BigScreenCommunity from "../components/bigscreen/BigScreenCommunity";

export default function CommunityPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenCommunity />;
  }
  const [activeTab, setActiveTab] = useState<CommunityTab>("profile");
  const { t } = useLanguage();

  return (
    <div className="community-page">
      {/* Tab bar */}
      <div className="community-tab-bar" role="tablist" aria-label={t("community.sectionsLabel")}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "profile"}
          className={`community-tab${activeTab === "profile" ? " active" : ""}`}
          onClick={() => setActiveTab("profile")}
        >
          {ProfileIcon}
          <span>{t("community.tab.profile")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "screenshots"}
          className={`community-tab${activeTab === "screenshots" ? " active" : ""}`}
          onClick={() => setActiveTab("screenshots")}
        >
          {ImageIcon}
          <span>{t("community.tab.screenshots")}</span>
        </button>
      </div>

      {/* Tab panels */}
      <div className="community-panel">
        {activeTab === "profile" && <ProfileSection />}
        {activeTab === "screenshots" && <ScreenshotsSection />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Profile Section (#7)
// ═══════════════════════════════════════════════════════════════════════════════

function ProfileSection() {
  const { getAllStats, sessions } = useActivity();
  const { cache } = useAchievements();
  const { games } = useGames();
  const { hideAchievementProgress } = useSettings();
  const { t } = useLanguage();

  const stats = useMemo(() => getAllStats(), [getAllStats]);

  // ── New derived analytics ────────────────────────────────────────
  const heatmap = useMemo(() => buildHeatmap(sessions), [sessions]);
  const streak = useMemo(() => computeStreaks(sessions), [sessions]);
  const timeOfDay = useMemo(() => computeTimeOfDay(sessions), [sessions]);
  const periodCompare = useMemo(() => computePeriodCompare(sessions), [sessions]);
  const monthToDate = useMemo(() => computeMonthToDate(sessions), [sessions]);
  const weekday = useMemo(() => computeWeekdaySplit(sessions), [sessions]);
  const monthlyTrend = useMemo(() => computeMonthlyTrend(sessions, 6), [sessions]);
  const bestDay = useMemo(() => findBestDay(heatmap.cells), [heatmap.cells]);
  const unlockedAchievements = useMemo(
    () => collectUnlockedAchievements(cache.games, games),
    [cache, games]
  );

  // Monthly goal (persisted)
  const [goalMin, setGoalMin] = useState<number>(() => loadMonthlyGoal());
  const onGoalChange = useCallback(
    (min: number) => {
      setGoalMin(min);
      saveMonthlyGoal(min);
    },
    []
  );

  // Count total achievements across all cached games
  const achievementCounts = useMemo(() => {
    let total = 0;
    let unlocked = 0;
    for (const gid of Object.keys(cache.games)) {
      const g = cache.games[gid];
      total += g.total;
      unlocked += g.unlocked;
    }
    return { total, unlocked };
  }, [cache]);

  // Genre breakdown for donut (top 7 + "Other")
  const genreSlices = useMemo(() => {
    const sorted = [...stats.genreBreakdown];
    if (sorted.length <= 7) {
      return sorted.map((g, i) => ({
        label: g.genre,
        value: g.minutes,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      }));
    }
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7).reduce((s, g) => s + g.minutes, 0);
    const slices = top.map((g, i) => ({
      label: g.genre,
      value: g.minutes,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
    if (rest > 0) slices.push({ label: t("communityExtras.other"), value: rest, color: "var(--color-text-muted)" });
    return slices;
  }, [stats.genreBreakdown, t]);

  // Platform breakdown
  const platformSlices = useMemo(() => {
    return stats.platformBreakdown.map((p, i) => ({
      label: p.platform,
      value: p.minutes,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
  }, [stats.platformBreakdown]);

  // Top genre / platform highlights (shown under each donut)
  const topGenre = useMemo(() => {
    const total = genreSlices.reduce((s, g) => s + g.value, 0);
    if (total <= 0 || genreSlices.length === 0) return null;
    return { name: genreSlices[0].label, pct: Math.round((genreSlices[0].value / total) * 100) };
  }, [genreSlices]);

  const topPlatform = useMemo(() => {
    const total = platformSlices.reduce((s, p) => s + p.value, 0);
    if (total <= 0 || platformSlices.length === 0) return null;
    return { name: platformSlices[0].label, pct: Math.round((platformSlices[0].value / total) * 100) };
  }, [platformSlices]);

  // Monthly trend in whole hours (friendlier y-axis than raw minutes)
  const monthlyHours = useMemo(() => {
    return monthlyTrend.map((m) => Math.round((m.minutes / 60) * 10) / 10);
  }, [monthlyTrend]);
  const monthlyLabels = useMemo(() => monthlyTrend.map((m) => m.label), [monthlyTrend]);

  // Games added this month
  const gamesAddedThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return games.filter((g) => g.addedAt >= monthStart).length;
  }, [games]);

  // Recently played games (last 14 days)
  const recentlyPlayed = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return games.filter((g) => g.lastPlayed && g.lastPlayed >= cutoff).length;
  }, [games]);

  // Total achievements completion %
  const achievementPct = achievementCounts.total > 0
    ? Math.round((achievementCounts.unlocked / achievementCounts.total) * 100)
    : null;

  const totalGames = games.length;

  // Ranked top games (most played) with cover art + progress bars
  const topGames = useMemo(() => {
    const maxMin = stats.topGames.length > 0 ? stats.topGames[0].minutes : 0;
    return stats.topGames.map((g) => {
      const libGame = games.find((lg) => lg.id === g.gameId);
      return {
        ...g,
        coverArtUrl: libGame?.coverArtUrl,
        platform: libGame?.platform,
        pct: maxMin > 0 ? Math.round((g.minutes / maxMin) * 100) : 0,
      };
    });
  }, [stats.topGames, games]);

  // Distinct genres / platforms played
  const distinctGenres = stats.genreBreakdown.length;

  // Share profile — copy a markdown summary to the clipboard.
  const { showToast } = useToast();
  const handleShareProfile = useCallback(async () => {
    const top = stats.topGames
      .slice(0, 5)
      .map((g, i) => `${i + 1}. ${g.gameName} — ${formatHours(g.minutes)}`)
      .join("\n");
    const md = [
      "# My GameIndex Year in Review",
      "",
      `- Total Playtime: ${formatHours(stats.totalPlayTimeMin)}`,
      `- Sessions: ${stats.totalSessions}`,
      `- Games in Library: ${games.length}`,
      `- Games Played: ${stats.topGames.length}`,
      `- Longest Session: ${stats.longestSessionMin > 0 ? formatHours(stats.longestSessionMin) : "—"}`,
      `- Current Streak: ${streak.current} day${streak.current !== 1 ? "s" : ""}`,
      `- Monthly Goal: ${goalMin > 0 ? `${formatHours(monthToDate)} / ${formatHours(goalMin)}` : "not set"}`,
      "",
      "## Most Played",
      top || "_(no plays yet)_",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(md);
      showToast(t("community.profileCopied"), "success");
    } catch {
      showToast(t("community.copyFailed"), "error");
    }
  }, [stats, games.length, streak.current, goalMin, monthToDate, showToast]);

  return (
    <div className="community-profile page">
      {/* ── Profile header / share ─────────────────────────────────── */}
      <PageHeader
        eyebrow={t("community.eyebrow")}
        title={t("community.playerProfile")}
        actions={
          <Button variant="ghost" size="sm" onClick={handleShareProfile} leftIcon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          }>{t("community.shareProfile")}</Button>
        }
      />

      {/* ── KPI Tile Row ─────────────────────────────────────────────── */}
      <div className="community-kpi-grid">
        <KpiTile
          label={t("community.totalPlaytime")}
          value={formatHours(stats.totalPlayTimeMin)}
          subtext={t("gameActivity.sessionCount", { count: stats.totalSessions, s: stats.totalSessions !== 1 ? "s" : "" })}
          icon={ClockIcon}
          intent="accent"
          size="md"
          trailing={<PeriodCompareBadge compare={periodCompare} />}
        />
        <KpiTile
          label={t("community.gamesOwned")}
          value={totalGames}
          subtext={t("community.addedThisMonth", { count: gamesAddedThisMonth })}
          icon={GamepadIcon}
          intent="info"
          size="md"
        />
        {!hideAchievementProgress && achievementPct !== null && (
            <KpiTile
              label={t("community.achievements")}
            value={`${achievementPct}%`}
            subtext={t("community.unlockedOf", { unlocked: achievementCounts.unlocked, total: achievementCounts.total })}
            icon={TrophyIcon}
            intent={achievementPct >= 50 ? "success" : "warning"}
            size="md"
          />
        )}
        <KpiTile
          label={t("community.recentlyPlayed")}
          value={recentlyPlayed}
          subtext={t("community.last14Days")}
          icon={SparkleIcon}
          intent="success"
          size="md"
        />
      </div>

      {/* ── Year in Review summary strip ───────────────────────────────── */}
      <Card
        variant="glass"
        elevation="glow"
        className="community-year-card community-year-strip"
        header={
          <h3 className="community-year-header">
            <span className="community-year-icon">🎮</span>
            <span>{t("community.yearInReview")}</span>
          </h3>
        }
      >
        <div className="community-year-strip-grid">
          <div className="community-year-strip-cell">
            <span className="community-year-strip-value">{formatHours(stats.totalPlayTimeMin)}</span>
            <span className="community-year-strip-label">{t("community.totalPlaytime")}</span>
          </div>
          <div className="community-year-strip-cell">
            <span className="community-year-strip-value">{stats.totalSessions}</span>
            <span className="community-year-strip-label">{t("community.sessions")}</span>
          </div>
          <div className="community-year-strip-cell">
            <span className="community-year-strip-value">{totalGames}</span>
            <span className="community-year-strip-label">{t("community.gamesInLibrary")}</span>
          </div>
          <div className="community-year-strip-cell">
            <span className="community-year-strip-value">{stats.topGames.length}</span>
            <span className="community-year-strip-label">{t("community.gamesPlayed")}</span>
          </div>
          <div className="community-year-strip-cell">
            <span className="community-year-strip-value">{stats.longestSessionMin > 0 ? formatHours(stats.longestSessionMin) : "—"}</span>
            <span className="community-year-strip-label">{t("community.longestSession")}</span>
          </div>
          <div className="community-year-strip-cell">
            <span className="community-year-strip-value">{stats.avgSessionMin > 0 ? formatHours(stats.avgSessionMin) : "—"}</span>
            <span className="community-year-strip-label">{t("community.avgSession")}</span>
          </div>
          <div className="community-year-strip-cell">
            <span className="community-year-strip-value">{distinctGenres}</span>
            <span className="community-year-strip-label">{t("community.genresPlayed")}</span>
          </div>
          {stats.avgFpsAll > 0 && (
            <div className="community-year-strip-cell">
              <span className="community-year-strip-value">{stats.avgFpsAll} fps</span>
              <span className="community-year-strip-label">{t("community.avgFps")}</span>
            </div>
          )}
        </div>
      </Card>

      {/* ── When you play: heatmap + weekday rhythm + trends ────────────── */}
      <section className="community-section" aria-labelledby="community-when-heading">
        <h2 id="community-when-heading" className="community-section-heading">
          {t("communityExtras.whenYouPlay")}
        </h2>
        <div className="community-when-grid">
          {heatmap.cells.length > 0 && (
            <ActivityHeatmap
              cells={heatmap.cells}
              maxMinutes={heatmap.maxMinutes}
              activeDays={heatmap.activeDays}
              totalMinutes={heatmap.totalMinutes}
              bestDay={bestDay}
            />
          )}
          <WeekdaySplitCard
            minutes={weekday.minutes}
            maxMinutes={weekday.maxMinutes}
            favoriteIndex={weekday.favoriteIndex}
          />
        </div>

        {/* Recent + monthly playtime trends */}
        <div className="community-trends-row">
          {stats.dailyAvg.length > 0 && (
            <Card variant="surface" elevation="1" className="community-chart-card community-weekly-card">
              <div className="community-chart-header">
                <h3>{t("community.last7Days")}</h3>
                <span className="community-chart-subtitle">{t("communityExtras.dailyPlaytimeMinutes")}</span>
              </div>
              <BarChart
                data={stats.dailyAvg}
                labels={stats.dailyLabels}
                height={200}
                color="var(--color-accent)"
                formatValue={(v) => `${v}m`}
              />
            </Card>
          )}
          <Card variant="surface" elevation="1" className="community-chart-card community-weekly-card">
            <div className="community-chart-header">
              <h3>{t("communityExtras.last6Months")}</h3>
              <span className="community-chart-subtitle">{t("communityExtras.monthlyPlaytime")}</span>
            </div>
            <BarChart
              data={monthlyHours}
              labels={monthlyLabels}
              height={200}
              color="var(--color-info)"
              formatValue={(v) => `${v}h`}
            />
          </Card>
        </div>
      </section>

      {/* ── What you play: genre / platform / time-of-day donuts ─────────── */}
      <section className="community-section" aria-labelledby="community-what-heading">
        <h2 id="community-what-heading" className="community-section-heading">
          {t("communityExtras.whatYouPlay")}
        </h2>
        <div className="community-donut-row">
          {/* Genre breakdown donut */}
          <Card variant="surface" elevation="1" className="community-chart-card">
            <div className="community-chart-header">
              <h3>{t("community.genreBreakdown")}</h3>
              <span className="community-chart-subtitle">{t("communityExtras.byTotalPlaytime")}</span>
            </div>
            {genreSlices.length > 0 ? (
              <>
                <DonutChart
                  slices={genreSlices}
                  size={200}
                  innerRadius={55}
                  formatValue={(v) => formatHours(v)}
                />
                {topGenre && (
                  <div className="community-donut-highlight">
                    <span className="community-donut-highlight-label">{t("communityExtras.topGenreLabel")}</span>
                    <span className="community-donut-highlight-value">{topGenre.name} · {topGenre.pct}%</span>
                  </div>
                )}
              </>
            ) : (
              <div className="community-empty-chart">
                <p>{t("community.emptyGenre")}</p>
              </div>
            )}
          </Card>

          {/* Platform breakdown donut */}
          <Card variant="surface" elevation="1" className="community-chart-card">
            <div className="community-chart-header">
              <h3>{t("community.platformSplit")}</h3>
              <span className="community-chart-subtitle">{t("communityExtras.byTotalPlaytime")}</span>
            </div>
            {platformSlices.length > 0 ? (
              <>
                <DonutChart
                  slices={platformSlices}
                  size={200}
                  innerRadius={55}
                  formatValue={(v) => formatHours(v)}
                />
                {topPlatform && (
                  <div className="community-donut-highlight">
                    <span className="community-donut-highlight-label">{t("communityExtras.topPlatformLabel")}</span>
                    <span className="community-donut-highlight-value">{topPlatform.name} · {topPlatform.pct}%</span>
                  </div>
                )}
              </>
            ) : (
              <div className="community-empty-chart">
                <p>{t("community.emptyPlatform")}</p>
              </div>
            )}
          </Card>

          <TimeOfDayCard slices={timeOfDay} />
        </div>
      </section>

      {/* ── Goals: streak + monthly goal ─────────────────────────────────── */}
      <section className="community-section" aria-labelledby="community-goals-heading">
        <h2 id="community-goals-heading" className="community-section-heading">
          {t("communityExtras.goalsSection")}
        </h2>
        <div className="community-highlights-row">
          <StreakCard streak={streak} />
          <GoalCard currentMin={monthToDate} goalMin={goalMin} onChangeGoal={onGoalChange} />
        </div>
      </section>

      {/* ── Most Played Games Breakdown ─────────────────────────────────── */}
      <Card
        variant="surface"
        elevation="1"
        className="community-year-card community-breakdown-card"
        header={
          <h3 className="community-year-header">
            <span className="community-year-icon">🏆</span>
            <span>{t("community.mostPlayedGames")}</span>
            {topGames.length > 0 && (
              <span className="community-breakdown-total">
                {t("community.rankedOf", { count: topGames.length, total: stats.topGames.length })}
              </span>
            )}
          </h3>
        }
      >
        {topGames.length > 0 ? (
          <ol className="community-breakdown-list">
            {topGames.map((g, i) => (
              <li key={g.gameId} className="community-breakdown-row">
                <span className="community-breakdown-rank">{i + 1}</span>
                <div className="community-breakdown-cover">
                  {g.coverArtUrl ? (
                    <img src={g.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="community-breakdown-cover-fallback">{GamepadIcon}</div>
                  )}
                </div>
                <div className="community-breakdown-info">
                  <div className="community-breakdown-name-row">
                    <span className="community-breakdown-name" title={g.gameName}>{g.gameName}</span>
                    <span className="community-breakdown-time">{formatHours(g.minutes)}</span>
                  </div>
                  <div className="community-breakdown-bar">
                    <div
                      className="community-breakdown-bar-fill"
                      style={{ width: `${g.pct}%` }}
                    />
                  </div>
                  <div className="community-breakdown-meta">
                    {g.platform && <span className="community-breakdown-platform">{g.platform}</span>}
                    <span>{t("gameActivity.sessionCount", { count: g.sessions, s: g.sessions !== 1 ? "s" : "" })}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="community-empty-chart">
            <p>{t("community.emptyMostPlayed")}</p>
          </div>
        )}
      </Card>

      {/* ── New: Recently Unlocked Achievements ──────────────────────── */}
      {!hideAchievementProgress && (
        <AchievementsShowcase items={unlockedAchievements} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Screenshots Section (#4) — auto-detect Steam + game-grouped accordion
// ═══════════════════════════════════════════════════════════════════════════════

interface ScreenshotGroup {
  key: string; // unique key for React + expansion tracking
  appId?: number;
  gameName: string;
  gameId?: string;
  coverArtUrl?: string;
  platform?: string;
  folderPath: string;
  screenshots: string[];
  /** Source badge: undefined (Steam/user folder), "nvidia", "amd", or "obs" */
  source?: string;
}

/** Video file extensions recognised for the clips feature. */
const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv"];
function isVideoPath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.includes(ext);
}

/** Human-readable source badge label for a detection source id. */
const SOURCE_PILLS = ["nvidia", "amd", "obs", "windows"] as const;
function sourceLabel(src: string): string {
  switch (src) {
    case "nvidia": return "NVIDIA";
    case "amd": return "AMD";
    case "obs": return "OBS";
    case "windows": return "Xbox";
    default: return src;
  }
}

function ScreenshotsSection() {
  const { games } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();

  // Keep a ref to games so handleAutoDetect doesn't re-create on every playtime tick.
  // Follows the same pattern used in ActivityContext and GameContext.
  const gamesRef = useRef(games);
  useEffect(() => { gamesRef.current = games; }, [games]);

  // Re-hydrate instantly from the last successful detection, then refresh
  // in the background so the tab isn't empty on every visit. Both branches
  // are intentionally fire-and-forget: cached data shows immediately, and
  // any newer captures surface once the scan finishes.
  useEffect(() => {
    const cached = loadScreenshotCache();
    // The manual folder used to be persisted inside the screenshot cache as
    // a synthetic "manual-" group. It is now stored separately (see
    // loadManualFolder) so filter those legacy entries out to avoid showing
    // the picked folder twice after an upgrade.
    const detected = cached.filter((g) => !g.key.startsWith("manual-"));
    if (detected.length > 0) {
      setGroups(detected as unknown as ScreenshotGroup[]);
      const initialExpanded = new Set<string>();
      for (let i = 0; i < Math.min(detected.length, 3); i++) {
        initialExpanded.add(detected[i].key);
      }
      setExpandedKeys(initialExpanded);
    }
    // Restore a manually picked folder across reboots and re-scan it so
    // freshly captured images show up even if detection finds nothing new.
    const savedFolder = loadManualFolder();
    if (savedFolder) {
      setSelectedFolder(savedFolder);
      setIsScanning(true);
      invoke<string[]>("list_media_files", { folderPath: savedFolder })
        .then((paths) => setManualImages(paths))
        .catch(() => setManualImages([]))
        .finally(() => setIsScanning(false));
    }
    handleAutoDetect(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Favorites (persisted) ─────────────────────────────────────────
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const toggleFavorite = useCallback((path: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveFavorites(next);
      return next;
    });
  }, []);

  // ── Search + source filter ────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [allExpanded, setAllExpanded] = useState(false);

  // ── Slideshow ──────────────────────────────────────────────────────
  const [slideshow, setSlideshow] = useState(false);

  // ── Auto-detect Steam state ────────────────────────────────────────
  const [groups, setGroups] = useState<ScreenshotGroup[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [isDetecting, setIsDetecting] = useState(false);

  // ── Manual folder state ───────────────────────────────────────────
  const [manualImages, setManualImages] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // ── Lightbox state (unified across ALL screenshots) ───────────────
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Apply search / source / favorites filters to the detected groups.
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => {
        if (sourceFilter && g.source !== sourceFilter) return false;
        if (q && !g.gameName.toLowerCase().includes(q)) return false;
        if (showFavOnly && !g.screenshots.some((s) => favorites.has(s))) return false;
        return true;
      })
      .map((g) => {
        if (!showFavOnly && !q) return g;
        const shots = g.screenshots.filter((s) => {
          if (showFavOnly && !favorites.has(s)) return false;
          return true;
        });
        return { ...g, screenshots: shots };
      });
  }, [groups, search, sourceFilter, showFavOnly, favorites]);

  const filteredManual = useMemo(() => {
    const q = search.trim().toLowerCase();
    return manualImages
      .filter((p) => (showFavOnly ? favorites.has(p) : true))
      .filter((p) => (sourceFilter ? p.toLowerCase().includes(sourceFilter) : true))
      .filter((p) => (q ? p.toLowerCase().includes(q) : true));
  }, [manualImages, showFavOnly, sourceFilter, search, favorites]);

  // Count of favorites actually visible under the current filters, so the
  // Favorites pill reflects what the user would see rather than the global total.
  const visibleFavCount = useMemo(() => {
    let n = 0;
    for (const g of filteredGroups) {
      for (const s of g.screenshots) if (favorites.has(s)) n++;
    }
    for (const s of filteredManual) if (favorites.has(s)) n++;
    return n;
  }, [filteredGroups, filteredManual, favorites]);

  // Build a flat array of ALL (filtered) image paths for lightbox navigation.
  // Groups (Steam detected) and the manual folder are merged into a single
  // flat list so the lightbox can walk every visible image, regardless of
  // which detection source produced it.
  const allImagePaths = useMemo(() => {
    const flat: string[] = [];
    for (const g of filteredGroups) {
      flat.push(...g.screenshots);
    }
    flat.push(...filteredManual);
    return flat;
  }, [filteredGroups, filteredManual]);

  // ── Auto-detect Steam screenshots ─────────────────────────────────
  // `silent` runs in the background (on mount / cache re-hydrate) so it
  // won't wipe already-visible cached data or spam toasts.
  const handleAutoDetect = useCallback(async (silent = false) => {
    setIsDetecting(true);
    if (!silent) {
      setGroups([]);
      setManualImages([]);
      setSelectedFolder(null);
      setExpandedKeys(new Set());
    }

    try {
      // Fan out both detections in parallel
      const [steamFolders, systemFolders] = await Promise.all([
        invoke<{
          appId: number;
          gameName: string;
          folderPath: string;
          screenshots: string[];
        }[]>("detect_steam_screenshot_folders"),
        invoke<{
          source: string;
          gameName: string;
          folderPath: string;
          screenshots: string[];
        }[]>("detect_system_screenshot_folders"),
      ]);

      // ---- Enrich Steam folders with library metadata ----
      const enriched: ScreenshotGroup[] = steamFolders.map((f) => {
        const libGame = gamesRef.current.find((g) => g.steamAppId === f.appId);
        const groupKey = `steam-${f.appId}`;
        if (libGame) {
          return {
            key: groupKey,
            appId: f.appId,
            gameName: libGame.name,
            gameId: libGame.id,
            coverArtUrl: libGame.coverArtUrl,
            platform: libGame.platform,
            folderPath: f.folderPath,
            screenshots: f.screenshots,
          };
        }
        return {
          key: groupKey,
          appId: f.appId,
          gameName: f.gameName,
          folderPath: f.folderPath,
          screenshots: f.screenshots,
        };
      });

      // ---- Add system folders (NVIDIA, AMD, OBS) ----
      for (const sf of systemFolders) {
        enriched.push({
          key: `${sf.source}-${sf.folderPath.replace(/[^a-zA-Z0-9]/g, "-")}`,
          gameName: sf.gameName,
          folderPath: sf.folderPath,
          screenshots: sf.screenshots,
          source: sf.source,
        });
      }

      if (enriched.length === 0) {
        if (!silent) showToast(t("community.noScreenshots"), "info");
        setIsDetecting(false);
        return;
      }

      // Sort by game name
      enriched.sort((a, b) => a.gameName.localeCompare(b.gameName));

      // Auto-expand the first few groups (preserve any cached expansion
      // state if this is a silent background refresh).
      setExpandedKeys((prev) => {
        if (!silent || prev.size === 0) {
          const initialExpanded = new Set<string>();
          for (let i = 0; i < Math.min(enriched.length, 3); i++) {
            initialExpanded.add(enriched[i].key);
          }
          return initialExpanded;
        }
        // Keep only keys that still exist in the refreshed result.
        const valid = new Set(enriched.map((g) => g.key));
        const next = new Set<string>();
        for (const k of prev) if (valid.has(k)) next.add(k);
        return next;
      });

      setGroups(enriched);
      saveScreenshotCache(enriched);

      const totalCount = enriched.reduce((s, g) => s + g.screenshots.length, 0);
      const srcCount = systemFolders.length > 0
        ? ` (${steamFolders.length} Steam, ${systemFolders.length} system)`
        : "";
      if (!silent) {
        showToast(t("community.groupsFound", { groups: enriched.length, total: totalCount, sources: srcCount }), "success");
      }
    } catch (err) {
      console.error("[Community] Steam screenshot detection failed:", err);
      if (!silent) showToast(t("community.detectFailed"), "error");
    } finally {
      setIsDetecting(false);
    }
  }, [showToast]);

  // ── Manual folder picker ──────────────────────────────────────────
  const handlePickFolder = useCallback(async () => {
    try {
      const folderPath = await tauriOpen({
        directory: true,
        multiple: false,
        title: t("communityExtras.selectFolder"),
      });
      if (!folderPath || typeof folderPath !== "string") return;

      // Clear Steam groups when switching to manual mode
      setGroups([]);
      setSelectedFolder(folderPath);
      setIsScanning(true);

       const paths: string[] = await invoke("list_media_files", {
        folderPath,
      });
      setManualImages(paths);
      saveManualFolder(folderPath);
      if (paths.length === 0) {
        showToast(t("community.noImagesInFolder"), "info");
      }
    } catch (err) {
      console.error("[Community] Failed to scan folder:", err);
      showToast(t("community.scanFailed"), "error");
    } finally {
      setIsScanning(false);
    }
  }, [showToast]);

  // ── Accordion toggle ──────────────────────────────────────────────
  const toggleGroup = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Expand / collapse every visible group at once.
  const toggleAllGroups = useCallback(() => {
    setAllExpanded((prev) => {
      const next = !prev;
      if (next) {
        setExpandedKeys(new Set(filteredGroups.map((g) => g.key)));
      } else {
        setExpandedKeys(new Set());
      }
      return next;
    });
  }, [filteredGroups]);

  // ── Lightbox ──────────────────────────────────────────────────────
  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const goNext = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || allImagePaths.length === 0) return null;
      return (prev + 1) % allImagePaths.length;
    });
  }, [allImagePaths.length]);

  const goPrev = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || allImagePaths.length === 0) return null;
      return (prev - 1 + allImagePaths.length) % allImagePaths.length;
    });
  }, [allImagePaths.length]);

  // Slideshow auto-advance
  useEffect(() => {
    if (!slideshow || lightboxIndex === null) return;
    const t = setInterval(() => goNext(), 3500);
    return () => clearInterval(t);
  }, [slideshow, lightboxIndex, goNext]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, closeLightbox, goNext, goPrev]);

  // ── Build a lookup: screenshot index → group ──────────────────────
  // Covers both Steam groups and the manual folder so the lightbox can
  // always label the current image with its source game/folder.
  const screenshotGroupIndex = useMemo(() => {
    const manualName = selectedFolder
      ? selectedFolder.split(/[\\/]/).pop() || "Screenshot"
      : "Screenshot";
    const map: { groupKey: string; gameName: string }[] = [];
    for (const g of filteredGroups) {
      for (let i = 0; i < g.screenshots.length; i++) {
        map.push({ groupKey: g.key, gameName: g.gameName });
      }
    }
    for (let i = 0; i < filteredManual.length; i++) {
      map.push({ groupKey: "manual", gameName: manualName });
    }
    return map.length > 0 ? map : null;
  }, [filteredGroups, filteredManual, selectedFolder]);

  // ── Precompute offset of each group in the flat image array ───────
  const groupOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let current = 0;
    for (const g of filteredGroups) {
      offsets.set(g.key, current);
      current += g.screenshots.length;
    }
    return offsets;
  }, [filteredGroups]);

  // ── Determine what to show ────────────────────────────────────────
  const hasContent = groups.length > 0 || manualImages.length > 0 || isScanning || isDetecting;

  return (
    <div className="community-screenshots">
      {/* Toolbar */}
      <div className="community-screenshots-toolbar">
        <Button
          variant="primary"
          onClick={() => handleAutoDetect()}
          disabled={isDetecting}
          leftIcon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
        >
          {isDetecting ? t("community.detecting") : t("community.autoDetect")}
        </Button>
        <Button
          variant="secondary"
          onClick={handlePickFolder}
          disabled={isScanning || isDetecting}
          leftIcon={FolderIcon}
        >
          {selectedFolder ? t("community.changeFolder") : t("community.pickFolder")}
        </Button>
        {hasContent && (
          <Button
            variant="ghost"
            onClick={() => {
              const folder =
                selectedFolder ||
                (filteredGroups[0]?.folderPath) ||
                (groups[0]?.folderPath);
              if (folder) {
                invoke("open_folder", { path: folder }).catch(() => {
                  showToast(t("community.couldNotOpenFolder"), "error");
                });
              }
            }}
            leftIcon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5l2 3h6a2 2 0 0 1 2 2v0" />
                <line x1="15" y1="3" x2="21" y2="3" />
                <line x1="18" y1="0" x2="18" y2="6" />
              </svg>
            }
          >
            {t("community.openFolder")}
          </Button>
        )}
        {selectedFolder && (
          <span className="community-screenshots-folder" title={selectedFolder}>
            {selectedFolder.split(/[\\/]/).pop() || selectedFolder}
            <span className="community-screenshots-count">
              {isScanning ? t("community.scanning") : t("community.mediaCount", { count: manualImages.length })}
            </span>
          </span>
        )}
      </div>

      {/* Filter / search toolbar (only when there is content) */}
      {hasContent && !isDetecting && !isScanning && (
        <div className="community-screenshots-filters">
          <input
            type="search"
            className="community-screenshots-search"
            placeholder={t("community.searchGamesPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("community.searchByGame")}
          />
          <button
            type="button"
            className={`community-filter-pill${showFavOnly ? " active" : ""}`}
            onClick={() => setShowFavOnly((v) => !v)}
          >
            ★ {t("common.favorites")}{showFavOnly ? ` (${visibleFavCount})` : ""}
          </button>
          {SOURCE_PILLS.map((src) => (
            <button
              key={src}
              type="button"
              className={`community-filter-pill${sourceFilter === src ? " active" : ""}`}
              onClick={() => setSourceFilter((prev) => (prev === src ? null : src))}
            >
              {sourceLabel(src)}
            </button>
          ))}
          <button
            type="button"
            className="community-filter-pill"
            onClick={() => {
              setSearch("");
              setSourceFilter(null);
              setShowFavOnly(false);
            }}
          >
            {t("common.clear")}
          </button>
          {filteredGroups.length > 0 && (
            <button
              type="button"
              className="community-filter-pill"
              onClick={toggleAllGroups}
              title={allExpanded ? t("common.collapseAll") : t("common.expandAll")}
            >
              {allExpanded ? t("common.collapseAll") : t("common.expandAll")}
            </button>
          )}
        </div>
      )}

      {/* Empty / tip state */}
      {!hasContent && (
        <div className="community-screenshots-empty">
          <div className="community-screenshots-empty-icon">{ImageIcon}</div>
          <h3>{t("community.browseScreenshots")}</h3>
          <p>
            {t("community.screenshotsHint")}
          </p>
        </div>
      )}

      {/* Loading: Steam detection */}
      {isDetecting && (
        <div className="community-screenshots-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`detect-sk-${i}`} className="community-screenshot-thumb skeleton" />
          ))}
        </div>
      )}

      {/* Loading: manual folder scan */}
      {isScanning && (
        <div className="community-screenshots-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={`scan-sk-${i}`} className="community-screenshot-thumb skeleton" />
          ))}
        </div>
      )}

      {/* ── Game-grouped accordion (Steam detected) ────────────────── */}
      {!isDetecting && filteredGroups.length > 0 && (
        <div className="community-screenshot-groups">
          {filteredGroups.map((group) => {
            const isExpanded = expandedKeys.has(group.key);
            const offset = groupOffsets.get(group.key) || 0;

            return (
              <div key={group.key} className="community-screenshot-group">
                {/* Group header */}
                <button
                  type="button"
                  className="community-screenshot-group-header"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={isExpanded}
                >
                  <div className="community-screenshot-group-cover">
                    {group.coverArtUrl ? (
                      <img src={group.coverArtUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="community-screenshot-group-cover-fallback">
                        {GamepadIcon}
                      </div>
                    )}
                  </div>
                  <div className="community-screenshot-group-info">
                    <span className="community-screenshot-group-name">{group.gameName}</span>
                    <div className="community-screenshot-group-tags">
                      {group.source && (
                        <span className={`community-source-badge community-source-${group.source}`}>
                          {sourceLabel(group.source)}
                        </span>
                      )}
                      {group.platform && (
                        <span className="community-screenshot-group-platform">{group.platform}</span>
                      )}
                    </div>
                  </div>
                  <div className="community-screenshot-group-right">
                    <span className="community-screenshot-group-count">
                      {t("community.screenshotCount", { count: group.screenshots.length, plural: group.screenshots.length !== 1 ? "s" : "" })}
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="18"
                      height="18"
                      className={`community-screenshot-group-chevron${isExpanded ? " expanded" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>

                {/* Group thumbnails (collapsible) */}
                {isExpanded && (
                  <div className="community-screenshot-group-grid">
                    {group.screenshots.map((p, i) => {
                      const globalIndex = offset + i;
                      return (
                        <ScreenshotThumb
                          key={p}
                          path={p}
                          index={globalIndex}
                          gameName={group.gameName}
                          isFavorite={favorites.has(p)}
                          onToggleFavorite={toggleFavorite}
                          onOpen={openLightbox}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Manual folder gallery (flat grid, no grouping) ──────────── */}
      {!isScanning && !isDetecting && filteredManual.length > 0 && (
        <div className="community-screenshots-grid">
          {(() => {
            // Manual images sit after all group images in the unified lightbox list.
            const manualOffset = filteredGroups.reduce(
              (sum, g) => sum + g.screenshots.length,
              0
            );
            return filteredManual.map((p, i) => (
              <ScreenshotThumb
                key={p}
                path={p}
                index={manualOffset + i}
                gameName={selectedFolder ? selectedFolder.split(/[\\/]/).pop() || "Screenshot" : "Screenshot"}
                isFavorite={favorites.has(p)}
                onToggleFavorite={toggleFavorite}
                onOpen={openLightbox}
              />
            ));
          })()}
        </div>
      )}

      {/* Empty after manual scan */}
      {!isScanning && !isDetecting && selectedFolder && manualImages.length === 0 && filteredGroups.length === 0 && (
        <div className="community-screenshots-empty">
          <p>{t("community.noMediaFolder")}</p>
        </div>
      )}

      {/* ── Lightbox (unified) ──────────────────────────────────────── */}
      {lightboxIndex !== null && allImagePaths[lightboxIndex] && (
        <div className="community-lightbox" onClick={closeLightbox}>
          <div className="community-lightbox-controls" onClick={(e) => e.stopPropagation()}>
            <button
              className="community-lightbox-nav"
              onClick={goPrev}
              aria-label={t("community.prevImage")}
            >
              {ChevronLeftIcon}
            </button>
            <div className="community-lightbox-info">
              <span className="community-lightbox-counter">
                {lightboxIndex + 1} / {allImagePaths.length}
              </span>
              {screenshotGroupIndex && screenshotGroupIndex[lightboxIndex] && (
                <span className="community-lightbox-game-name">
                  {screenshotGroupIndex[lightboxIndex].gameName}
                </span>
              )}
            </div>
            <button
              className="community-lightbox-nav"
              onClick={goNext}
              aria-label={t("community.nextImage")}
            >
              {ChevronRightIcon}
            </button>
            <button
              className="community-lightbox-close"
              onClick={closeLightbox}
              aria-label={t("community.closeLightbox")}
            >
              {XIcon}
            </button>
            <button
              type="button"
              className={`community-lightbox-nav community-slideshow-toggle${slideshow ? " active" : ""}`}
              onClick={() => setSlideshow((s) => !s)}
              aria-label={slideshow ? t("community.stopSlideshow") : t("community.startSlideshow")}
              title={slideshow ? t("community.stopSlideshow") : t("community.startSlideshow")}
            >
              {slideshow ? "❚❚" : "▶"}
            </button>
          </div>
          <div className="community-lightbox-image-wrapper" onClick={(e) => e.stopPropagation()}>
            {isVideoPath(allImagePaths[lightboxIndex]) ? (
              <video
                key={lightboxIndex}
                src={convertFileSrc(allImagePaths[lightboxIndex])}
                controls
                autoPlay
                style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: "var(--radius-md)" }}
              />
            ) : (
              <img
                key={lightboxIndex}
                src={convertFileSrc(allImagePaths[lightboxIndex])}
                alt={t("community.lightboxAlt", { n: lightboxIndex + 1 })}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.dataset.fallbackTried === "1") return;
                  img.dataset.fallbackTried = "1";
                  invoke<string>("read_cover_image", { filePath: allImagePaths[lightboxIndex] })
                    .then((dataUrl) => {
                      img.src = dataUrl;
                    })
                    .catch(() => {});
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
