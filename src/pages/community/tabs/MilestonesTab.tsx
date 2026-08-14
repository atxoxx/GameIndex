import { useMemo } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { Card } from "../../../components/ui";
import {
  formatHours,
  computePersonalRecords,
  computeMilestones,
  classifyGamerPersona,
  computeStreaks,
  computeTimeOfDay,
} from "../statsCalculations";
import type { Game, GameSession, DayCell } from "../statsTypes";

interface MilestonesTabProps {
  sessions: GameSession[];
  games: Game[];
  heatmapCells: DayCell[];
  genreBreakdown: { genre: string; minutes: number }[];
  totalAchievementsUnlocked: number;
}

export function MilestonesTab({
  sessions,
  games,
  heatmapCells,
  genreBreakdown,
  totalAchievementsUnlocked,
}: MilestonesTabProps) {
  const { t } = useLanguage();

  const totalPlaytimeMin = useMemo(() => sessions.reduce((s, x) => s + x.durationMin, 0), [sessions]);
  const streakInfo = useMemo(() => computeStreaks(sessions), [sessions]);
  const timeOfDay = useMemo(() => computeTimeOfDay(sessions), [sessions]);

  // Personal Records
  const records = useMemo(
    () => computePersonalRecords(sessions, heatmapCells, streakInfo, genreBreakdown),
    [sessions, heatmapCells, streakInfo, genreBreakdown]
  );

  // Gamer Persona
  const persona = useMemo(
    () => classifyGamerPersona(sessions, games, genreBreakdown, timeOfDay),
    [sessions, games, genreBreakdown, timeOfDay]
  );

  // Milestones
  const milestones = useMemo(
    () => computeMilestones(totalPlaytimeMin, games.length, streakInfo.longest, totalAchievementsUnlocked),
    [totalPlaytimeMin, games.length, streakInfo.longest, totalAchievementsUnlocked]
  );

  const unlockedMilestonesCount = milestones.filter((m) => m.unlocked).length;

  return (
    <div className="stats-tab-milestones">
      {/* ── Personal Records Wall ──────────────────────────────────── */}
      <section className="stats-section">
        <h2 className="stats-section-title">🏆 {t("stats.records.title")}</h2>
        <div className="stats-records-grid">
          {/* Longest Session */}
          <div className="stats-record-card">
            <span className="stats-record-icon">⏱️</span>
            <div className="stats-record-content">
              <span className="stats-record-label">{t("community.longestSession")}</span>
              <span className="stats-record-value">
                {records.longestSession ? formatHours(records.longestSession.minutes) : "—"}
              </span>
              {records.longestSession && (
                <span className="stats-record-sub" title={records.longestSession.gameName}>
                  {records.longestSession.gameName}
                </span>
              )}
            </div>
          </div>

          {/* Best Single Day */}
          <div className="stats-record-card">
            <span className="stats-record-icon">🌟</span>
            <div className="stats-record-content">
              <span className="stats-record-label">{t("communityExtras.bestDay")}</span>
              <span className="stats-record-value">
                {records.bestDay ? formatHours(records.bestDay.minutes) : "—"}
              </span>
              {records.bestDay && (
                <span className="stats-record-sub">
                  {records.bestDay.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
          </div>

          {/* Longest Streak */}
          <div className="stats-record-card">
            <span className="stats-record-icon">🔥</span>
            <div className="stats-record-content">
              <span className="stats-record-label">{t("stats.records.longestStreak")}</span>
              <span className="stats-record-value">
                {records.longestStreak} {t("communityExtras.dayStreak")}
              </span>
              <span className="stats-record-sub">{t("stats.records.consecutiveDailyPlay")}</span>
            </div>
          </div>

          {/* Most Active Month */}
          <div className="stats-record-card">
            <span className="stats-record-icon">📅</span>
            <div className="stats-record-content">
              <span className="stats-record-label">{t("stats.records.peakMonth")}</span>
              <span className="stats-record-value">
                {records.mostActiveMonth ? formatHours(records.mostActiveMonth.minutes) : "—"}
              </span>
              {records.mostActiveMonth && (
                <span className="stats-record-sub">{records.mostActiveMonth.label}</span>
              )}
            </div>
          </div>

          {/* Top Genre */}
          <div className="stats-record-card">
            <span className="stats-record-icon">⚔️</span>
            <div className="stats-record-content">
              <span className="stats-record-label">{t("communityExtras.topGenreLabel")}</span>
              <span className="stats-record-value">
                {records.mostPlayedGenre ? records.mostPlayedGenre.genre : "—"}
              </span>
              {records.mostPlayedGenre && (
                <span className="stats-record-sub">{formatHours(records.mostPlayedGenre.minutes)}</span>
              )}
            </div>
          </div>

          {/* Games Conquered */}
          <div className="stats-record-card">
            <span className="stats-record-icon">🎯</span>
            <div className="stats-record-content">
              <span className="stats-record-label">{t("community.gamesPlayed")}</span>
              <span className="stats-record-value">{records.totalGamesConquered}</span>
              <span className="stats-record-sub">{t("stats.records.distinctTitlesPlayed")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Gamer Persona & Playstyle Attributes ──────────────────── */}
      <section className="stats-section">
        <h2 className="stats-section-title">🧠 {t("stats.persona.playstyleTitle")}</h2>
        <Card variant="surface" elevation="1" className="stats-persona-card">
          <div className="stats-persona-card-header">
            <div className="stats-persona-badge-lg">{persona.badgeEmoji}</div>
            <div className="stats-persona-info">
              <h3>{t(persona.titleKey)}</h3>
              <p>{t(persona.subtitleKey)}</p>
            </div>
          </div>

          <div className="stats-persona-traits-list">
            {persona.traits.map((trait) => (
              <div key={trait.nameKey} className="stats-persona-trait-row">
                <div className="stats-persona-trait-labels">
                  <span className="stats-persona-trait-name">{t(trait.nameKey)}</span>
                  <span className="stats-persona-trait-score">{trait.score} / 100</span>
                </div>
                <div className="stats-persona-trait-track">
                  <div
                    className="stats-persona-trait-fill"
                    style={{ width: `${trait.score}%` }}
                  />
                </div>
                <span className="stats-persona-trait-desc">{t(trait.descriptionKey)}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ── Milestones Progression ─────────────────────────────────── */}
      <section className="stats-section">
        <div className="stats-section-header-row">
          <h2 className="stats-section-title">🎖️ {t("stats.milestones.title")}</h2>
          <span className="stats-section-badge">
            {unlockedMilestonesCount} / {milestones.length} {t("stats.milestones.unlocked")}
          </span>
        </div>

        <div className="stats-milestones-grid">
          {milestones.map((m) => {
            const pct = Math.min(100, Math.round((m.currentValue / m.targetValue) * 100));
            return (
              <div key={m.id} className={`stats-milestone-card${m.unlocked ? " unlocked" : ""}`}>
                <div className="stats-milestone-header">
                  <span className="stats-milestone-icon">{m.icon}</span>
                  {m.unlocked && <span className="stats-milestone-stamp">✓ UNLOCKED</span>}
                </div>
                <span className="stats-milestone-title">{t(m.titleKey)}</span>
                <p className="stats-milestone-desc">{t(m.descKey, { target: m.targetValue })}</p>

                <div className="stats-milestone-track">
                  <div className="stats-milestone-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="stats-milestone-footer">
                  <span>{m.currentValue} / {m.targetValue}</span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
